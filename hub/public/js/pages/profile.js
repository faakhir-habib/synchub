import { Session, applyUserChrome, displayName } from "/js/session.js";
import { initShell, toast, rebind } from "/js/app-shell.js";

const me = await initShell();
if (me) {
  const name = displayName(me);
  document.querySelectorAll(".profile-name h2").forEach((el) => (el.textContent = name));
  document.querySelectorAll(".profile-name p").forEach((el) => (el.textContent = me.email));

  // Fill form inputs by their label.
  const inputs = document.querySelectorAll(".card-body input");
  inputs.forEach((inp) => {
    const label = inp.closest(".form-group")?.querySelector("label")?.textContent?.toLowerCase() || "";
    if (label.includes("email")) inp.value = me.email;
    else if (label.includes("name")) inp.value = me.name || "";
  });

  // Save changes -> persist the name.
  rebind(document.querySelector(".heading-actions .btn"), "click", async (e) => {
    e.preventDefault();
    let name = null;
    inputs.forEach((inp) => {
      const label = inp.closest(".form-group")?.querySelector("label")?.textContent?.toLowerCase() || "";
      if (label.includes("full name") || label === "name") name = inp.value.trim() || null;
    });
    const res = await Session.api("PUT", "/api/auth/me", { name });
    if (res) { toast("Profile saved"); applyUserChrome(res); document.querySelectorAll(".profile-name h2").forEach((el) => (el.textContent = displayName(res))); }
    else toast("Could not save");
  });

  // Fill real Workspace-access counts (Role / Projects / Machines).
  const [projects, machines] = await Promise.all([
    Session.api("GET", "/api/projects"),
    Session.api("GET", "/api/machines"),
  ]);
  document.querySelectorAll(".stack .card .status-row").forEach((row) => {
    const label = row.querySelector(".status-label")?.textContent?.toLowerCase() || "";
    const val = row.querySelector("span:last-child");
    if (!val) return;
    if (label.includes("role")) val.textContent = "Owner";
    else if (label.includes("project")) val.textContent = (projects || []).length;
    else if (label.includes("machine")) val.textContent = (machines || []).length;
  });

  // Add a Log out button.
  const actions = document.querySelector(".heading-actions");
  if (actions && !actions.querySelector("[data-logout]")) {
    const btn = document.createElement("button");
    btn.className = "btn btn-secondary";
    btn.setAttribute("data-logout", "");
    btn.textContent = "Log out";
    btn.addEventListener("click", () => Session.logout());
    actions.prepend(btn);
  }
}
