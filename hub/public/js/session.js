// Minimal client session helper used by every page.
export const Session = {
  get token() { return localStorage.getItem("synchub_token"); },
  set token(v) { v ? localStorage.setItem("synchub_token", v) : localStorage.removeItem("synchub_token"); },
  async api(method, path, body) {
    const res = await fetch(path, {
      method,
      headers: {
        "content-type": "application/json",
        ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401) { location.href = "/login.html"; return null; }
    const t = await res.text();
    return t ? JSON.parse(t) : null;
  },
  requireAuth() { if (!this.token) location.href = "/login.html"; },
  async logout() {
    try { await this.api("POST", "/api/auth/logout"); } catch {}
    this.token = null;
    location.href = "/login.html";
  },
};

// Fills common chrome (sidebar/topbar user name + avatar initials) from /me.
export function applyUserChrome(me) {
  if (!me) return;
  const initials = me.email.slice(0, 2).toUpperCase();
  document.querySelectorAll(".avatar").forEach((el) => { el.textContent = initials; });
  document.querySelectorAll(".user-chip strong, .sidebar-bottom .nav-link > span")
    .forEach((el) => { el.textContent = me.email; });
}
