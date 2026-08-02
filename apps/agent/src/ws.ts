// Persistent agent WebSocket connection to the Hub's live relay. Ports
// legacy `agent/src/ws.js` with fixes from the agent audit:
//   - onOpen fires on EVERY (re)connect (not just the first), so the agent
//     can drive a reconnect catch-up reconcile (audit #9) from the caller.
//   - guarded JSON parse PLUS shared-schema validation: a malformed frame
//     or one that doesn't match the shared WsMessage union is logged and
//     dropped rather than forwarded as untyped garbage.
//   - exponential backoff (base 1s, cap 30s), reset to base only after a
//     STABLE open (the socket stays open for STABLE_MS) — a socket that
//     opens then immediately closes (a "flap") must NOT reset the delay,
//     or a repeatedly-rejected connection (e.g. a revoked token) would
//     reconnect every ~1s forever instead of escalating. Same overall
//     shape as legacy but made explicit/testable via an injectable
//     wsFactory + Vitest fake timers.
//   - intentional close() sets a flag so the underlying socket's 'close'
//     event never schedules a reconnect after a deliberate shutdown.
import WebSocket from "ws";

import { WsMessage } from "@synchub/shared";

/** Minimal shape needed from a WebSocket instance — satisfied by `ws`'s WebSocket and by test fakes. */
export interface WsLike {
  on(event: string, cb: (...args: unknown[]) => void): unknown;
  close(): void;
}

/** Loose enough to accept both `(url) => new WebSocket(url)` and an injectable fake for tests. */
export type WsFactory = (url: string) => WsLike;

export interface ConnectWsConfig {
  hubUrl: string;
  machineToken: string;
}

export interface ConnectWsOptions {
  onMessage: (msg: WsMessage) => void;
  /** Fires on every successful (re)connect, not just the first. */
  onOpen?: () => void;
  log?: (message: string) => void;
  /** Injectable WebSocket constructor, for deterministic tests. Default `(url) => new WebSocket(url)`. */
  wsFactory?: WsFactory;
}

export interface WsHandle {
  close: () => void;
}

const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 30000;
/** How long a socket must stay open before we trust it and reset the backoff delay. */
const STABLE_MS = 5000;

function deriveWsUrl(hubUrl: string, machineToken: string): string {
  return `${hubUrl.replace(/^http/, "ws")}/ws/agent?token=${encodeURIComponent(machineToken)}`;
}

/** Connect to the Hub's agent WS relay, auto-reconnecting with exponential backoff on unexpected close. */
export function connectWs(cfg: ConnectWsConfig, opts: ConnectWsOptions): WsHandle {
  const { onMessage, onOpen, log = () => {} } = opts;
  const wsFactory: WsFactory = opts.wsFactory ?? ((url) => new WebSocket(url) as unknown as WsLike);
  const wsUrl = deriveWsUrl(cfg.hubUrl, cfg.machineToken);

  let intentionalClose = false;
  let retryDelay = BASE_DELAY_MS;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let stableTimer: ReturnType<typeof setTimeout> | null = null;
  let socket: WsLike | null = null;

  function clearStableTimer(): void {
    if (stableTimer) {
      clearTimeout(stableTimer);
      stableTimer = null;
    }
  }

  function open(): void {
    socket = wsFactory(wsUrl);

    socket.on("open", () => {
      // Only reset the backoff once the socket has stayed open for
      // STABLE_MS — a socket that opens then immediately closes (e.g. a
      // token rejected right after the handshake) must keep the escalated
      // delay, not reset to base on every flap. The reconnect-driven
      // catch-up (onOpen) still fires on every open, unconditionally.
      clearStableTimer();
      stableTimer = setTimeout(() => {
        stableTimer = null;
        retryDelay = BASE_DELAY_MS;
      }, STABLE_MS);
      stableTimer.unref?.();
      log("ws connected");
      onOpen?.();
    });

    socket.on("message", (...args: unknown[]) => {
      const data = args[0];
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(data));
      } catch {
        log("ws: received malformed (non-JSON) frame — ignored");
        return;
      }

      const result = WsMessage.safeParse(parsed);
      if (!result.success) {
        log("ws: received a frame that doesn't match a known message shape — ignored");
        return;
      }

      onMessage(result.data);
    });

    socket.on("close", () => {
      // The socket died (whether or not it ever reached stability) —
      // cancel any pending stable-reset so a flap can't sneak a reset in
      // between 'close' and the timer firing.
      clearStableTimer();
      if (intentionalClose) return;
      // Guard against double reconnect timers: only one may be scheduled
      // at a time.
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        open();
      }, retryDelay);
      reconnectTimer.unref?.();
      retryDelay = Math.min(retryDelay * 2, MAX_DELAY_MS);
    });

    socket.on("error", () => {
      // The 'close' event (which always follows) handles reconnect
      // scheduling and stable-timer cleanup.
    });
  }

  open();

  return {
    close: () => {
      intentionalClose = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      clearStableTimer();
      try {
        socket?.close();
      } catch {
        // Best-effort — the socket may already be closed/closing.
      }
    },
  };
}
