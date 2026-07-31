import { Session, initShell, timeAgo, esc, renderIcons, rebind, toast, modalForm } from "/js/app-shell.js";

const id = Number(new URLSearchParams(location.search).get("id"));
await initShell({ onChanged: (m) => { if (m.projectId === id) load(); } });
if (!id) { location.href = "/projects.html"; }

const MODES = [
  { value: "auto", label: "Auto — sync live" },
  { value: "manual", label: "Manual — sync on demand" },
  { value: "stopped", label: "Stopped — no syncing" },
];

// Wire action buttons ONCE, independent of data load, fetching fresh data on click.
wireButtons();
if (id) await load();

function wireButtons() {
  // Sync now
  rebind(document.querySelector(".heading-actions .btn"), "click", async (e) => {
    e.preventDefault();
    const res = await Session.api("POST", `/api/projects/${id}/sync-now`);
    toast(res?.status === "triggered" ? "Sync requested on all machines" : "Could not trigger sync");
  });

  // Project settings (rename + sync mode)
  rebind(document.querySelectorAll(".heading-actions .btn")[1], "click", async (e) => {
    e.preventDefault();
    const d = await Session.api("GET", `/api/projects/${id}`);
    if (!d) { toast("Project not found"); return; }
    const vals = await modalForm({
      title: "Project settings",
      desc: "Rename the project or change how it syncs.",
      fields: [
        { name: "alias", label: "Project name", value: d.alias, required: true },
        { name: "sync_mode", label: "Sync mode", type: "select", value: d.sync_mode, options: MODES },
      ],
      submitLabel: "Save",
    });
    if (!vals) return;
    const res = await Session.api("PUT", `/api/projects/${id}`, { alias: vals.alias, sync_mode: vals.sync_mode });
    if (res?.id) { toast("Project settings saved"); load(); }
    else toast(res?.error || "Could not save");
  });

  // Add machine (map a machine to this project)
  rebind(document.querySelector("#add-machine-btn"), "click", async (e) => {
    e.preventDefault();
    const [d, machines] = await Promise.all([
      Session.api("GET", `/api/projects/${id}`),
      Session.api("GET", "/api/machines"),
    ]);
    if (!d) { toast("Project not found"); return; }
    if (!machines || !machines.length) { toast("No machines yet — pair one on the Machines page first"); return; }
    const mapped = new Set((d.mappings || []).map((x) => x.machine_id));
    const available = machines.filter((m) => !mapped.has(m.id));
    if (!available.length) { toast("All your machines are already mapped to this project"); return; }
    const vals = await modalForm({
      title: "Add machine to project",
      desc: "Map a machine to the local folder where this project's transcripts live (its ~/.claude/projects/<hash>).",
      fields: [
        { name: "machine_id", label: "Machine", type: "select", value: String(available[0].id), options: available.map((m) => ({ value: String(m.id), label: m.name })) },
        { name: "local_path", label: "Local folder path", placeholder: "C:\\Users\\you\\.claude\\projects\\<hash>", required: true },
      ],
      submitLabel: "Add machine",
    });
    if (!vals) return;
    const res = await Session.api("PUT", `/api/projects/${id}/mappings/${vals.machine_id}`, { local_path: vals.local_path });
    if (res && !res.error) { toast("Machine mapped — sync will start shortly"); load(); }
    else toast(res?.error || "Could not map machine");
  });
}

async function load() {
  const [d, machines, conflicts] = await Promise.all([
    Session.api("GET", `/api/projects/${id}`),
    Session.api("GET", "/api/machines"),
    Session.api("GET", `/api/projects/${id}/conflicts`),
  ]);
  if (!d) { toast("Project not found"); return; }

  document.querySelectorAll(".page-heading h1").forEach((el) => (el.textContent = d.alias));
  const kicker = document.querySelector(".page-kicker");
  if (kicker) kicker.textContent = `Projects / ${d.alias}`;

  const cards = document.querySelectorAll(".stats-grid .stat-card .stat-value");
  if (cards[0]) cards[0].textContent = d.sync_mode[0].toUpperCase() + d.sync_mode.slice(1);
  if (cards[1]) cards[1].textContent = d.mappings.length;
  if (cards[2]) cards[2].textContent = d.tracked_files ?? 0;
  if (cards[3]) cards[3].textContent = (conflicts || []).length;

  renderMachines(d, machines || []);
  renderDetails(d);
}

function renderMachines(d, machines) {
  const table = document.querySelector(".dashboard-grid .table");
  if (!table) return;
  const header = table.querySelector(".table-header");
  table.innerHTML = "";
  if (header) table.appendChild(header);
  const byId = new Map(machines.map((m) => [m.id, m]));

  if (!d.mappings.length) {
    table.insertAdjacentHTML("beforeend", '<div class="empty-state">No machines mapped yet. Click “Add machine”.</div>');
  }
  for (const map of d.mappings) {
    const m = byId.get(map.machine_id) || {};
    const online = m.status === "online";
    const row = document.createElement("div");
    row.className = "table-row table-machines";
    row.innerHTML = `
      <div class="item-title"><div class="item-icon"><svg data-icon="monitor"></svg></div>
        <div class="item-copy"><strong>${esc(m.name || "machine " + map.machine_id)}</strong><span>${esc(map.local_path)}</span></div></div>
      <div><span class="badge ${online ? "badge-green" : "badge-neutral"}">${online ? "Online" : "Offline"}</span></div>
      <div class="cell-text">${esc(m.agent_version || "\u2014")}</div>
      <div class="cell-muted">${timeAgo(m.last_seen_at)}</div>
      <div class="row-actions" style="display:flex;gap:6px">
        <button class="icon-button" data-edit title="Change folder path"><svg data-icon="settings"></svg></button>
        <button class="icon-button" data-unmap title="Unmap machine"><svg data-icon="trash"></svg></button>
      </div>`;
    row.querySelector("[data-edit]").addEventListener("click", async () => {
      const vals = await modalForm({
        title: `Folder path — ${m.name || "machine"}`,
        desc: "The local ~/.claude/projects/<hash> folder on this machine (where the .jsonl transcripts live).",
        fields: [{ name: "local_path", label: "Local folder path", value: map.local_path, required: true }],
        submitLabel: "Save path",
      });
      if (!vals) return;
      await Session.api("PUT", `/api/projects/${id}/mappings/${map.machine_id}`, { local_path: vals.local_path });
      toast("Folder path updated"); load();
    });
    row.querySelector("[data-unmap]").addEventListener("click", async () => {
      await Session.api("DELETE", `/api/projects/${id}/mappings/${map.machine_id}`);
      toast("Machine unmapped"); load();
    });
    table.appendChild(row);
  }
  renderIcons(table);
}

function renderDetails(d) {
  document.querySelectorAll(".stack .card .status-row").forEach((row) => {
    const label = row.querySelector(".status-label")?.textContent?.toLowerCase() || "";
    const val = row.querySelector("span:last-child");
    if (!val) return;
    if (label.includes("local path")) val.textContent = d.mappings[0]?.local_path || "\u2014";
    else if (label.includes("created")) val.textContent = timeAgo(d.created_at);
    else if (label.includes("branch") || label.includes("ignore")) row.style.display = "none";
  });
}
