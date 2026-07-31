import { Session, initShell, timeAgo, esc, renderIcons, rebind, toast } from "/js/app-shell.js";

const id = Number(new URLSearchParams(location.search).get("id"));
await initShell({ onChanged: (m) => { if (m.projectId === id) load(); } });
if (!id) { toast("No project id"); } else { await load(); }

let project = null;

async function load() {
  const [detail, machines, conflicts] = await Promise.all([
    Session.api("GET", `/api/projects/${id}`),
    Session.api("GET", "/api/machines"),
    Session.api("GET", `/api/projects/${id}/conflicts`),
  ]);
  if (!detail) { toast("Project not found"); return; }
  project = detail;

  document.querySelectorAll(".page-heading h1").forEach((el) => (el.textContent = detail.alias));
  const kicker = document.querySelector(".page-kicker");
  if (kicker) kicker.textContent = `Projects / ${detail.alias}`;

  renderStatCards(detail, machines, conflicts);
  renderMachines(detail, machines);
  renderDetails(detail);
  wireActions(detail);
}

function renderStatCards(detail, machines, conflicts) {
  const cards = document.querySelectorAll(".stats-grid .stat-card");
  const mapped = detail.mappings.length;
  const set = (card, v) => { const e = card?.querySelector(".stat-value"); if (e) e.textContent = v; };
  if (cards[0]) set(cards[0], detail.sync_mode[0].toUpperCase() + detail.sync_mode.slice(1));
  if (cards[1]) set(cards[1], mapped);
  if (cards[2]) set(cards[2], "—"); // tracked files count (needs manifest; left blank)
  if (cards[3]) set(cards[3], (conflicts || []).length);
}

function renderMachines(detail, machines) {
  const table = document.querySelector(".dashboard-grid .table");
  if (!table) return;
  const header = table.querySelector(".table-header");
  table.innerHTML = "";
  if (header) table.appendChild(header);

  const byId = new Map((machines || []).map((m) => [m.id, m]));
  for (const map of detail.mappings) {
    const m = byId.get(map.machine_id) || {};
    const online = m.status === "online";
    table.insertAdjacentHTML("beforeend", `
      <div class="table-row table-machines">
        <div class="item-title"><div class="item-icon"><svg data-icon="monitor"></svg></div>
          <div class="item-copy"><strong>${esc(m.name || "machine " + map.machine_id)}</strong><span>${esc(map.local_path)}</span></div></div>
        <div><span class="badge ${online ? "badge-green" : "badge-neutral"}">${online ? "Online" : "Offline"}</span></div>
        <div class="cell-text">${esc(m.agent_version || "—")}</div>
        <div class="cell-muted">${timeAgo(m.last_seen_at)}</div>
        <div class="row-actions"><button class="icon-button" data-unmap="${map.machine_id}" title="Unmap"><svg data-icon="trash"></svg></button></div>
      </div>`);
  }
  if (!detail.mappings.length) {
    table.insertAdjacentHTML("beforeend",
      '<div class="table-row"><div class="cell-muted" style="padding:14px">No machines mapped. Use “Add machine” to map one.</div></div>');
  }
  table.querySelectorAll("[data-unmap]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      await Session.api("DELETE", `/api/projects/${id}/mappings/${btn.dataset.unmap}`);
      toast("Machine unmapped"); load();
    }));
  renderIcons(table);
}

function renderDetails(detail) {
  const rows = document.querySelectorAll(".stack .card .status-row");
  // Best-effort fill of the "Project details" card
  rows.forEach((row) => {
    const label = row.querySelector(".status-label")?.textContent?.toLowerCase() || "";
    const val = row.querySelector("span:last-child");
    if (!val) return;
    if (label.includes("local path")) val.textContent = detail.mappings[0]?.local_path || "—";
    else if (label.includes("created")) val.textContent = timeAgo(detail.created_at);
    else if (label.includes("branch")) { row.style.display = "none"; }
    else if (label.includes("ignore")) { row.style.display = "none"; }
  });
}

function wireActions(detail) {
  // "Sync now" (first heading button)
  rebind(document.querySelector(".heading-actions .btn"), "click", async (e) => {
    e.preventDefault();
    const res = await Session.api("POST", `/api/projects/${id}/sync-now`);
    toast(res?.status === "triggered" ? "Sync requested" : "Could not trigger sync");
  });

  // Replace "Project settings" with a sync-mode cycler + Add machine
  const settingsBtn = document.querySelectorAll(".heading-actions .btn")[1];
  rebind(settingsBtn, "click", async (e) => {
    e.preventDefault();
    const order = ["auto", "manual", "stopped"];
    const next = order[(order.indexOf(detail.sync_mode) + 1) % order.length];
    const res = await Session.api("PUT", `/api/projects/${id}/sync-mode`, { sync_mode: next });
    if (res?.sync_mode) { toast(`Sync mode → ${next}`); load(); }
  });

  // "Manage machines" link becomes "Add machine" mapping flow
  const manage = document.querySelector(".dashboard-grid .btn.btn-secondary.btn-sm");
  rebind(manage, "click", async (e) => {
    e.preventDefault();
    const machines = await Session.api("GET", "/api/machines");
    if (!machines?.length) { toast("Create a machine first (Machines page)"); return; }
    const list = machines.map((m, i) => `${i + 1}. ${m.name}`).join("\n");
    const pick = prompt(`Map which machine?\n${list}\n\nEnter number:`);
    const machine = machines[Number(pick) - 1];
    if (!machine) return;
    const path = prompt(`Local folder path on ${machine.name} (its ~/.claude/projects/<hash> dir):`);
    if (!path) return;
    await Session.api("PUT", `/api/projects/${id}/mappings/${machine.id}`, { local_path: path.trim() });
    toast("Machine mapped"); load();
  });
}
