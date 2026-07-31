import { Session, initShell, rebind, toast } from "/js/app-shell.js";

const me = await initShell();

// Populate account email + webhook from the server.
if (me) {
  const emailInput = document.querySelector('#general input[value], #general .form-group:nth-child(2) input');
  document.querySelectorAll('#general input').forEach((inp) => {
    const label = inp.closest(".form-group")?.querySelector("label")?.textContent?.toLowerCase() || "";
    if (label.includes("email")) inp.value = me.email;
  });
  const webhook = document.querySelector("#webhook-url");
  if (webhook) webhook.value = me.notify_webhook_url || "";
}

// "Save changes" persists the webhook URL (the only server-backed setting for now).
rebind(document.querySelector(".heading-actions .btn"), "click", async (e) => {
  e.preventDefault();
  const url = document.querySelector("#webhook-url")?.value?.trim() || null;
  const res = await Session.api("PUT", "/api/auth/me/notify-webhook", { url });
  toast(res ? "Settings saved" : "Could not save");
});
