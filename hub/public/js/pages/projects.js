import { Session, initShell, timeAgo, esc, renderIcons, rebind, toast } from "/js/app-shell.js";

await initShell();
await load();

// "New project" button
rebind(document.querySelector(".heading-actions .btn:last-child"), "click", async (e) => {
  e.preventDefault();
  const alias = prompt("Project alias (e.g. my-app):");
  if (!alias) return;
  const res = await Session.api("POST", "/api/projects", { alias: alias.trim() });
  if (res?.id) { toast("Project created"); load(); }
  else toast(res?.error || "Could not create project");
});

function modeBadge(mode) {
  if (mode === "stopped") return '<span class="badge badge-orange">Stopped</span>';
  if (mode === "manual") return '<span class="badge badge-neutral">Manual</span>';
  return '<span class="badge badge-blue">Auto</span>';
}
function statusBadge(mode) {
  if (mode === "stopped") return '<span class="badge badge-orange">Paused</span>';
  return '<span class="badge badge-green">Synced</span>';
}

async function load() {
  const projects = await Session.api("GET", "/api/projects");
  if (!projects) return;

  const head = document.querySelector(".card-head p");
  if (head) head.textContent = `${projects.length} project${projects.length === 1 ? "" : "s"}`;

  const table = document.querySelector(".table");
  if (!table) return;
  const header = table.querySelector(".table-header");
  table.innerHTML = "";
  if (header) table.appendChild(header);

  if (!projects.length) {
    table.insertAdjacentHTML("beforeend",
      '<div class="table-row"><div class="cell-muted" style="padding:16px">No projects yet. Click “New project” to add one.</div></div>');
    return;
  }

  for (const p of projects) {
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
        <button class="icon-button" title="Delete"><svg data-icon="trash"></svg></button>
      </div>`;
    row.querySelector("button").addEventListener("click", async () => {
      if (!confirm(`Delete project “${p.alias}”? Its sync state is removed (local transcripts are untouched).`)) return;
      await Session.api("DELETE", `/api/projects/${p.id}`);
      toast("Project deleted");
      load();
    });
    table.appendChild(row);
  }
  renderIcons(table);
}
