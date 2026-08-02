import { describe, expect, it, vi } from "vitest";

import { installService, serviceStatus, uninstallService } from "./service.js";
import type { ServiceDeps } from "./service.js";

const SELF_PATH = "/opt/synchub/synchub-agent";
const CONFIG_PATH = "/etc/synchub/config.json";
const HOMEDIR = "/home/testuser";

function makeDeps(overrides: Partial<ServiceDeps> = {}): ServiceDeps {
  return {
    platform: "linux",
    selfPath: SELF_PATH,
    configPath: CONFIG_PATH,
    homedir: HOMEDIR,
    runCommand: vi.fn(() => ({ code: 0, stdout: "", stderr: "" })),
    writeFile: vi.fn(),
    removeFile: vi.fn(),
    readFileExists: vi.fn(() => false),
    log: vi.fn(),
    ...overrides,
  };
}

describe("installService — linux (systemd user unit)", () => {
  it("writes the unit file with ExecStart pointing at selfPath and SYNCHUB_CONFIG baked in", () => {
    const deps = makeDeps();

    const code = installService(deps);

    expect(code).toBe(0);
    expect(deps.writeFile).toHaveBeenCalledTimes(1);
    const [path, content] = (deps.writeFile as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string];
    expect(path).toBe(`${HOMEDIR}/.config/systemd/user/synchub-agent.service`);
    expect(content).toContain(`ExecStart=${SELF_PATH} run`);
    expect(content).toContain(`Environment=SYNCHUB_CONFIG=${CONFIG_PATH}`);
    expect(content).toContain("After=network-online.target");
    expect(content).toContain("Restart=on-failure");
  });

  it("reloads the daemon and enables --now the unit", () => {
    const deps = makeDeps();

    installService(deps);

    expect(deps.runCommand).toHaveBeenCalledWith("systemctl", ["--user", "daemon-reload"]);
    expect(deps.runCommand).toHaveBeenCalledWith("systemctl", [
      "--user",
      "enable",
      "--now",
      "synchub-agent",
    ]);
  });

  it("logs a clear error and returns non-zero when runCommand fails", () => {
    const deps = makeDeps({
      runCommand: vi.fn(() => ({ code: 1, stdout: "", stderr: "boom" })),
    });

    const code = installService(deps);

    expect(code).not.toBe(0);
    expect(deps.log).toHaveBeenCalledWith(expect.stringMatching(/fail|error/i));
  });
});

describe("uninstallService — linux", () => {
  it("disables --now, removes the unit file, and reloads the daemon", () => {
    const deps = makeDeps();

    const code = uninstallService(deps);

    expect(code).toBe(0);
    expect(deps.runCommand).toHaveBeenCalledWith("systemctl", [
      "--user",
      "disable",
      "--now",
      "synchub-agent",
    ]);
    expect(deps.removeFile).toHaveBeenCalledWith(
      `${HOMEDIR}/.config/systemd/user/synchub-agent.service`,
    );
    expect(deps.runCommand).toHaveBeenCalledWith("systemctl", ["--user", "daemon-reload"]);
  });
});

describe("serviceStatus — linux", () => {
  it("reports not installed when the unit file doesn't exist", () => {
    const deps = makeDeps({ readFileExists: vi.fn(() => false) });

    const status = serviceStatus(deps);

    expect(status.installed).toBe(false);
    expect(status.running).toBe(false);
  });

  it("reports installed + running when is-active prints active", () => {
    const deps = makeDeps({
      readFileExists: vi.fn(() => true),
      runCommand: vi.fn(() => ({ code: 0, stdout: "active\n", stderr: "" })),
    });

    const status = serviceStatus(deps);

    expect(status.installed).toBe(true);
    expect(status.running).toBe(true);
  });

  it("reports installed + not running when is-active prints inactive or failed", () => {
    const deps = makeDeps({
      readFileExists: vi.fn(() => true),
      runCommand: vi.fn(() => ({ code: 3, stdout: "failed\n", stderr: "" })),
    });

    const status = serviceStatus(deps);

    expect(status.installed).toBe(true);
    expect(status.running).toBe(false);
  });
});

