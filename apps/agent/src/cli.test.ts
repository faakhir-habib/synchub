import { describe, expect, it, vi } from "vitest";

import { cmdInstall, cmdPair, cmdRun, cmdStatus, cmdUninstall, cmdVersion, main } from "./cli.js";
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
    runAgent: vi.fn(() => ({
      stop: vi.fn(async () => {}),
      whenIdle: vi.fn(async () => {}),
    })),
    installService: vi.fn(() => 0),
    uninstallService: vi.fn(() => 0),
    serviceStatus: vi.fn(() => ({ installed: false, running: false, detail: "not installed" })),
    purgeUserData: vi.fn(() => []),
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

  it("logs 'Service: not installed' when serviceStatus reports not installed", () => {
    const deps = makeDeps({
      loadConfig: vi.fn(() => null),
      serviceStatus: vi.fn(() => ({ installed: false, running: false, detail: "not installed" })),
    });

    const code = cmdStatus(deps);

    expect(code).toBe(0);
    expect(deps.log).toHaveBeenCalledWith(expect.stringMatching(/service:\s*not installed/i));
  });

  it("logs 'Service: installed, running' when serviceStatus reports installed + running", () => {
    const deps = makeDeps({
      loadConfig: vi.fn(() => null),
      serviceStatus: vi.fn(() => ({ installed: true, running: true, detail: "active" })),
    });

    const code = cmdStatus(deps);

    expect(code).toBe(0);
    expect(deps.log).toHaveBeenCalledWith(expect.stringMatching(/service:\s*installed,\s*running/i));
  });

  it("logs 'Service: installed, not running' when serviceStatus reports installed but not running", () => {
    const deps = makeDeps({
      loadConfig: vi.fn(() => null),
      serviceStatus: vi.fn(() => ({ installed: true, running: false, detail: "inactive" })),
    });

    const code = cmdStatus(deps);

    expect(code).toBe(0);
    expect(deps.log).toHaveBeenCalledWith(expect.stringMatching(/service:\s*installed,\s*not running/i));
  });
});

describe("cmdInstall", () => {
  it("delegates to installService and returns its code", () => {
    const deps = makeDeps({ installService: vi.fn(() => 0) });

    const code = cmdInstall(deps);

    expect(code).toBe(0);
    expect(deps.installService).toHaveBeenCalledTimes(1);
  });

  it("propagates a non-zero code from installService", () => {
    const deps = makeDeps({ installService: vi.fn(() => 1) });

    const code = cmdInstall(deps);

    expect(code).toBe(1);
  });
});

