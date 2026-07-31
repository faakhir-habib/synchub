import { Session, applyUserChrome } from "/js/session.js";
import { initShell, toast } from "/js/app-shell.js";

const me = await initShell();

if (me) {
  const nameEl = document.querySelector("#setting-name");
  const emailEl = document.querySelector("#setting-email");
  const webhookEl = document.querySelector("#webhook-url");
  if (nameEl) nameEl.value = me.name || "";
  if (emailEl) emailEl.value = me.email;
  if (webhookEl) webhookEl.value = me.notify_webhook_url || "";
}

const saveBtn = document.querySelector("#settings-save");
saveBtn?.addEventListener("click", async (e) => {
  e.preventDefault();
  const name = document.querySelector("#setting-name")?.value?.trim() || null;
  const url = document.querySelector("#webhook-url")?.value?.trim() || null;
  const res = await Session.api("PUT", "/api/auth/me", { name, notify_webhook_url: url });
  if (res) {
    toast("Settings saved");
    applyUserChrome(res); // reflect the new name immediately in the sidebar/topbar
  } else {
    toast("Could not save");
  }
});
