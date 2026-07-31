import WebSocket from "ws";

// Persistent agent WS connection with auto-reconnect (exponential backoff).
export function connectWs({ hubUrl, machineToken }, onMessage, log = () => {}) {
  const wsUrl = hubUrl.replace(/^http/, "ws") + `/ws/agent?token=${encodeURIComponent(machineToken)}`;
  let ws;
  let closed = false;
  let retry = 1000;

  function open() {
    ws = new WebSocket(wsUrl);
    ws.on("open", () => { retry = 1000; log("ws connected"); });
    ws.on("message", (data) => {
      let msg;
      try { msg = JSON.parse(data.toString()); } catch { return; }
      onMessage(msg);
    });
    ws.on("close", () => {
      if (closed) return;
      setTimeout(open, retry);
      retry = Math.min(retry * 2, 30000);
    });
    ws.on("error", () => { /* 'close' handles reconnect */ });
  }
  open();

  return { close: () => { closed = true; try { ws?.close(); } catch {} } };
}
