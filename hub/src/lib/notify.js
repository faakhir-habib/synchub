import * as notifications from "../models/notifications.js";
import * as users from "../models/users.js";

// Records a notification, pushes it live over WS, and best-effort relays it to
// the user's personal webhook (never blocks or throws on webhook failure).
export function notifyUser(db, realtime, { user_id, type, title, body = null }) {
  const user = users.findById(db, user_id);
  // Respect the user's notification preferences.
  if (type === "conflict" && user?.notify_conflicts === 0) return null;
  if (type === "sync" && user?.notify_sync === 0) return null;

  const note = notifications.record(db, { user_id, type, title, body });
  realtime?.pushNotification(user_id, note);

  if (user?.notify_webhook_url) {
    fetch(user.notify_webhook_url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type, title, body, at: new Date().toISOString() }),
    }).catch(() => {});
  }
  return note;
}
