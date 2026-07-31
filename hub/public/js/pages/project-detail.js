import { Session, initShell, timeAgo, esc, renderIcons, rebind, toast, modalForm, modalConfirm } from "/js/app-shell.js";

const id = Number(new URLSearchParams(location.search).get("id"));
await initShell({ onChanged: (m) => { if (m.projectId === id) load(); } });
if (!id) { toast("No project id"); } else { await load(); }

let detail = null;

async function load() {
  const [d, machines, conflicts] = await Promise.all([
    Session.api("GET", `/api/projects/${id}`),
    Session.api("GET", "/api/machines"),
    Session.api("GET", `/api/projects/${id}/conflicts`),
  ]);
  if (!d) { toast("Project not found"); return; }
  detail = d;

  document.querySelectorAll(".page-heading h1").forEach((el) => (el.textContent = d.alias));
  const kicker = document.querySelector(".page-kicker");
  if (kicker) kicker.textContent = `Projects / ${d.alias}`;

  const cards = document.querySelectorAll(".stats-grid .stat-card .stat-value");
  if (cards[0]) cards[0].textContent = d.sync_mode[0].toUpperCase() + d.sync_mode.slice(1);
  if (cards[1]) cards[1].textContent = d.mappings.length;
  if (cards[2]) cards[2].textContent = "\u2014";
  if (cards[3]) cards[3].textContent = (conflicts || []).length;

  renderMachines(d, machines || []);
  renderDetails(d);
  wireActions(d, machines || []);
}

function renderMachines(d, machines) {
  const table = document.querySelector(".dashboard-grid .table");
  if (!table) return;
  const header = table.querySelector(".table-header");
  table.innerHTML = "";
  if (header) table.appendChild(header);
  const byId = new Map(machines.map((m) => [m.id, m]));

  if (!d.mappings.length) {
    table.insertAdjacentHTML("beforeend", '<div class="empty-state">No machines mapped yet. Use “Add machine”.</div>');
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
      <div class="row-actions"><button class="icon-button" title="Unmap machine"><svg data-icon="trash"></svg></button></div>`;
    row.querySelector("button").addEventListener("click", async () => {
      const ok = await modalConfirm({ title: `Unmap ${m.name || "machine"}?`, message: "It stops syncing this project. Re-map anytime.", confirmLabel: "Unmap", danger: true });
      if (!ok) return;
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

function wireActions(d, machines) {
  // Sync now
  rebind(document.querySelector(".heading-actions .btn"), "click", async (e) => {
    e.preventDefault();
    const res = await Session.api("POST", `/api/projects/${id}/sync-now`);
    toast(res?.status === "triggered" ? "Sync requested on all machines" : "Could not trigger sync");
  });

  // Project settings -> modal (sync mode)
  const settingsBtn = document.querySelectorAll(".heading-actions .btn")[1];
  rebind(settingsBtn, "click", async (e) => {
    e.preventDefault();
    const vals = await modalForm({
      title: "Project settings",
      fields: [{ name: "sync_mode", label: "Sync mode", type: "select", value: d.sync_mode, options: [
        { value: "auto", label: "Auto — sync live" },
        { value: "manual", label: "Manual — sync on demand" },
        { value: "stopped", label: "Stopped — no syncing" },
      ] }],
      submitLabel: "Save",
    });
    if (!vals) return;
    const res = await Session.api("PUT", `/api/projects/${id}/sync-mode`, { sync_mode: vals.sync_mode });
    if (res?.sync_mode) { toast(`Sync mode set to ${vals.sync_mode}`); load(); }
  });

  // Add machine -> modal (pick machine + path)
  rebind(document.querySelector(".dashboard-grid .btn.btn-secondary.btn-sm"), "click", async (e) => {
    e.preventDefault();
    const mapped = new Set(d.mappings.map((x) => x.machine_id));
    const available = machines.filter((m) => !mapped.has(m.id));
    if (!machines.length) { toast("Create a machine first on the Machines page"); return; }
    if (!available.length) { toast("All your machines are already mapped"); return; }
    const vals = await modalForm({
      title: "Add machine to project",
      desc: "Map a machine to the local folder where this project's transcripts live.",
      fields: [
        { name: "machine_id", label: "Machine", type: "select", value: String(available[0].id), options: available.map((m) => ({ value: String(m.id), label: m.name })) },
        { name: "local_path", label: "Local folder path", placeholder: "C:\\Users\\you\\.claude\\projects\\<hash>", required: true },
      ],
      submitLabel: "Add",
    });
    if (!vals) return;
    await Session.api("PUT", `/api/projects/${id}/mappings/${vals.machine_id}`, { local_path: vals.local_path });
    toast("Machine mapped"); load();
  });
}
