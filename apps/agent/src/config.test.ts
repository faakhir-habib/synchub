import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { loadConfig, saveConfig } from "./config.js";
import { configPath, statePath } from "./paths.js";
import { writeFileAtomic } from "./atomic.js";

const TEST_DIR = join(tmpdir(), "synchub-agent-config-test");

describe("config", () => {
  let configFile: string;
  let counter = 0;

  beforeEach(() => {
    counter += 1;
    configFile = join(TEST_DIR, `config-${counter}.json`);
    process.env.SYNCHUB_CONFIG = configFile;
  });

  afterEach(() => {
    delete process.env.SYNCHUB_CONFIG;
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("round-trips a saved config through loadConfig", () => {
    const cfg = { hubUrl: "http://h:8080", machineToken: "tok", machineId: 1 };
    saveConfig(cfg);
    expect(loadConfig()).toEqual(cfg);
  });

  it("returns null when the config file is missing", () => {
    expect(loadConfig()).toBeNull();
  });

  it("returns null (does not throw) when the config file is corrupt", () => {
    mkdirSync(TEST_DIR, { recursive: true });
    writeFileSync(configFile, "{ not json");
    expect(() => loadConfig()).not.toThrow();
    expect(loadConfig()).toBeNull();
  });

  it("creates the parent directory recursively if missing", () => {
    expect(existsSync(TEST_DIR)).toBe(false);
    saveConfig({ hubUrl: "http://h:8080", machineToken: "tok", machineId: 1 });
    expect(existsSync(configFile)).toBe(true);
  });
});

describe("writeFileAtomic", () => {
  const TEST_DIR2 = join(tmpdir(), "synchub-agent-atomic-test");
  let target: string;
  let counter = 0;

  beforeEach(() => {
    counter += 1;
    target = join(TEST_DIR2, `file-${counter}.txt`);
  });

  afterEach(() => {
    rmSync(TEST_DIR2, { recursive: true, force: true });
  });

  it("writes the content and leaves no .tmp file behind", () => {
    writeFileAtomic(target, "hello");
    expect(existsSync(target)).toBe(true);
    expect(existsSync(`${target}.tmp`)).toBe(false);
  });
});

describe("paths", () => {
  it("configPath and statePath are env-overridable", () => {
    process.env.SYNCHUB_CONFIG = "C:\\some\\config.json";
    process.env.SYNCHUB_STATE = "C:\\some\\state.json";
    expect(configPath()).toBe("C:\\some\\config.json");
    expect(statePath()).toBe("C:\\some\\state.json");
    delete process.env.SYNCHUB_CONFIG;
    delete process.env.SYNCHUB_STATE;
  });
});
