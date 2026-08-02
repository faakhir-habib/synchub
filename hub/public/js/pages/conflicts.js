import { Session, initShell, timeAgo, esc, renderIcons, toast } from "/js/app-shell.js";

await initShell({ onNotification: load });
await load();

async function load() {
  const conflicts = await Session.api("GET", "/api/conflicts");
  const shell = document.querySelector(".conflict-shell");
  if (!shell) return;

  if (!conflicts || !conflicts.length) {
    shell.innerHTML = `
      <div class="card"><div class="card-body" style="text-align:center;padding:48px">
        <div class="activity-icon" style="margin:0 auto 14px"><svg data-icon="check"></svg></div>
        <h2>No open conflicts</h2>
        <p class="form-note">Diverging transcripts are auto-merged when possible; anything that needs your call shows up here.</p>
      </div></div>`;
    renderIcons(shell);
    return;
  }

  shell.innerHTML = "";
  for (const c of conflicts) {
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <div class="conflict-titlebar">
        <div class="file-path"><div class="item-icon"><svg data-icon="file"></svg></div>
          <div><strong>${esc(c.filename)}</strong><span>${esc(c.project_alias)} · detected ${timeAgo(c.created_at)}</span></div></div>
        <span class="badge badge-red">Unresolved</span>
      </div>
      <div class="card-body">
        <p class="form-note" style="margin-bottom:14px">This transcript diverged in a way that couldn't be auto-merged (a line was rewritten, not just appended). Choose which version becomes canonical for every machine.</p>
        <div class="resolve-options">
          <div class="resolve-option"><strong>Keep the pushed version</strong><p>Promote the version from the machine that just pushed.</p>
            <button class="btn btn-sm" data-resolve="candidate">Keep pushed</button></div>
          <div class="resolve-option"><strong>Keep the current version</strong><p>Discard the pushed candidate; keep what the Hub already has.</p>
            <button class="btn btn-secondary btn-sm" data-resolve="canonical">Keep current</button></div>
        </div>
      </div>`;
    card.querySelectorAll("[data-resolve]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const res = await Session.api("POST", `/api/projects/${c.project_id}/conflicts/${c.id}/resolve`, { choice: btn.dataset.resolve });
        if (res?.status === "resolved") { toast(`Resolved — kept ${res.choice}`); load(); }
        else toast(res?.error || "Could not resolve");
      }));
    shell.appendChild(card);
  }
  renderIcons(shell);
}
