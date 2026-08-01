import { useState } from "react";
import { Outlet } from "@tanstack/react-router";
import { Sidebar } from "./Sidebar.js";
import { Topbar } from "./Topbar.js";

// The shell mounts ONCE. Navigating between routes swaps only <Outlet/> —
// no full page reload, no WebSocket teardown. This is the structural fix
// for the old multi-page full-refresh behavior.
export function AppShell() {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      <Sidebar open={mobileNavOpen} onClose={() => setMobileNavOpen(false)} />

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onMenuClick={() => setMobileNavOpen(true)} />
        <main className="flex-1 overflow-y-auto px-4 py-6 sm:px-6 lg:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
