import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { toastMock } = vi.hoisted(() => ({ toastMock: vi.fn() }));

vi.mock("sonner", () => ({
  toast: toastMock,
  Toaster: () => null,
}));

vi.mock("../auth/auth-context.js", () => ({
  useAuth: () => ({
    token: "test-token",
    user: null,
    isLoading: false,
    login: vi.fn(),
    signup: vi.fn(),
    logout: vi.fn(),
  }),
}));

// Imported after the mocks above so they pick up the mocked modules.
import { RealtimeProvider } from "./realtime-provider.js";
import { usePresence } from "./presence-store.js";
import { useProjectProgress } from "./progress-store.js";

/** Records url + wired handlers; test drives it via emitOpen/emitMessage/emitClose. */
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  url: string;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  closed = false;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  close() {
    this.closed = true;
  }

  emitOpen() {
    this.onopen?.();
  }

  emitMessage(obj: unknown) {
    this.onmessage?.({ data: JSON.stringify(obj) });
  }

  emitClose() {
    this.onclose?.();
  }
}

function latestSocket(): FakeWebSocket {
  const sock = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
  if (!sock) throw new Error("no FakeWebSocket instance constructed yet");
  return sock;
}

function PresenceProbe({ machineId }: { machineId: number }) {
  const presence = usePresence(machineId);
  return <span data-testid="presence">{presence ? presence.status : "unknown"}</span>;
}

function ProgressProbe({ projectId }: { projectId: number }) {
  const progress = useProjectProgress(projectId);
  return (
    <span data-testid="progress">
      {progress ? `${progress.phase}:${progress.completed}/${progress.total}` : "idle"}
    </span>
  );
}

