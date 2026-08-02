import { Session, initShell, timeAgo, esc, renderIcons, rebind, toast, showModal, modalConfirm } from "/js/app-shell.js";

await initShell();
await load();

// "Connect machine" -> issue a pairing code
rebind(document.querySelector(".heading-actions .btn:last-child"), "click", async (e) => {
  e.preventDefault();
  const res = await Session.api("POST", "/api/machines/pair");
  if (!res?.code) { toast("Could not create pairing code"); return; }
  showModal(`
    <div class="card-head"><div><h3>Pair a new machine</h3><p>Run the agent on the other machine and enter this code.</p></div></div>
    <div style="font-size:34px;font-weight:700;letter-spacing:6px;text-align:center;margin:18px 0">${esc(res.code)}</div>
    <p class="form-note" style="text-align:center">Expires in ${Math.round((res.expires_in || 600) / 60)} minutes.</p>`);
});

// "Refresh"
rebind(document.querySelector(".heading-actions .btn.btn-secondary"), "click", (e) => { e.preventDefault(); load(); });

function icon(m) {
  const os = (m.os || "").toLowerCase();
  if (os.includes("mac") || os.includes("darwin")) return "laptop";
  if (os.includes("linux") || os.includes("ubuntu") || os.includes("server")) return "server";
  return "monitor";
}

async function load() {
  const machines = await Session.api("GET", "/api/machines");
  if (!machines) return;

  const online = machines.filter((m) => m.status === "online").length;
  const cards = document.querySelectorAll(".stats-grid .stat-card .stat-value");
  if (cards[0]) cards[0].textContent = machines.length;

  const grid = document.querySelector(".machine-grid");
  if (!grid) return;
  grid.innerHTML = "";
  if (!machines.length) {
    grid.innerHTML = '<div class="card" style="grid-column:1/-1"><div class="empty-state">No machines yet. Click “Connect machine” to pair one.</div></div>';
    return;
  }
  for (const m of machines) {
    const on = m.status === "online";
    const card = document.createElement("div");
    card.className = "card machine-card";
    card.innerHTML = `
      <div class="machine-top">
        <div class="machine-device"><div class="machine-icon"><svg data-icon="${icon(m)}"></svg></div>
          <div><strong>${esc(m.name)}</strong><span>${esc(m.os || "unknown")}${m.label ? " · " + esc(m.label) : ""}</span></div></div>
        <span class="badge ${on ? "badge-green" : "badge-neutral"}">${on ? "Online" : "Offline"}</span>
      </div>
      <div class="machine-meta">
        <div><span>Agent</span><strong>${esc(m.agent_version || "—")}</strong></div>
        <div><span>Last seen</span><strong>${timeAgo(m.last_seen_at)}</strong></div>
        <div><span>IP</span><strong>${esc(m.last_ip || "—")}</strong></div>
        <div><span>Status</span><strong>${esc(m.status)}</strong></div>
      </div>
      <div style="margin-top:14px;display:flex;justify-content:flex-end">
        <button class="btn btn-secondary btn-sm" data-del="${m.id}"><svg data-icon="trash"></svg>Remove</button>
      </div>`;
    card.querySelector("[data-del]").addEventListener("click", async () => {
      const ok = await modalConfirm({ title: `Remove “${m.name}”?`, message: "Its agent token stops working. You can re-pair it later.", confirmLabel: "Remove", danger: true });
      if (!ok) return;
      await Session.api("DELETE", `/api/machines/${m.id}`);
      toast("Machine removed"); load();
    });
    grid.appendChild(card);
  }
  renderIcons(grid);
  void online;
}
