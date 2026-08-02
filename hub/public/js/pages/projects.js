import { Session, initShell, timeAgo, esc, renderIcons, rebind, toast, modalForm, modalConfirm } from "/js/app-shell.js";

await initShell();

let all = [];
let search = "";
let statusFilter = "all";
const MODES = [
  { value: "auto", label: "Auto" },
  { value: "manual", label: "Manual" },
  { value: "stopped", label: "Stopped" },
];

// New project (proper modal)
rebind(document.querySelector(".heading-actions .btn"), "click", async (e) => {
  e.preventDefault();
  const vals = await modalForm({
    title: "New project",
    desc: "Give it an alias, then map machines to their local ~/.claude/projects folder.",
    fields: [
      { name: "alias", label: "Project alias", placeholder: "my-app", required: true },
      { name: "sync_mode", label: "Sync mode", type: "select", value: "auto", options: MODES },
    ],
    submitLabel: "Create project",
  });
  if (!vals) return;
  const res = await Session.api("POST", "/api/projects", { alias: vals.alias, sync_mode: vals.sync_mode });
  if (res?.id) { toast("Project created"); load(); }
  else toast(res?.error || "Could not create project");
});

// Search
const searchInput = document.querySelector(".search-box input");
searchInput?.addEventListener("input", () => { search = searchInput.value.toLowerCase(); render(); });

// Status filter (cycle)
const statusBtn = document.querySelector(".toolbar .btn");
if (statusBtn) {
  statusBtn.addEventListener("click", () => {
    const order = ["all", "auto", "manual", "stopped"];
    statusFilter = order[(order.indexOf(statusFilter) + 1) % order.length];
    statusBtn.textContent = "Status: " + statusFilter[0].toUpperCase() + statusFilter.slice(1);
    render();
  });
}

function modeBadge(m) {
  if (m === "stopped") return '<span class="badge badge-orange">Stopped</span>';
  if (m === "manual") return '<span class="badge badge-neutral">Manual</span>';
  return '<span class="badge badge-blue">Auto</span>';
}
function statusBadge(m) {
  if (m === "stopped") return '<span class="badge badge-orange">Paused</span>';
  return '<span class="badge badge-green">Synced</span>';
}

async function load() {
  all = (await Session.api("GET", "/api/projects")) || [];
  render();
}

function render() {
  const head = document.querySelector(".card-head p");
  if (head) head.textContent = `${all.length} project${all.length === 1 ? "" : "s"}`;

  const list = all.filter((p) =>
    (statusFilter === "all" || p.sync_mode === statusFilter) &&
    (!search || p.alias.toLowerCase().includes(search)));

  const table = document.querySelector(".table");
  if (!table) return;
  const header = table.querySelector(".table-header");
  table.innerHTML = "";
  if (header) table.appendChild(header);

  if (!list.length) {
    const msg = all.length ? "No projects match your filter." : 'No projects yet. Click "New project" to add one.';
    table.insertAdjacentHTML("beforeend", `<div class="empty-state">${msg}</div>`);
    return;
  }

  for (const p of list) {
    const row = document.createElement("div");
    row.className = "table-row table-projects";
    row.innerHTML = `
      <div class="item-title"><div class="item-icon"><svg data-icon="folder"></svg></div>
        <div class="item-copy"><strong>${esc(p.alias)}</strong><span>created ${timeAgo(p.created_at)}</span></div></div>
      <div>${modeBadge(p.sync_mode)}</div>
      <div>${statusBadge(p.sync_mode)}</div>
      <div class="cell-muted">${timeAgo(p.created_at)}</div>
      <div class="row-actions" style="display:flex;gap:6px">
        <a class="btn btn-secondary btn-sm" href="project-detail.html?id=${p.id}">Open</a>
        <button class="icon-button" title="Delete project"><svg data-icon="trash"></svg></button>
      </div>`;
    row.querySelector("button").addEventListener("click", async () => {
      const ok = await modalConfirm({
        title: `Delete “${p.alias}”?`,
        message: "Removes it from the Hub. Your local transcripts on each machine are untouched.",
        confirmLabel: "Delete", danger: true,
      });
      if (!ok) return;
      await Session.api("DELETE", `/api/projects/${p.id}`);
      toast("Project deleted");
      load();
    });
    table.appendChild(row);
  }
  renderIcons(table);
}

await load();
