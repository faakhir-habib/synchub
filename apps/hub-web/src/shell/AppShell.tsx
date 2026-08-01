import { Link, Outlet } from "@tanstack/react-router";

// The shell mounts ONCE. Navigating between routes swaps only <Outlet/> —
// no full page reload, no WebSocket teardown. This is the structural fix
// for the old multi-page full-refresh behavior.
export function AppShell() {
  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <aside style={{ width: 220, padding: 16, background: "#0f1222", color: "#fff" }}>
        <strong>SyncHub</strong>
        <nav style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 16 }}>
          <Link to="/">Dashboard</Link>
          <Link to="/projects">Projects</Link>
        </nav>
      </aside>
      <main style={{ flex: 1, padding: 24 }}>
        <Outlet />
      </main>
    </div>
  );
}
