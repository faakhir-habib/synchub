import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";

/**
 * Full-screen, chrome-free layout for /login and /signup — deliberately NOT
 * nested inside AppShell (see router.tsx: these routes are siblings of the
 * "_app" layout route, not children of it).
 */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-12">
      {/* ambient glow, matches the dashboard's dark-mode atmosphere */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "radial-gradient(circle at 18% 18%, hsl(var(--primary) / 0.20), transparent 42%), " +
            "radial-gradient(circle at 84% 88%, hsl(var(--info) / 0.14), transparent 40%)",
        }}
      />
      {/* faint technical grid texture */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.035] dark:opacity-[0.05]"
        style={{
          backgroundImage:
            "linear-gradient(hsl(var(--foreground)) 1px, transparent 1px), " +
            "linear-gradient(90deg, hsl(var(--foreground)) 1px, transparent 1px)",
          backgroundSize: "44px 44px",
        }}
      />

      <div className="relative z-10 flex w-full max-w-sm flex-col items-center gap-8">
        <Link to="/" className="flex flex-col items-center gap-3 text-center">
          <SyncMark />
          <div>
            <div className="font-display text-xl font-extrabold tracking-tight text-foreground">
              SyncHub
            </div>
            <div className="font-mono text-[10px] font-medium uppercase tracking-[0.24em] text-muted-foreground">
              Multi-machine sync
            </div>
          </div>
        </Link>
        {children}
      </div>
    </div>
  );
}

function SyncMark() {
  return (
    <svg width="44" height="44" viewBox="0 0 44 44" fill="none" aria-hidden="true">
      <rect width="44" height="44" rx="12" fill="url(#synchub-mark-gradient)" />
      <path
        d="M13.5 20a8.5 8.5 0 0 1 14.3-6.1M30.5 24a8.5 8.5 0 0 1-14.3 6.1"
        stroke="white"
        strokeWidth="2.4"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M25.3 11.9 28.4 13.6 27 17"
        stroke="white"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <path
        d="M18.7 32.1 15.6 30.4 17 27"
        stroke="white"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <defs>
        <linearGradient
          id="synchub-mark-gradient"
          x1="0"
          y1="0"
          x2="44"
          y2="44"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="hsl(var(--primary))" />
          <stop offset="1" stopColor="hsl(var(--info))" />
        </linearGradient>
      </defs>
    </svg>
  );
}
