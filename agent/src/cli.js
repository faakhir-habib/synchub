#!/usr/bin/env node
import os from "node:os";
import { join } from "node:path";
import { homedir } from "node:os";
import { loadConfig, saveConfig, defaultConfigPath } from "./config.js";
import { pairRedeem } from "./api.js";
import { runAgent } from "./agent.js";

const [cmd, ...args] = process.argv.slice(2);
const statePath = process.env.SYNCHUB_STATE || join(homedir(), ".synchub", "state.json");

async function main() {
  if (cmd === "pair") {
    const code = args[0];
    const hubUrl = (args[1] || process.env.SYNCHUB_HUB || "").replace(/\/$/, "");
    if (!code || !hubUrl) {
      console.error("usage: synchub-agent pair <CODE> <hubUrl>");
      process.exit(1);
    }
    const info = {
      name: os.hostname(),
      os: process.platform,
      os_version: os.release(),
      agent_version: "0.1.0",
    };
    const { status, data } = await pairRedeem(hubUrl, code, info);
    if (status === 201) {
      const path = saveConfig({ hubUrl, machineToken: data.machineToken, machineId: data.machineId });
      console.log(`Paired as machine ${data.machineId}. Config saved to ${path}`);
    } else {
      console.error("Pair failed:", data?.error || status);
      process.exit(1);
    }
  } else if (cmd === "run") {
    const config = loadConfig();
    if (!config) {
      console.error(`No config at ${defaultConfigPath()}. Run: synchub-agent pair <CODE> <hubUrl>`);
      process.exit(1);
    }
    console.log("SyncHub agent starting; hub:", config.hubUrl);
    const handle = await runAgent({ config, statePath }, (m) => console.log("[agent]", m));
    console.log("Watching for changes. Press Ctrl+C to stop.");
    const stop = async () => { await handle.stop(); process.exit(0); };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  } else {
    console.log("SyncHub Agent\n\nUsage:\n  synchub-agent pair <CODE> <hubUrl>   Register this machine\n  synchub-agent run                    Start syncing");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
