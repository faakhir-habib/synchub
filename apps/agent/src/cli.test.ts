import { describe, expect, it, vi } from "vitest";

import { cmdPair, cmdRun, cmdStatus, cmdVersion, main } from "./cli.js";
import { VERSION } from "./version.js";
import pkg from "../package.json" with { type: "json" };
import type { AgentConfig } from "./config.js";
import type { ApiResult } from "./api.js";
import type { PairRedeemResponse } from "@synchub/shared";

function makeDeps(overrides: Partial<Parameters<typeof cmdPair>[1]> = {}) {
  return {
    pairRedeem: vi.fn(),
    saveConfig: vi.fn(),
    loadConfig: vi.fn(),
    log: vi.fn(),
    ...overrides,
  };
}

describe("cmdPair", () => {
  it("saves config and logs success on a successful redeem", async () => {
    const deps = makeDeps({
      pairRedeem: vi.fn(
        async (): Promise<ApiResult<PairRedeemResponse>> => ({
          ok: true,
          data: { machineToken: "tok", machineId: 5 },
        }),
      ),
    });

    const code = await cmdPair(["ABC123", "http://hub:8080"], deps);

    expect(code).toBe(0);
    expect(deps.saveConfig).toHaveBeenCalledWith({
      hubUrl: "http://hub:8080",
      machineToken: "tok",
      machineId: 5,
    });
    expect(deps.log).toHaveBeenCalled();
  });

  it("does not save config and returns non-zero on a failed redeem", async () => {
    const deps = makeDeps({
      pairRedeem: vi.fn(async (): Promise<ApiResult<PairRedeemResponse>> => ({
        ok: false,
        kind: "http",
        status: 400,
      })),
    });

    const code = await cmdPair(["ABC123", "http://hub:8080"], deps);

    expect(code).toBe(1);
    expect(deps.saveConfig).not.toHaveBeenCalled();
    expect(deps.log).toHaveBeenCalled();
  });

  it("returns a usage error when args are missing", async () => {
    const deps = makeDeps();

    const code = await cmdPair([], deps);

    expect(code).toBe(1);
    expect(deps.pairRedeem).not.toHaveBeenCalled();
    expect(deps.saveConfig).not.toHaveBeenCalled();
    expect(deps.log).toHaveBeenCalled();
  });

  it("strips a trailing slash from the hub URL", async () => {
    const deps = makeDeps({
      pairRedeem: vi.fn(
        async (): Promise<ApiResult<PairRedeemResponse>> => ({
          ok: true,
          data: { machineToken: "tok", machineId: 5 },
        }),
      ),
    });

    await cmdPair(["ABC123", "http://hub:8080/"], deps);

    expect(deps.pairRedeem).toHaveBeenCalledWith(
      "http://hub:8080",
      "ABC123",
      expect.anything(),
    );
    expect(deps.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({ hubUrl: "http://hub:8080" }),
    );
  });
});

describe("cmdStatus", () => {
  it("logs the hub URL and machine id when paired", () => {
    const cfg: AgentConfig = { hubUrl: "http://hub:8080", machineToken: "tok", machineId: 7 };
    const deps = makeDeps({ loadConfig: vi.fn(() => cfg) });

    const code = cmdStatus(deps);

    expect(code).toBe(0);
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining("http://hub:8080"));
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining("7"));
  });

  it("logs not-paired when there is no config", () => {
    const deps = makeDeps({ loadConfig: vi.fn(() => null) });

    const code = cmdStatus(deps);

    expect(code).toBe(0);
    expect(deps.log).toHaveBeenCalledWith(expect.stringMatching(/not paired/i));
  });
});

describe("cmdVersion", () => {
  it("logs the version read from package.json", () => {
    const log = vi.fn();

    const code = cmdVersion({ log });

    expect(code).toBe(0);
    expect(log).toHaveBeenCalledWith(VERSION);
    expect(VERSION).toBe(pkg.version);
    expect(VERSION).not.toBe("0.0.0");
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe("cmdRun", () => {
  it("returns 1 and logs a not-paired message when unpaired (loadConfig -> null)", () => {
    const deps = makeDeps({ loadConfig: vi.fn(() => null) });

    const code = cmdRun(deps);

    expect(code).toBe(1);
    expect(deps.log).toHaveBeenCalledWith(expect.stringMatching(/not paired/i));
  });

  it("returns 0 and logs the Phase 4b stub message when paired", () => {
    const cfg: AgentConfig = { hubUrl: "http://hub:8080", machineToken: "tok", machineId: 7 };
    const deps = makeDeps({ loadConfig: vi.fn(() => cfg) });

    const code = cmdRun(deps);

    expect(code).toBe(0);
    expect(deps.log).toHaveBeenCalledWith(expect.stringMatching(/phase 4b/i));
  });
});

describe("main", () => {
  it("routes --version to cmdVersion", async () => {
    const deps = makeDeps();

    const code = await main(["node", "cli", "--version"], deps);

    expect(code).toBe(0);
    expect(deps.log).toHaveBeenCalledWith(VERSION);
  });

  it("prints usage and returns 1 for an unknown command", async () => {
    const deps = makeDeps();

    const code = await main(["node", "cli", "bogus"], deps);

    expect(code).toBe(1);
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining("Usage"));
  });

  it("prints usage and returns 0 when no command is given", async () => {
    const deps = makeDeps();

    const code = await main(["node", "cli"], deps);

    expect(code).toBe(0);
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining("Usage"));
  });
});
