// Optional Electron tray wrapper around the SyncHub agent.
// Runs the same agent core in-process, shows a tray icon + menu, and surfaces
// live activity as native Electron notifications. Enable with: npm i electron
// then: npx electron electron/main.js   (from the agent/ directory)
import { app, Tray, Menu, Notification, shell, nativeImage } from "electron";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, defaultConfigPath } from "../src/config.js";
import { runAgent } from "../src/agent.js";
import { homedir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
let tray = null;
let handle = null;
const recent = [];

function pushLog(line) {
  recent.unshift(`${line}`);
  if (recent.length > 8) recent.pop();
  if (tray) tray.setContextMenu(buildMenu());
}

function trayIcon() {
  const iconPath = join(__dirname, "icon.png");
  if (existsSync(iconPath)) return nativeImage.createFromPath(iconPath);
  // 1x1 transparent fallback so the tray still appears; add icon.png to brand it.
  return nativeImage.createFromDataURL(
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
  );
}

function buildMenu() {
  const cfg = loadConfig();
  const items = [
    { label: cfg ? `Hub: ${cfg.hubUrl}` : "Not paired", enabled: false },
    { type: "separator" },
    ...(recent.length ? recent.map((l) => ({ label: l, enabled: false })) : [{ label: "No activity yet", enabled: false }]),
    { type: "separator" },
    { label: "Open Hub", click: () => cfg && shell.openExternal(cfg.hubUrl) },
    { label: "Quit", click: () => app.quit() },
  ];
  return Menu.buildFromTemplate(items);
}

app.whenReady().then(async () => {
  tray = new Tray(trayIcon());
  tray.setToolTip("SyncHub Agent");
  tray.setContextMenu(buildMenu());

  const config = loadConfig();
  if (!config) {
    pushLog("Not paired — run: synchub-agent pair <CODE> <hubUrl>");
    return;
  }
  const statePath = process.env.SYNCHUB_STATE || join(homedir(), ".synchub", "state.json");

  // The agent's notify() calls node-notifier; here we ALSO mirror activity into
  // the tray menu and an Electron notification for a first-class desktop feel.
  const log = (m) => {
    pushLog(m);
    if (/^(pulled|merged|CONFLICT)/i.test(m) && Notification.isSupported()) {
      new Notification({ title: "SyncHub", body: m }).show();
    }
  };
  handle = await runAgent({ config, statePath }, log);
  pushLog("Agent running");
});

app.on("window-all-closed", () => { /* tray app: stay alive */ });
app.on("before-quit", async () => { try { await handle?.stop(); } catch {} });