function renderProvider(qc: QueryClient) {
  return render(
    <QueryClientProvider client={qc}>
      <RealtimeProvider>
        <PresenceProbe machineId={5} />
        <ProgressProbe projectId={3} />
      </RealtimeProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  FakeWebSocket.instances = [];
  toastMock.mockReset();
  vi.stubGlobal("WebSocket", FakeWebSocket);
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("RealtimeProvider", () => {
  it("opens a websocket to /ws/user with the auth token on mount", () => {
    const qc = new QueryClient();
    renderProvider(qc);

    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(latestSocket().url).toContain("/ws/user?token=test-token");
    expect(latestSocket().url.startsWith("ws://") || latestSocket().url.startsWith("wss://")).toBe(
      true,
    );
  });

  it("updates the presence store on a presence message", () => {
    const qc = new QueryClient();
    renderProvider(qc);

    expect(screen.getByTestId("presence").textContent).toBe("unknown");

    act(() => {
      latestSocket().emitMessage({
        type: "presence",
        machineId: 5,
        status: "online",
        lastSeenAt: null,
      });
    });

    expect(screen.getByTestId("presence").textContent).toBe("online");
  });

  it("invalidates the project + dashboard queries on a changed message", () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, "invalidateQueries");
    renderProvider(qc);
    spy.mockClear(); // no-op here (emitOpen was never called) — just keeps this test order-independent

    act(() => {
      latestSocket().emitMessage({
        type: "changed",
        projectId: 3,
        filename: "a.txt",
        hash: "h",
      });
    });

    const calledKeys = spy.mock.calls.map((call) => call[0]?.queryKey);
    expect(calledKeys).toContainEqual(["projects", 3]);
    expect(calledKeys).toContainEqual(["projects", 3, "conflicts"]);
    expect(calledKeys).toContainEqual(["dashboard", "metrics"]);
    expect(calledKeys).toContainEqual(["dashboard", "activity"]);
  });

  it("invalidates the project + dashboard queries on a deleted message", () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, "invalidateQueries");
    renderProvider(qc);
    spy.mockClear();

    act(() => {
      latestSocket().emitMessage({
        type: "deleted",
        projectId: 3,
        filename: "a.txt",
      });
    });

    const calledKeys = spy.mock.calls.map((call) => call[0]?.queryKey);
    expect(calledKeys).toContainEqual(["projects", 3]);
    expect(calledKeys).toContainEqual(["projects", 3, "conflicts"]);
    expect(calledKeys).toContainEqual(["dashboard", "metrics"]);
    expect(calledKeys).toContainEqual(["dashboard", "activity"]);
  });

  it("updates the progress store on a sync-progress message, and clears it on sync-complete", () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, "invalidateQueries");
    renderProvider(qc);
    spy.mockClear();

    expect(screen.getByTestId("progress").textContent).toBe("idle");

    act(() => {
      latestSocket().emitMessage({
        type: "sync-progress",
        projectId: 3,
        machineId: 5,
        filename: "notes.md",
        completed: 2,
        total: 5,
        phase: "push",
      });
    });

    expect(screen.getByTestId("progress").textContent).toBe("push:2/5");

    act(() => {
      latestSocket().emitMessage({
        type: "sync-complete",
        projectId: 3,
        machineId: 5,
        at: new Date().toISOString(),
      });
    });

    expect(screen.getByTestId("progress").textContent).toBe("idle");
    const calledKeys = spy.mock.calls.map((call) => call[0]?.queryKey);
    expect(calledKeys).toContainEqual(["projects", 3]);
    expect(calledKeys).toContainEqual(["projects", 3, "conflicts"]);
    expect(calledKeys).toContainEqual(["dashboard", "metrics"]);
    expect(calledKeys).toContainEqual(["dashboard", "activity"]);
  });

  it("toasts and invalidates notifications on a notification message", () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, "invalidateQueries");
    renderProvider(qc);
    spy.mockClear();

    act(() => {
      latestSocket().emitMessage({
        type: "notification",
        notification: { type: "sync", title: "t" },
      });
    });

    const calledKeys = spy.mock.calls.map((call) => call[0]?.queryKey);
    expect(calledKeys).toContainEqual(["notifications"]);
    expect(toastMock).toHaveBeenCalledWith("t");
  });

  it("toasts on a conflict message and invalidates conflicts", () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, "invalidateQueries");
    renderProvider(qc);
    spy.mockClear();

    act(() => {
      latestSocket().emitMessage({
        type: "conflict",
        projectId: 3,
        filename: "b.txt",
        conflictId: 9,
      });
    });

    const calledKeys = spy.mock.calls.map((call) => call[0]?.queryKey);
    expect(calledKeys).toContainEqual(["conflicts"]);
    expect(calledKeys).toContainEqual(["projects", 3, "conflicts"]);
    expect(toastMock).toHaveBeenCalledWith("Conflict in b.txt");
  });

  it("does a full catch-up invalidateQueries() with no args on open", () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, "invalidateQueries");
    renderProvider(qc);

    act(() => {
      latestSocket().emitOpen();
    });

    const noArgCalls = spy.mock.calls.filter((call) => call.length === 0);
    expect(noArgCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("reconnects with exponential backoff after the socket closes, and resets on a successful open", () => {
    const qc = new QueryClient();
    renderProvider(qc);
    expect(FakeWebSocket.instances).toHaveLength(1);

    // First close, never opened: base backoff (1s).
    act(() => latestSocket().emitClose());
    act(() => vi.advanceTimersByTime(999));
    expect(FakeWebSocket.instances).toHaveLength(1);
    act(() => vi.advanceTimersByTime(1));
    expect(FakeWebSocket.instances).toHaveLength(2);

    // Second close, also never opened: backoff doubles (2s) since attempt
    // counter incremented and was never reset by a successful open.
    act(() => latestSocket().emitClose());
    act(() => vi.advanceTimersByTime(1999));
    expect(FakeWebSocket.instances).toHaveLength(2);
    act(() => vi.advanceTimersByTime(1));
    expect(FakeWebSocket.instances).toHaveLength(3);

    // A successful open resets the attempt counter — next close backs off
    // from the base again, not from where it left off.
    act(() => latestSocket().emitOpen());
    act(() => latestSocket().emitClose());
    act(() => vi.advanceTimersByTime(999));
    expect(FakeWebSocket.instances).toHaveLength(3);
    act(() => vi.advanceTimersByTime(1));
    expect(FakeWebSocket.instances).toHaveLength(4);
  });

  it("closes the socket and schedules no further reconnect on unmount", () => {
    const qc = new QueryClient();
    const { unmount } = renderProvider(qc);
    const first = latestSocket();

    // Trigger a pending reconnect timer, then unmount before it fires.
    act(() => first.emitClose());
    act(() => unmount());

    expect(first.closed).toBe(true);

    act(() => vi.advanceTimersByTime(60_000));
    expect(FakeWebSocket.instances).toHaveLength(1);
  });
});
