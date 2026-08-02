import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { connectWs, type WsFactory, type WsLike } from "./ws.js";

/** A fake WebSocket-like object whose event handlers we can invoke manually. */
function makeFakeWs() {
  const handlers = new Map<string, ((...args: unknown[]) => void)[]>();
  const closeSpy = vi.fn();
  const fake: WsLike & {
    emit(event: string, ...args: unknown[]): void;
  } = {
    on(event: string, cb: (...args: unknown[]) => void) {
      const list = handlers.get(event) ?? [];
      list.push(cb);
      handlers.set(event, list);
      return fake;
    },
    close: closeSpy,
    emit(event: string, ...args: unknown[]): void {
      for (const cb of handlers.get(event) ?? []) cb(...args);
    },
  };
  return fake;
}

describe("connectWs", () => {
  let log: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    log = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("connects to ws://<host>/ws/agent?token=<machineToken> derived from an http hubUrl", () => {
    const urls: string[] = [];
    const sockets: ReturnType<typeof makeFakeWs>[] = [];
    const wsFactory: WsFactory = (url: string) => {
      urls.push(url);
      const s = makeFakeWs();
      sockets.push(s);
      return s;
    };

    const onMessage = vi.fn();
    const handle = connectWs(
      { hubUrl: "http://hub.example.com:8080", machineToken: "tok en/1" },
      { onMessage, log, wsFactory },
    );

    expect(urls).toHaveLength(1);
    expect(urls[0]).toBe(`ws://hub.example.com:8080/ws/agent?token=${encodeURIComponent("tok en/1")}`);

    handle.close();
  });

  it("derives wss:// from an https hubUrl", () => {
    const urls: string[] = [];
    const wsFactory: WsFactory = (url: string) => {
      urls.push(url);
      return makeFakeWs();
    };

    const handle = connectWs(
      { hubUrl: "https://hub.example.com", machineToken: "tok" },
      { onMessage: vi.fn(), log, wsFactory },
    );

    expect(urls[0]).toBe(`wss://hub.example.com/ws/agent?token=tok`);
    handle.close();
  });

  it("fires onOpen on every (re)connect, not just the first", async () => {
    const sockets: ReturnType<typeof makeFakeWs>[] = [];
    const wsFactory: WsFactory = () => {
      const s = makeFakeWs();
      sockets.push(s);
      return s;
    };
    const onOpen = vi.fn();

    const handle = connectWs(
      { hubUrl: "http://hub", machineToken: "tok" },
      { onMessage: vi.fn(), onOpen, log, wsFactory },
    );

    sockets[0]!.emit("open");
    expect(onOpen).toHaveBeenCalledTimes(1);

    // Unexpected close triggers a scheduled reconnect.
    sockets[0]!.emit("close");
    await vi.advanceTimersByTimeAsync(1000);
    expect(sockets).toHaveLength(2);

    sockets[1]!.emit("open");
    expect(onOpen).toHaveBeenCalledTimes(2);

    handle.close();
  });

  it("parses a valid frame and forwards it to onMessage", () => {
    const sockets: ReturnType<typeof makeFakeWs>[] = [];
    const wsFactory: WsFactory = () => {
      const s = makeFakeWs();
      sockets.push(s);
      return s;
    };
    const onMessage = vi.fn();

    const handle = connectWs(
      { hubUrl: "http://hub", machineToken: "tok" },
      { onMessage, log, wsFactory },
    );

    const frame = { type: "welcome", machineId: 5 };
    sockets[0]!.emit("message", JSON.stringify(frame));

    expect(onMessage).toHaveBeenCalledWith(frame);
    handle.close();
  });

  it("guards a malformed/non-JSON frame: no throw, logs, onMessage not called", () => {
    const sockets: ReturnType<typeof makeFakeWs>[] = [];
    const wsFactory: WsFactory = () => {
      const s = makeFakeWs();
      sockets.push(s);
      return s;
    };
    const onMessage = vi.fn();

    const handle = connectWs(
      { hubUrl: "http://hub", machineToken: "tok" },
      { onMessage, log, wsFactory },
    );

    expect(() => sockets[0]!.emit("message", "{not json")).not.toThrow();
    expect(onMessage).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalled();

    handle.close();
  });

  it("guards a well-formed JSON frame that fails the shared WsMessage schema: onMessage not called", () => {
    const sockets: ReturnType<typeof makeFakeWs>[] = [];
    const wsFactory: WsFactory = () => {
      const s = makeFakeWs();
      sockets.push(s);
      return s;
    };
    const onMessage = vi.fn();

    const handle = connectWs(
      { hubUrl: "http://hub", machineToken: "tok" },
      { onMessage, log, wsFactory },
    );

    sockets[0]!.emit("message", JSON.stringify({ type: "not-a-real-type", foo: 1 }));

    expect(onMessage).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalled();

    handle.close();
  });

  it("reconnects on unexpected close with exponential backoff capped at 30s, resetting to base after a stable open", async () => {
    const sockets: ReturnType<typeof makeFakeWs>[] = [];
    const wsFactory: WsFactory = () => {
      const s = makeFakeWs();
      sockets.push(s);
      return s;
    };

    const handle = connectWs(
      { hubUrl: "http://hub", machineToken: "tok" },
      { onMessage: vi.fn(), log, wsFactory },
    );

    expect(sockets).toHaveLength(1);

    // First unexpected close -> reconnect after ~1000ms (base).
    sockets[0]!.emit("close");
    await vi.advanceTimersByTimeAsync(999);
    expect(sockets).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(sockets).toHaveLength(2);

    // Second unexpected close (without an intervening open) -> ~2000ms.
    sockets[1]!.emit("close");
    await vi.advanceTimersByTimeAsync(1999);
    expect(sockets).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(sockets).toHaveLength(3);

    // Third unexpected close -> ~4000ms.
    sockets[2]!.emit("close");
    await vi.advanceTimersByTimeAsync(3999);
    expect(sockets).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(sockets).toHaveLength(4);

    // A stable open resets the delay back to base (~1000ms).
    sockets[3]!.emit("open");
    sockets[3]!.emit("close");
    await vi.advanceTimersByTimeAsync(999);
    expect(sockets).toHaveLength(4);
    await vi.advanceTimersByTimeAsync(1);
    expect(sockets).toHaveLength(5);

    handle.close();
  });

  it("caps backoff delay at 30s", async () => {
    const sockets: ReturnType<typeof makeFakeWs>[] = [];
    const wsFactory: WsFactory = () => {
      const s = makeFakeWs();
      sockets.push(s);
      return s;
    };

    const handle = connectWs(
      { hubUrl: "http://hub", machineToken: "tok" },
      { onMessage: vi.fn(), log, wsFactory },
    );

    // Drive several unexpected closes without an open in between:
    // 1000, 2000, 4000, 8000, 16000, then capped at 30000.
    const delays = [1000, 2000, 4000, 8000, 16000, 30000, 30000];
    for (const delay of delays) {
      const before = sockets.length;
      sockets[sockets.length - 1]!.emit("close");
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(sockets).toHaveLength(before);
      await vi.advanceTimersByTimeAsync(1);
      expect(sockets).toHaveLength(before + 1);
    }

    handle.close();
  });

  it("intentional close() suppresses reconnect", async () => {
    const sockets: ReturnType<typeof makeFakeWs>[] = [];
    const wsFactory: WsFactory = () => {
      const s = makeFakeWs();
      sockets.push(s);
      return s;
    };

    const handle = connectWs(
      { hubUrl: "http://hub", machineToken: "tok" },
      { onMessage: vi.fn(), log, wsFactory },
    );

    handle.close();
    expect(sockets[0]!.close).toHaveBeenCalledTimes(1);

    // Simulate the underlying socket firing 'close' as a result of our own close() call.
    sockets[0]!.emit("close");
    await vi.advanceTimersByTimeAsync(60000);

    expect(sockets).toHaveLength(1);
  });
});
