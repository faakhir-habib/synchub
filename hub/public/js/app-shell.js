import { Session, applyUserChrome } from "/js/session.js";

export { Session };

export function toast(msg) { (window.SyncHubUI?.toast || console.log)(msg); }
export function renderIcons(root) { window.SyncHubUI?.renderIcons?.(root || document); }

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function frag(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content;
}

export function timeAgo(iso) {
  if (!iso) return "—";
  const norm = iso.includes("T") ? iso : iso.replace(" ", "T");
  const d = new Date(norm.endsWith("Z") ? norm : norm + "Z");
  const s = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (s < 60) return `${Math.floor(s)}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function fmtBytes(n) {
  if (n == null) return "—";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0, x = Number(n);
  while (x >= 1024 && i < u.length - 1) { x /= 1024; i++; }
  return `${x.toFixed(x < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
}

// Replace a button's listeners (app.js attached data-toast handlers) then bind ours.
export function rebind(el, event, handler) {
  if (!el) return null;
  const clone = el.cloneNode(true);
  el.replaceWith(clone);
  renderIcons(clone);
  clone.addEventListener(event, handler);
  return clone;
}

// Minimal modal used for pairing codes, prompts, etc.
export function showModal(innerHtml) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.style.cssText =
    "position:fixed;inset:0;background:rgba(6,8,20,.72);display:flex;align-items:center;justify-content:center;z-index:999;padding:20px";
  const box = document.createElement("div");
  box.className = "card";
  box.style.cssText = "max-width:440px;width:100%;padding:22px";
  box.innerHTML = innerHtml;
  overlay.appendChild(box);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
  renderIcons(box);
  return { overlay, box, close: () => overlay.remove() };
}

let wsUser = null;

export async function initShell({ onNotification, onChanged } = {}) {
  Session.requireAuth();
  const me = await Session.api("GET", "/api/auth/me");
  if (!me) return null;
  applyUserChrome(me);
  wireLogout();
  await refreshNavCounts();
  connectUserWs({ onNotification, onChanged });
  return me;
}

export async function refreshNavCounts() {
  try {
    const [conf, notes] = await Promise.all([
      Session.api("GET", "/api/conflicts"),
      Session.api("GET", "/api/notifications"),
    ]);
    setNavCount("conflicts.html", conf?.length || 0);
    setNavCount("notifications.html", notes?.unread || 0);
    const dot = document.querySelector(".notification-dot");
    if (dot) dot.style.display = (notes?.unread || 0) > 0 ? "" : "none";
  } catch {}
}

function setNavCount(href, n) {
  document.querySelectorAll(`.nav-link[href="${href}"]`).forEach((link) => {
    let c = link.querySelector(".nav-count");
    if (n > 0) {
      if (!c) { c = document.createElement("span"); c.className = "nav-count"; link.appendChild(c); }
      c.textContent = n;
    } else if (c) {
      c.remove();
    }
  });
}

function wireLogout() {
  document.querySelectorAll("[data-logout]").forEach((btn) =>
    rebind(btn, "click", (e) => { e.preventDefault(); Session.logout(); }));
}

function connectUserWs({ onNotification, onChanged }) {
  if (!Session.token) return;
  try {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    wsUser = new WebSocket(`${proto}://${location.host}/ws/user?token=${encodeURIComponent(Session.token)}`);
    wsUser.addEventListener("message", (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.type === "notification") {
        toast(msg.notification?.title || "New notification");
        refreshNavCounts();
        onNotification?.(msg.notification);
      } else if (msg.type === "changed") {
        onChanged?.(msg);
      }
    });
  } catch {}
}
