import { describe, it, expect } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { setPresence, useAllPresence, usePresence } from "./presence-store.js";

function AllPresenceProbe() {
  const all = useAllPresence();
  return <span data-testid="all">{JSON.stringify(all)}</span>;
}

function OnePresenceProbe({ machineId }: { machineId: number }) {
  const presence = usePresence(machineId);
  return <span data-testid="one">{presence ? presence.status : "unknown"}</span>;
}

describe("presence-store", () => {
  it("useAllPresence re-renders on every setPresence call (stable-but-fresh snapshot identity)", () => {
    render(<AllPresenceProbe />);

    act(() => {
      setPresence(101, { status: "online", lastSeenAt: "2026-01-01T00:00:00Z" });
    });
    act(() => {
      setPresence(102, { status: "offline", lastSeenAt: null });
    });

    const rendered = JSON.parse(screen.getByTestId("all").textContent ?? "{}");
    expect(rendered["101"]).toEqual({ status: "online", lastSeenAt: "2026-01-01T00:00:00Z" });
    expect(rendered["102"]).toEqual({ status: "offline", lastSeenAt: null });
  });

  it("getSnapshot returns a NEW object identity after a mutation (required by useSyncExternalStore)", () => {
    const captured: unknown[] = [];
    function SnapshotCapture() {
      const all = useAllPresence();
      captured.push(all);
      return null;
    }

    render(<SnapshotCapture />);
    const before = captured[captured.length - 1];

    act(() => {
      setPresence(201, { status: "online", lastSeenAt: null });
    });

    const after = captured[captured.length - 1];
    expect(after).not.toBe(before);
  });

  it("usePresence reflects updates for its own machineId", () => {
    render(<OnePresenceProbe machineId={301} />);
    expect(screen.getByTestId("one").textContent).toBe("unknown");

    act(() => {
      setPresence(301, { status: "online", lastSeenAt: null });
    });

    expect(screen.getByTestId("one").textContent).toBe("online");
  });
});
