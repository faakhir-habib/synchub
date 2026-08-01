import { WsMessage } from "@synchub/shared";

export interface OpenRealtimeSocketOpts {
  token: string;
  onMessage: (msg: WsMessage) => void;
  onOpen: () => void;
  onClose: () => void;
}

export interface RealtimeSocket {
  close(): void;
}

/**
 * Thin wrapper around the browser WebSocket for the /ws/user feed. All
 * protocol validation happens here via the shared WsMessage schema —
 * malformed/unknown frames are silently dropped rather than crashing the
 * dispatch layer.
 */
export function openRealtimeSocket({
  token,
  onMessage,
  onOpen,
  onClose,
}: OpenRealtimeSocketOpts): RealtimeSocket {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const url = `${proto}://${location.host}/ws/user?token=${encodeURIComponent(token)}`;

  const ws = new WebSocket(url);
  ws.onopen = onOpen;
  ws.onclose = onClose;
  ws.onerror = () => {
    // The browser gives us no detail on a WebSocket error event — this is
    // purely for diagnosability in the console. The actual reconnect is
    // driven by onclose (a close event always follows an error).
    console.warn("[realtime] websocket error");
  };
  ws.onmessage = (ev: MessageEvent) => {
    let raw: unknown;
    try {
      raw = JSON.parse(ev.data);
    } catch {
      return;
    }
    const parsed = WsMessage.safeParse(raw);
    if (parsed.success) onMessage(parsed.data);
  };

  return {
    close() {
      try {
        // Null the handler first — an intentional close must not be
        // mistaken by the caller for a drop that should trigger reconnect.
        ws.onclose = null;
        ws.close();
      } catch {
        // best-effort
      }
    },
  };
}
