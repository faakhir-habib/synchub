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

// Display name = the user's set name, else the part before @ in their email.
export function displayName(me) {
  const n = (me?.name || "").trim();
  if (n) return n;
  return (me?.email || "").split("@")[0] || "Account";
}

// Fills common chrome (sidebar/topbar name + avatar initials, chip email) from /me.
export function applyUserChrome(me) {
  if (!me) return;
  const name = displayName(me);
  const initials = name.replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase() || "U";
  document.querySelectorAll(".avatar, .profile-avatar").forEach((el) => { el.textContent = initials; });
  // Topbar chip: bold name + email subtitle
  document.querySelectorAll(".user-chip .user-meta strong").forEach((el) => { el.textContent = name; });
  document.querySelectorAll(".user-chip .user-meta span").forEach((el) => { el.textContent = me.email; });
  // Sidebar bottom link: just the name
  document.querySelectorAll(".sidebar-bottom .nav-link > span").forEach((el) => { el.textContent = name; });
}