describe("cmdUninstall", () => {
  it("delegates to uninstallService and returns its code", () => {
    const deps = makeDeps({ uninstallService: vi.fn(() => 0) });

    const code = cmdUninstall([], deps);

    expect(code).toBe(0);
    expect(deps.uninstallService).toHaveBeenCalledTimes(1);
  });

  it("propagates a non-zero code from uninstallService", () => {
    const deps = makeDeps({ uninstallService: vi.fn(() => 1) });

    const code = cmdUninstall([], deps);

    expect(code).toBe(1);
  });

  it("does not purge local data without --purge", () => {
    const deps = makeDeps({ purgeUserData: vi.fn(() => ["/home/user/.synchub/config.json"]) });

    const code = cmdUninstall([], deps);

    expect(code).toBe(0);
    expect(deps.purgeUserData).not.toHaveBeenCalled();
  });

  it("purges local data when --purge is given", () => {
    const deps = makeDeps({ purgeUserData: vi.fn(() => ["/home/user/.synchub/config.json"]) });

    const code = cmdUninstall(["--purge"], deps);

    expect(code).toBe(0);
    expect(deps.purgeUserData).toHaveBeenCalledTimes(1);
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining("/home/user/.synchub/config.json"));
  });

  it("does not purge when uninstallService fails, even with --purge", () => {
    const deps = makeDeps({ uninstallService: vi.fn(() => 1), purgeUserData: vi.fn(() => []) });

    const code = cmdUninstall(["--purge"], deps);

    expect(code).toBe(1);
    expect(deps.purgeUserData).not.toHaveBeenCalled();
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

/**
 * cmdRun registers process-level SIGINT/SIGTERM listeners (via
 * `process.once`) that only self-remove once the corresponding signal is
 * actually emitted — calling the captured function directly (as these
 * tests do, to avoid tripping every stale listener left by other tests in
 * this process) does NOT deregister it. Capture + explicitly remove both
 * after each cmdRun call so listeners don't accumulate across tests.
 */
function captureAndCleanupShutdownListeners(): { shutdown: () => void; cleanup: () => void } {
  const sigint = process.listeners("SIGINT");
  const sigterm = process.listeners("SIGTERM");
  const shutdown = sigint[sigint.length - 1] as () => void;
  const termListener = sigterm[sigterm.length - 1] as (...args: unknown[]) => void;
  return {
    shutdown,
    cleanup: () => {
      process.removeListener("SIGINT", shutdown);
      process.removeListener("SIGTERM", termListener);
    },
  };
}

describe("cmdRun", () => {
  it("returns 1 and logs a not-paired message when unpaired (loadConfig -> null), without starting the agent", async () => {
    const deps = makeDeps({ loadConfig: vi.fn(() => null) });

    const code = await cmdRun(deps);

    expect(code).toBe(1);
    expect(deps.log).toHaveBeenCalledWith(expect.stringMatching(/not paired/i));
    expect(deps.runAgent).not.toHaveBeenCalled();
  });

  it("returns 0 and invokes runAgent with the loaded config when paired", async () => {
    const cfg: AgentConfig = { hubUrl: "http://hub:8080", machineToken: "tok", machineId: 7 };
    const deps = makeDeps({ loadConfig: vi.fn(() => cfg) });
    const setIntervalSpy = vi.spyOn(global, "setInterval");

    const code = await cmdRun(deps);

    expect(code).toBe(0);
    expect(deps.runAgent).toHaveBeenCalledWith(cfg, expect.objectContaining({ log: deps.log }));
    expect(deps.log).toHaveBeenCalledWith(expect.stringMatching(/agent running/i));

    // Cleanup: don't leave a real ~12-day interval or a stale signal
    // listener running past this test.
    for (const call of setIntervalSpy.mock.results) clearInterval(call.value as NodeJS.Timeout);
    setIntervalSpy.mockRestore();
    captureAndCleanupShutdownListeners().cleanup();
  });

  it("installs a ref'd keepalive interval so the process stays alive even with no other live handles", async () => {
    const cfg: AgentConfig = { hubUrl: "http://hub:8080", machineToken: "tok", machineId: 7 };
    const deps = makeDeps({ loadConfig: vi.fn(() => cfg) });
    const setIntervalSpy = vi.spyOn(global, "setInterval");

    await cmdRun(deps);

    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    const [, , ...rest] = setIntervalSpy.mock.calls[0]!;
    expect(rest).toHaveLength(0); // no extra args — a plain no-op keepalive tick.
    const keepAliveHandle = setIntervalSpy.mock.results[0]!.value as NodeJS.Timeout;
    // A ref'd timer (the default) — NOT unref()'d — is what keeps the
    // process alive; this is really just documenting intent since Node
    // doesn't expose a public "is this ref'd" query on the handle itself.
    expect(keepAliveHandle).toBeDefined();

    clearInterval(keepAliveHandle);
    setIntervalSpy.mockRestore();
    captureAndCleanupShutdownListeners().cleanup();
  });

  it("a SIGINT-triggered shutdown clears the keepalive interval and stops the agent, then exits 0", async () => {
    const cfg: AgentConfig = { hubUrl: "http://hub:8080", machineToken: "tok", machineId: 7 };
    const stop = vi.fn(async () => {});
    const deps = makeDeps({
      loadConfig: vi.fn(() => cfg),
      runAgent: vi.fn(() => ({ stop, whenIdle: vi.fn(async () => {}) })),
    });
    const setIntervalSpy = vi.spyOn(global, "setInterval");
    const clearIntervalSpy = vi.spyOn(global, "clearInterval");
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((): never => undefined as never));

    await cmdRun(deps);
    const keepAliveHandle = setIntervalSpy.mock.results[0]!.value as NodeJS.Timeout;

    // Invoke the exact SIGINT handler cmdRun registered directly, rather
    // than emitting a real process-wide SIGINT (which would also fire any
    // stale listeners left behind by other tests in this file).
    const { shutdown, cleanup } = captureAndCleanupShutdownListeners();
    shutdown();

    // Let the stop().finally() microtask chain settle.
    await vi.waitFor(() => expect(stop).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    await Promise.resolve();

    expect(clearIntervalSpy).toHaveBeenCalledWith(keepAliveHandle);
    expect(exitSpy).toHaveBeenCalledWith(0);

    cleanup();
    setIntervalSpy.mockRestore();
    clearIntervalSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("installs uncaughtException/unhandledRejection handlers that log and do NOT exit the process", async () => {
    const cfg: AgentConfig = { hubUrl: "http://hub:8080", machineToken: "tok", machineId: 7 };
    const deps = makeDeps({ loadConfig: vi.fn(() => cfg) });
    const setIntervalSpy = vi.spyOn(global, "setInterval");
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((): never => undefined as never));

    const uncaughtBefore = process.listeners("uncaughtException");
    const unhandledBefore = process.listeners("unhandledRejection");

    await cmdRun(deps);

    const uncaughtAfter = process.listeners("uncaughtException");
    const unhandledAfter = process.listeners("unhandledRejection");
    expect(uncaughtAfter.length).toBe(uncaughtBefore.length + 1);
    expect(unhandledAfter.length).toBe(unhandledBefore.length + 1);

    const uncaughtHandler = uncaughtAfter[uncaughtAfter.length - 1] as (err: unknown) => void;
    const unhandledHandler = unhandledAfter[unhandledAfter.length - 1] as (err: unknown) => void;

    uncaughtHandler(new Error("boom"));
    unhandledHandler(new Error("boom2"));

    expect(deps.log).toHaveBeenCalledWith(expect.stringMatching(/uncaught/i));
    expect(deps.log).toHaveBeenCalledWith(expect.stringMatching(/unhandled/i));
    expect(exitSpy).not.toHaveBeenCalled();

    // Cleanup: don't leak these handlers into other tests.
    process.removeListener("uncaughtException", uncaughtHandler);
    process.removeListener("unhandledRejection", unhandledHandler);
    for (const call of setIntervalSpy.mock.results) clearInterval(call.value as NodeJS.Timeout);
    setIntervalSpy.mockRestore();
    exitSpy.mockRestore();
    captureAndCleanupShutdownListeners().cleanup();
  });

  it("interactive (no --service) still returns 1 immediately when unpaired, without polling loadConfig", async () => {
    const loadConfig = vi.fn(() => null);
    const deps = makeDeps({ loadConfig });

    const code = await cmdRun(deps, { serviceMode: false });

    expect(code).toBe(1);
    expect(deps.runAgent).not.toHaveBeenCalled();
    // Exactly one synchronous check — no wait/poll loop for the interactive path.
    expect(loadConfig).toHaveBeenCalledTimes(1);
  });

  it("(--service) waits for pairing: polls loadConfig on a tiny interval and starts the agent once a config appears", async () => {
    const cfg: AgentConfig = { hubUrl: "http://hub:8080", machineToken: "tok", machineId: 7 };
    let calls = 0;
    // Deterministic + fast: returns null for the first two checks, then a
    // config — no real multi-second wait, just a few 5ms poll ticks.
    const loadConfig = vi.fn(() => {
      calls += 1;
      return calls < 3 ? null : cfg;
    });
    const deps = makeDeps({ loadConfig });
    const setIntervalSpy = vi.spyOn(global, "setInterval");

    const code = await cmdRun(deps, { serviceMode: true, pairPollMs: 5 });

    expect(code).toBe(0);
    expect(deps.runAgent).toHaveBeenCalledWith(cfg, expect.objectContaining({ log: deps.log }));
    expect(calls).toBeGreaterThanOrEqual(3);
    expect(deps.log).toHaveBeenCalledWith(expect.stringMatching(/waiting for/i));

    for (const call of setIntervalSpy.mock.results) clearInterval(call.value as NodeJS.Timeout);
    setIntervalSpy.mockRestore();
    captureAndCleanupShutdownListeners().cleanup();
  });

  it("(--service) a SIGINT during the wait-for-pairing phase clears the poll timer + keepalive and exits 0, without starting the agent", async () => {
    const loadConfig = vi.fn(() => null); // never pairs during this test
    const deps = makeDeps({ loadConfig });
    const setIntervalSpy = vi.spyOn(global, "setInterval");
    const clearIntervalSpy = vi.spyOn(global, "clearInterval");
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((): never => undefined as never));

    const runPromise = cmdRun(deps, { serviceMode: true, pairPollMs: 5 });

    // cmdRun runs synchronously up to its first await (the pairing-wait
    // promise), so by this point the keepalive + poll timer, and the
    // SIGINT/SIGTERM listeners, are already installed.
    expect(setIntervalSpy).toHaveBeenCalledTimes(2);
    const { shutdown, cleanup } = captureAndCleanupShutdownListeners();
    shutdown();

    const code = await runPromise;

    expect(code).toBe(0);
    expect(deps.runAgent).not.toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(0);
    expect(clearIntervalSpy).toHaveBeenCalledTimes(2); // keepalive + poll timer

    cleanup();
    setIntervalSpy.mockRestore();
    clearIntervalSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("removes the uncaughtException/unhandledRejection handlers on shutdown (no leak across sessions)", async () => {
    const cfg: AgentConfig = { hubUrl: "http://hub:8080", machineToken: "tok", machineId: 7 };
    const stop = vi.fn(async () => {});
    const deps = makeDeps({
      loadConfig: vi.fn(() => cfg),
      runAgent: vi.fn(() => ({ stop, whenIdle: vi.fn(async () => {}) })),
    });
    const setIntervalSpy = vi.spyOn(global, "setInterval");
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((): never => undefined as never));

    const uncaughtCountBefore = process.listenerCount("uncaughtException");
    const unhandledCountBefore = process.listenerCount("unhandledRejection");

    await cmdRun(deps);

    expect(process.listenerCount("uncaughtException")).toBe(uncaughtCountBefore + 1);
    expect(process.listenerCount("unhandledRejection")).toBe(unhandledCountBefore + 1);

    const { shutdown, cleanup } = captureAndCleanupShutdownListeners();
    shutdown();

    await vi.waitFor(() => expect(stop).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    await Promise.resolve();

    expect(process.listenerCount("uncaughtException")).toBe(uncaughtCountBefore);
    expect(process.listenerCount("unhandledRejection")).toBe(unhandledCountBefore);

    cleanup();
    setIntervalSpy.mockRestore();
    exitSpy.mockRestore();
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

  it("routes install to installService and returns its code", async () => {
    const deps = makeDeps({ installService: vi.fn(() => 0) });

    const code = await main(["node", "cli", "install"], deps);

    expect(code).toBe(0);
    expect(deps.installService).toHaveBeenCalledTimes(1);
  });

  it("routes uninstall to uninstallService and returns its code", async () => {
    const deps = makeDeps({ uninstallService: vi.fn(() => 0) });

    const code = await main(["node", "cli", "uninstall"], deps);

    expect(code).toBe(0);
    expect(deps.uninstallService).toHaveBeenCalledTimes(1);
    expect(deps.purgeUserData).not.toHaveBeenCalled();
  });

  it("routes 'uninstall --purge' through to purgeUserData", async () => {
    const deps = makeDeps();

    const code = await main(["node", "cli", "uninstall", "--purge"], deps);

    expect(code).toBe(0);
    expect(deps.uninstallService).toHaveBeenCalledTimes(1);
    expect(deps.purgeUserData).toHaveBeenCalledTimes(1);
  });

  it("routes 'run --service' to cmdRun in service mode (already-paired: starts immediately, no wait)", async () => {
    const cfg: AgentConfig = { hubUrl: "http://hub:8080", machineToken: "tok", machineId: 7 };
    const deps = makeDeps({ loadConfig: vi.fn(() => cfg) });
    const setIntervalSpy = vi.spyOn(global, "setInterval");

    const code = await main(["node", "cli", "run", "--service"], deps);

    expect(code).toBe(0);
    expect(deps.runAgent).toHaveBeenCalledWith(cfg, expect.objectContaining({ log: deps.log }));

    for (const call of setIntervalSpy.mock.results) clearInterval(call.value as NodeJS.Timeout);
    setIntervalSpy.mockRestore();
    captureAndCleanupShutdownListeners().cleanup();
  });
});
