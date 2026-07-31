import { Session, initShell, timeAgo, esc, renderIcons, rebind, toast, refreshNavCounts } from "/js/app-shell.js";

await initShell({ onNotification: load });
await load();

rebind(document.querySelector(".heading-actions .btn"), "click", async (e) => {
  e.preventDefault();
  await Session.api("POST", "/api/notifications/read-all");
  toast("All marked read");
  await refreshNavCounts();
  load();
});

const ICONS = {
  conflict: ["alert", "red"],
  sync: ["check", "green"],
  info: ["bell", "blue"],
};

async function load() {
  const data = await Session.api("GET", "/api/notifications");
  if (!data) return;
  const list = document.querySelector(".notification-list");
  if (!list) return;

  const head = list.querySelector(".card-head p");
  if (head) head.textContent = `${data.unread} unread · ${data.items.length} recent`;

  // remove existing notification items, keep the card-head
  list.querySelectorAll(".notification-item").forEach((n) => n.remove());

  if (!data.items.length) {
    list.insertAdjacentHTML("beforeend", '<div class="empty-state">No notifications yet.</div>');
    return;
  }
  for (const n of data.items) {
    const [ic, color] = ICONS[n.type] || ICONS.info;
    const item = document.createElement("div");
    item.className = "notification-item" + (n.read ? "" : " unread");
    item.innerHTML = `
      <div class="notification-icon ${color}"><svg data-icon="${ic}"></svg></div>
      <div class="notification-copy"><strong>${esc(n.title)}</strong><p>${esc(n.body || "")}</p></div>
      <span class="notification-time">${timeAgo(n.created_at)}</span>`;
    if (!n.read) item.addEventListener("click", async () => {
      await Session.api("POST", `/api/notifications/${n.id}/read`);
      item.classList.remove("unread");
      await refreshNavCounts();
      const d = await Session.api("GET", "/api/notifications");
      if (head && d) head.textContent = `${d.unread} unread · ${d.items.length} recent`;
    });
    list.appendChild(item);
  }
  renderIcons(list);
}
