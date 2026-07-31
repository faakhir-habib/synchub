import { Session, initShell, esc } from "/js/app-shell.js";

const me = await initShell();
if (me) {
  const name = me.email.split("@")[0];
  document.querySelectorAll(".profile-name h2").forEach((el) => (el.textContent = name));
  document.querySelectorAll(".profile-avatar").forEach((el) => (el.textContent = me.email.slice(0, 2).toUpperCase()));
  document.querySelectorAll("#general input, .card-body input").forEach((inp) => {
    const label = inp.closest(".form-group")?.querySelector("label")?.textContent?.toLowerCase() || "";
    if (label.includes("email")) inp.value = me.email;
  });

  // Add a Log out button to the heading actions.
  const actions = document.querySelector(".heading-actions");
  if (actions) {
    const btn = document.createElement("button");
    btn.className = "btn btn-secondary";
    btn.textContent = "Log out";
    btn.addEventListener("click", () => Session.logout());
    actions.prepend(btn);
  }
  void esc;
}