describe("installService — darwin (launchd plist)", () => {
  function darwinDeps(overrides: Partial<ServiceDeps> = {}): ServiceDeps {
    return makeDeps({ platform: "darwin", ...overrides });
  }

  it("writes the plist with selfPath + run in ProgramArguments, RunAtLoad/KeepAlive true, and SYNCHUB_CONFIG", () => {
    const deps = darwinDeps();

    const code = installService(deps);

    expect(code).toBe(0);
    const [path, content] = (deps.writeFile as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string];
    expect(path).toBe(`${HOMEDIR}/Library/LaunchAgents/cloud.mylogiclab.synchub-agent.plist`);
    expect(content).toContain(`<string>${SELF_PATH}</string>`);
    expect(content).toContain("<string>run</string>");
    expect(content).toContain("<key>RunAtLoad</key>");
    expect(content).toContain("<key>KeepAlive</key>");
    expect(content).toContain("<key>EnvironmentVariables</key>");
    expect(content).toContain("<key>SYNCHUB_CONFIG</key>");
    expect(content).toContain(`<string>${CONFIG_PATH}</string>`);
  });

  it("loads the plist via launchctl", () => {
    const deps = darwinDeps();

    installService(deps);

    expect(deps.runCommand).toHaveBeenCalledWith("launchctl", [
      "load",
      "-w",
      `${HOMEDIR}/Library/LaunchAgents/cloud.mylogiclab.synchub-agent.plist`,
    ]);
  });

  it("logs a clear error and returns non-zero when runCommand fails", () => {
    const deps = darwinDeps({
      runCommand: vi.fn(() => ({ code: 1, stdout: "", stderr: "boom" })),
    });

    const code = installService(deps);

    expect(code).not.toBe(0);
    expect(deps.log).toHaveBeenCalledWith(expect.stringMatching(/fail|error/i));
  });

  describe("uninstallService", () => {
    it("unloads via launchctl and removes the plist", () => {
      const deps = darwinDeps();

      const code = uninstallService(deps);

      expect(code).toBe(0);
      expect(deps.runCommand).toHaveBeenCalledWith("launchctl", [
        "unload",
        "-w",
        `${HOMEDIR}/Library/LaunchAgents/cloud.mylogiclab.synchub-agent.plist`,
      ]);
      expect(deps.removeFile).toHaveBeenCalledWith(
        `${HOMEDIR}/Library/LaunchAgents/cloud.mylogiclab.synchub-agent.plist`,
      );
    });
  });

  describe("serviceStatus", () => {
    it("reports not installed when the plist doesn't exist", () => {
      const deps = darwinDeps({ readFileExists: vi.fn(() => false) });

      const status = serviceStatus(deps);

      expect(status.installed).toBe(false);
      expect(status.running).toBe(false);
    });

    it("reports installed + running when launchctl list contains the label", () => {
      const deps = darwinDeps({
        readFileExists: vi.fn(() => true),
        runCommand: vi.fn(() => ({
          code: 0,
          stdout: "1234\t0\tcloud.mylogiclab.synchub-agent\n",
          stderr: "",
        })),
      });

      const status = serviceStatus(deps);

      expect(status.installed).toBe(true);
      expect(status.running).toBe(true);
    });

    it("reports installed but not running when launchctl list doesn't contain the label", () => {
      const deps = darwinDeps({
        readFileExists: vi.fn(() => true),
        runCommand: vi.fn(() => ({ code: 0, stdout: "some.other.label\n", stderr: "" })),
      });

      const status = serviceStatus(deps);

      expect(status.installed).toBe(true);
      expect(status.running).toBe(false);
    });
  });
});

describe("installService — win32 (Scheduled Task)", () => {
  function winDeps(overrides: Partial<ServiceDeps> = {}): ServiceDeps {
    return makeDeps({ platform: "win32", ...overrides });
  }

  it("creates a Scheduled Task pointing at selfPath run, at ONSTART as SYSTEM/HIGHEST", () => {
    const deps = winDeps();

    const code = installService(deps);

    expect(code).toBe(0);
    expect(deps.runCommand).toHaveBeenCalledWith("schtasks", [
      "/Create",
      "/TN",
      "SyncHubAgent",
      "/TR",
      `"${SELF_PATH}" run`,
      "/SC",
      "ONSTART",
      "/RU",
      "SYSTEM",
      "/RL",
      "HIGHEST",
      "/F",
    ]);
  });

  it("does not write a unit/plist file on windows", () => {
    const deps = winDeps();

    installService(deps);

    expect(deps.writeFile).not.toHaveBeenCalled();
  });

  it("on failure, logs an elevation hint and returns non-zero", () => {
    const deps = winDeps({
      runCommand: vi.fn(() => ({ code: 5, stdout: "", stderr: "Access is denied." })),
    });

    const code = installService(deps);

    expect(code).not.toBe(0);
    expect(deps.log).toHaveBeenCalledWith(expect.stringMatching(/elevat/i));
  });

  describe("uninstallService", () => {
    it("deletes the scheduled task", () => {
      const deps = winDeps();

      const code = uninstallService(deps);

      expect(code).toBe(0);
      expect(deps.runCommand).toHaveBeenCalledWith("schtasks", [
        "/Delete",
        "/TN",
        "SyncHubAgent",
        "/F",
      ]);
    });
  });

  describe("serviceStatus", () => {
    it("reports not installed when schtasks /Query fails", () => {
      const deps = winDeps({
        runCommand: vi.fn(() => ({ code: 1, stdout: "", stderr: "ERROR: not found" })),
      });

      const status = serviceStatus(deps);

      expect(status.installed).toBe(false);
      expect(status.running).toBe(false);
      expect(deps.runCommand).toHaveBeenCalledWith("schtasks", ["/Query", "/TN", "SyncHubAgent"]);
    });

    it("reports installed + running when query succeeds and stdout mentions Running", () => {
      const deps = winDeps({
        runCommand: vi.fn(() => ({
          code: 0,
          stdout: "TaskName: SyncHubAgent\nStatus: Running\n",
          stderr: "",
        })),
      });

      const status = serviceStatus(deps);

      expect(status.installed).toBe(true);
      expect(status.running).toBe(true);
    });

    it("reports installed but not running when query succeeds and stdout says Ready", () => {
      const deps = winDeps({
        runCommand: vi.fn(() => ({
          code: 0,
          stdout: "TaskName: SyncHubAgent\nStatus: Ready\n",
          stderr: "",
        })),
      });

      const status = serviceStatus(deps);

      expect(status.installed).toBe(true);
      expect(status.running).toBe(false);
    });
  });
});
