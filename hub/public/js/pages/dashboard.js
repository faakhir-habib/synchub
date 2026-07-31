import { Session, initShell, timeAgo, fmtBytes, esc, renderIcons } from "/js/app-shell.js";

const me = await initShell({ onNotification: load, onChanged: load });
if (me) await load();

async function load() {
  const [metrics, activity, projects] = await Promise.all([
    Session.api("GET", "/api/dashboard/metrics"),
    Session.api("GET", "/api/dashboard/activity?limit=8"),
    Session.api("GET", "/api/projects"),
  ]);
  if (metrics) renderStats(metrics);
  if (projects) renderRecentProjects(projects);
  if (activity) renderActivity(activity);

  // Greeting line
  const h1 = document.querySelector(".page-heading h1");
  if (h1 && me) h1.textContent = `Welcome back, ${me.email.split("@")[0]}.`;
}

function setStat(card, value, footStrong, footSpan) {
  if (!card) return;
  const v = card.querySelector(".stat-value"); if (v) v.textContent = value;
  const fs = card.querySelector(".stat-foot strong"); if (fs && footStrong != null) fs.textContent = footStrong;
  const sp = card.querySelector(".stat-foot span"); if (sp && footSpan != null) sp.textContent = footSpan;
}

function renderStats(m) {
  const cards = document.querySelectorAll(".stats-grid .stat-card");
  setStat(cards[0], m.projects.total, `${m.projects.syncing} syncing`, "your projects");
  setStat(cards[1], `${m.machines.online}/${m.machines.total}`, m.machines.online ? "online" : "all offline", "machines");
  setStat(cards[2], m.openConflicts, m.openConflicts ? "needs review" : "all clear", "conflicts");
  setStat(cards[3], `${m.syncSuccessRate}%`, `${m.eventsToday} events`, "today");

  // Sync-engine metric boxes (Events today / Avg latency)
  const boxes = document.querySelectorAll(".metric-box strong");
  if (boxes[0]) boxes[0].textContent = m.eventsToday;
  if (boxes[1]) boxes[1].textContent = m.avgLatencyMs != null ? `${m.avgLatencyMs}ms` : "—";
}

function statusBadge(mode) {
  if (mode === "stopped") return '<span class="badge badge-orange">Stopped</span>';
  if (mode === "manual") return '<span class="badge badge-neutral">Manual</span>';
  return '<span class="badge badge-green">Auto</span>';
}

function renderRecentProjects(projects) {
  const table = document.querySelector(".dashboard-grid .table");
  if (!table) return;
  const header = table.querySelector(".table-header");
  table.innerHTML = "";
  if (header) table.appendChild(header);
  if (!projects.length) {
    table.insertAdjacentHTML("beforeend",
      '<div class="table-row"><div class="cell-muted" style="padding:14px">No projects yet — create one on the Projects page.</div></div>');
    return;
  }
  for (const p of projects.slice(0, 5)) {
    table.insertAdjacentHTML("beforeend", `
      <div class="table-row table-projects">
        <div class="item-title"><div class="item-icon"><svg data-icon="folder"></svg></div>
          <div class="item-copy"><strong>${esc(p.alias)}</strong><span>created ${timeAgo(p.created_at)}</span></div></div>
        <div>${statusBadge(p.sync_mode)}</div>
        <div class="cell-text">—</div>
        <div class="cell-muted">${timeAgo(p.created_at)}</div>
        <div class="row-actions"><a class="icon-button" href="project-detail.html?id=${p.id}"><svg data-icon="chevron"></svg></a></div>
      </div>`);
  }
  renderIcons(table);
}

const ACT_ICON = { push: "cloud", auto_merge: "check", conflict: "alert", conflict_resolved: "check", sync_now: "refresh" };
function renderActivity(events) {
  const box = document.querySelector(".project-activity");
  if (!box) return;
  box.innerHTML = "";
  if (!events.length) {
    box.innerHTML = '<div class="cell-muted" style="padding:8px">No activity yet.</div>';
    return;
  }
  for (const e of events) {
    box.insertAdjacentHTML("beforeend", `
      <div class="activity-item">
        <div class="activity-icon"><svg data-icon="${ACT_ICON[e.type] || "zap"}"></svg></div>
        <div class="activity-copy"><strong>${esc(e.type.replace(/_/g, " "))}</strong>
          <p>${esc(e.filename || "")}</p></div>
        <span class="activity-time">${timeAgo(e.created_at)}</span>
      </div>`);
  }
  renderIcons(box);
}
