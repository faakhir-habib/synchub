import { Session, applyUserChrome } from "/js/session.js";
import { initShell, toast } from "/js/app-shell.js";

const me = await initShell();

const nameEl = document.querySelector("#setting-name");
const emailEl = document.querySelector("#setting-email");
const webhookEl = document.querySelector("#webhook-url");
const tConflicts = document.querySelector("#toggle-conflicts");
const tSync = document.querySelector("#toggle-sync");

if (me) {
  if (nameEl) nameEl.value = me.name || "";
  if (emailEl) emailEl.value = me.email;
  if (webhookEl) webhookEl.value = me.notify_webhook_url || "";
  // Toggles: app.js flips `.on` on click; we set the initial state here.
  tConflicts?.classList.toggle("on", me.notify_conflicts !== false);
  tSync?.classList.toggle("on", me.notify_sync !== false);
}

const saveBtn = document.querySelector("#settings-save");
saveBtn?.addEventListener("click", async (e) => {
  e.preventDefault();
  const payload = {
    name: nameEl?.value?.trim() || null,
    notify_webhook_url: webhookEl?.value?.trim() || null,
    notify_conflicts: !!tConflicts?.classList.contains("on"),
    notify_sync: !!tSync?.classList.contains("on"),
  };
  const res = await Session.api("PUT", "/api/auth/me", payload);
  if (res) { toast("Settings saved"); applyUserChrome(res); }
  else toast("Could not save");
});
