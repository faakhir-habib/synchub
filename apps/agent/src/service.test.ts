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
    isPackagedBinary: true,
    runCommand: vi.fn(() => ({ code: 0, stdout: "", stderr: "" })),
    writeFile: vi.fn(),
    removeFile: vi.fn(),
    readFileExists: vi.fn(() => false),
    log: vi.fn(),
    ...overrides,
  };
}

describe("installService — requires the packaged SEA binary", () => {
  it("refuses to install and touches nothing when not running as the packaged binary", () => {
    const deps = makeDeps({ isPackagedBinary: false });

    const code = installService(deps);

    expect(code).toBe(1);
    expect(deps.writeFile).not.toHaveBeenCalled();
    expect(deps.runCommand).not.toHaveBeenCalled();
    expect(deps.log).toHaveBeenCalledWith(expect.stringMatching(/packaged.*binary/i));
    expect(deps.log).toHaveBeenCalledWith(expect.stringMatching(/build:sea/));
  });

  it("proceeds as normal when running as the packaged binary", () => {
    const deps = makeDeps({ isPackagedBinary: true });

    const code = installService(deps);

    expect(code).toBe(0);
    expect(deps.writeFile).toHaveBeenCalledTimes(1);
  });
});

describe("installService — linux (systemd user unit)", () => {
  it("writes the unit file with ExecStart pointing at selfPath and SYNCHUB_CONFIG baked in", () => {
    const deps = makeDeps();

    const code = installService(deps);

    expect(code).toBe(0);
    expect(deps.writeFile).toHaveBeenCalledTimes(1);
    const [path, content] = (deps.writeFile as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string];
    expect(path).toBe(`${HOMEDIR}/.config/systemd/user/synchub-agent.service`);
    expect(content).toContain(`ExecStart=${SELF_PATH} run --service`);
    expect(content).toContain(`Environment=SYNCHUB_CONFIG=${CONFIG_PATH}`);
    expect(content).toContain("After=network-online.target");
    expect(content).toContain("Restart=on-failure");
  });

  it("reloads the daemon, enables, and restarts the unit", () => {
    const deps = makeDeps();

    installService(deps);

    expect(deps.runCommand).toHaveBeenCalledWith("systemctl", ["--user", "daemon-reload"]);
    expect(deps.runCommand).toHaveBeenCalledWith("systemctl", ["--user", "enable", "synchub-agent"]);
    expect(deps.runCommand).toHaveBeenCalledWith("systemctl", ["--user", "restart", "synchub-agent"]);
  });

  it("uses restart (not just start/enable --now) so re-running install after the binary was overwritten actually replaces an already-running process", () => {
    const deps = makeDeps();

    installService(deps);

    const calls = (deps.runCommand as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).not.toContainEqual(["systemctl", ["--user", "enable", "--now", "synchub-agent"]]);
    expect(calls).not.toContainEqual(["systemctl", ["--user", "start", "synchub-agent"]]);
  });

  it("logs a clear error and returns non-zero when runCommand fails", () => {
    const deps = makeDeps({
      runCommand: vi.fn(() => ({ code: 1, stdout: "", stderr: "boom" })),
    });

    const code = installService(deps);

    expect(code).not.toBe(0);
    expect(deps.log).toHaveBeenCalledWith(expect.stringMatching(/fail|error/i));
  });

  it("logs a clear error and returns non-zero when enable succeeds but restart fails", () => {
    const deps = makeDeps({
      runCommand: vi.fn((cmd, args) =>
        args[1] === "restart" ? { code: 1, stdout: "", stderr: "boom" } : { code: 0, stdout: "", stderr: "" },
      ),
    });

    const code = installService(deps);

    expect(code).not.toBe(0);
    expect(deps.log).toHaveBeenCalledWith(expect.stringMatching(/fail|error/i));
  });
});

describe("uninstallService — linux", () => {
  it("disables --now, removes the unit file, and reloads the daemon", () => {
    const deps = makeDeps({ readFileExists: vi.fn(() => true) });

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

  it("is idempotent: no-ops cleanly when the unit file doesn't exist", () => {
    const deps = makeDeps({ readFileExists: vi.fn(() => false) });

    const code = uninstallService(deps);

    expect(code).toBe(0);
    expect(deps.runCommand).not.toHaveBeenCalled();
    expect(deps.removeFile).not.toHaveBeenCalled();
    expect(deps.log).toHaveBeenCalledWith(expect.stringMatching(/not installed.*nothing to remove/i));
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
    expect(content).toContain("<string>--service</string>");
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

  it("unloads first (best-effort) so re-running install after the binary was overwritten replaces an already-loaded job instead of erroring", () => {
    const deps = darwinDeps();
    const plistPath = `${HOMEDIR}/Library/LaunchAgents/cloud.mylogiclab.synchub-agent.plist`;

    const code = installService(deps);

    expect(code).toBe(0);
    const calls = (deps.runCommand as ReturnType<typeof vi.fn>).mock.calls;
    const unloadIdx = calls.findIndex((c) => c[0] === "launchctl" && c[1][0] === "unload");
    const loadIdx = calls.findIndex((c) => c[0] === "launchctl" && c[1][0] === "load");
    expect(unloadIdx).toBeGreaterThanOrEqual(0);
    expect(loadIdx).toBeGreaterThan(unloadIdx);
    expect(deps.runCommand).toHaveBeenCalledWith("launchctl", ["unload", "-w", plistPath]);
  });

  it("ignores an unload failure (e.g. nothing was loaded yet on a fresh install) and still succeeds", () => {
    const deps = darwinDeps({
      runCommand: vi.fn((cmd, args) =>
        args[0] === "unload" ? { code: 1, stdout: "", stderr: "Could not find specified service" } : { code: 0, stdout: "", stderr: "" },
      ),
    });

    const code = installService(deps);

    expect(code).toBe(0);
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
      const deps = darwinDeps({ readFileExists: vi.fn(() => true) });

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

    it("is idempotent: no-ops cleanly when the plist doesn't exist", () => {
      const deps = darwinDeps({ readFileExists: vi.fn(() => false) });

      const code = uninstallService(deps);

      expect(code).toBe(0);
      expect(deps.runCommand).not.toHaveBeenCalled();
      expect(deps.removeFile).not.toHaveBeenCalled();
      expect(deps.log).toHaveBeenCalledWith(expect.stringMatching(/not installed.*nothing to remove/i));
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

  it("registers a self-healing XML task: boots as SYSTEM, RestartOnFailure, keeps running on battery, SYNCHUB_CONFIG baked into the exec", () => {
    const deps = winDeps();

    const code = installService(deps);

    expect(code).toBe(0);

    // The task is created from an XML definition (the only way to express
    // RestartOnFailure — schtasks' plain /Create flags cannot). The XML is
    // written to a temp file, then registered with /Create /XML.
    expect(deps.writeFile).toHaveBeenCalledTimes(1);
    const [xmlPath, xml] = (deps.writeFile as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      string,
    ];

    // Boots at startup, as SYSTEM, elevated.
    expect(xml).toContain("<BootTrigger>");
    expect(xml).toContain("<UserId>S-1-5-18</UserId>"); // SYSTEM
    expect(xml).toContain("<RunLevel>HighestAvailable</RunLevel>");

    // Self-heals: a crash (the OOM abort we saw was 0x8007042B) restarts
    // instead of leaving the machine offline until the next reboot.
    expect(xml).toContain("<RestartOnFailure>");
    expect(xml).toMatch(/<Count>[1-9]\d*<\/Count>/);

    // A laptop on battery must NOT stop the sync agent.
    expect(xml).toContain("<DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>");
    expect(xml).toContain("<StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>");

    // Same baked-in config + exec as before (SYNCHUB_CONFIG set before the
    // binary runs), XML-escaped.
    expect(xml).toContain(`SYNCHUB_CONFIG=${CONFIG_PATH}`);
    expect(xml).toContain(`&amp;&amp; &quot;${SELF_PATH}&quot; run --service`);
    expect(xml.indexOf(`SYNCHUB_CONFIG=${CONFIG_PATH}`)).toBeLessThan(
      xml.indexOf(`${SELF_PATH}&quot; run --service`),
    );

    // schtasks /XML rejects a UTF-8 document ("unable to switch the
    // encoding"); it must be declared and written as UTF-16.
    expect(xml).toContain('encoding="UTF-16"');
    const encoding = (deps.writeFile as ReturnType<typeof vi.fn>).mock.calls[0][2];
    expect(encoding).toBe("utf16le");

    // Registered from that XML file.
    expect(deps.runCommand).toHaveBeenCalledWith("schtasks", [
      "/Create",
      "/TN",
      "SyncHubAgent",
      "/XML",
      xmlPath,
      "/F",
    ]);
  });

  it("cleans up the temporary XML file after registering (even though it registered ok)", () => {
    const deps = winDeps();

    installService(deps);

    const [xmlPath] = (deps.writeFile as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string];
    expect(deps.removeFile).toHaveBeenCalledWith(xmlPath);
  });

  it("on failure, logs an elevation hint and returns non-zero", () => {
    const deps = winDeps({
      runCommand: vi.fn(() => ({ code: 5, stdout: "", stderr: "Access is denied." })),
    });

    const code = installService(deps);

    expect(code).not.toBe(0);
    expect(deps.log).toHaveBeenCalledWith(expect.stringMatching(/elevat/i));
  });

  it("ends any already-running instance and runs a fresh one after registering, so re-running install after the binary was overwritten replaces the running process", () => {
    const deps = winDeps();

    const code = installService(deps);

    expect(code).toBe(0);
    const calls = (deps.runCommand as ReturnType<typeof vi.fn>).mock.calls;
    const createIdx = calls.findIndex((c) => c[0] === "schtasks" && c[1][0] === "/Create");
    const endIdx = calls.findIndex((c) => c[0] === "schtasks" && c[1][0] === "/End");
    const runIdx = calls.findIndex((c) => c[0] === "schtasks" && c[1][0] === "/Run");
    expect(createIdx).toBeGreaterThanOrEqual(0);
    expect(endIdx).toBeGreaterThan(createIdx);
    expect(runIdx).toBeGreaterThan(endIdx);
    expect(deps.runCommand).toHaveBeenCalledWith("schtasks", ["/End", "/TN", "SyncHubAgent"]);
    expect(deps.runCommand).toHaveBeenCalledWith("schtasks", ["/Run", "/TN", "SyncHubAgent"]);
  });

  it("ignores an /End failure (nothing was running yet on a fresh install) and still starts it", () => {
    const deps = winDeps({
      runCommand: vi.fn((cmd, args) =>
        args[0] === "/End" ? { code: 1, stdout: "", stderr: "ERROR: not running" } : { code: 0, stdout: "", stderr: "" },
      ),
    });

    const code = installService(deps);

    expect(code).toBe(0);
    expect(deps.runCommand).toHaveBeenCalledWith("schtasks", ["/Run", "/TN", "SyncHubAgent"]);
  });

  it("still returns success (task is registered; BootTrigger covers it) when the immediate /Run fails, but logs a warning", () => {
    const deps = winDeps({
      runCommand: vi.fn((cmd, args) =>
        args[0] === "/Run" ? { code: 1, stdout: "", stderr: "boom" } : { code: 0, stdout: "", stderr: "" },
      ),
    });

    const code = installService(deps);

    expect(code).toBe(0);
    expect(deps.log).toHaveBeenCalledWith(expect.stringMatching(/failed to start it now/i));
  });

  describe("uninstallService", () => {
    it("deletes the scheduled task when one is installed", () => {
      const deps = winDeps();

      const code = uninstallService(deps);

      expect(code).toBe(0);
      expect(deps.runCommand).toHaveBeenCalledWith("schtasks", ["/Query", "/TN", "SyncHubAgent"]);
      expect(deps.runCommand).toHaveBeenCalledWith("schtasks", [
        "/Delete",
        "/TN",
        "SyncHubAgent",
        "/F",
      ]);
    });

    it("ends any running instance BEFORE deleting the task, so it doesn't orphan a still-running process", () => {
      const deps = winDeps();

      const code = uninstallService(deps);

      expect(code).toBe(0);
      const calls = (deps.runCommand as ReturnType<typeof vi.fn>).mock.calls;
      const endIdx = calls.findIndex((c) => c[0] === "schtasks" && c[1][0] === "/End");
      const deleteIdx = calls.findIndex((c) => c[0] === "schtasks" && c[1][0] === "/Delete");
      expect(endIdx).toBeGreaterThanOrEqual(0);
      expect(deleteIdx).toBeGreaterThan(endIdx);
    });

    it("ignores an /End failure (nothing was running) and still deletes the task", () => {
      const deps = winDeps({
        runCommand: vi.fn((cmd, args) => {
          if (args[0] === "/End") return { code: 1, stdout: "", stderr: "ERROR: not running" };
          return { code: 0, stdout: "TaskName: SyncHubAgent\n", stderr: "" };
        }),
      });

      const code = uninstallService(deps);

      expect(code).toBe(0);
    });

    it("is idempotent: no-ops cleanly when /Query reports the task doesn't exist", () => {
      const deps = winDeps({
        runCommand: vi.fn(() => ({ code: 1, stdout: "", stderr: "ERROR: not found" })),
      });

      const code = uninstallService(deps);

      expect(code).toBe(0);
      expect(deps.runCommand).toHaveBeenCalledTimes(1);
      expect(deps.runCommand).toHaveBeenCalledWith("schtasks", ["/Query", "/TN", "SyncHubAgent"]);
      expect(deps.log).toHaveBeenCalledWith(expect.stringMatching(/not installed.*nothing to remove/i));
      expect(deps.log).not.toHaveBeenCalledWith(expect.stringMatching(/elevat/i));
    });

    it("shows the elevation hint when /Delete genuinely fails with access denied", () => {
      const deps = winDeps({
        runCommand: vi.fn((cmd, args) => {
          if (args[0] === "/Query") return { code: 0, stdout: "TaskName: SyncHubAgent\n", stderr: "" };
          return { code: 5, stdout: "", stderr: "ERROR: Access is denied." };
        }),
      });

      const code = uninstallService(deps);

      expect(code).not.toBe(0);
      expect(deps.log).toHaveBeenCalledWith(expect.stringMatching(/elevat/i));
    });

    it("does not show the elevation hint when /Delete fails for a non-access-denied reason", () => {
      const deps = winDeps({
        runCommand: vi.fn((cmd, args) => {
          if (args[0] === "/Query") return { code: 0, stdout: "TaskName: SyncHubAgent\n", stderr: "" };
          return { code: 1, stdout: "", stderr: "ERROR: something else went wrong" };
        }),
      });

      const code = uninstallService(deps);

      expect(code).not.toBe(0);
      expect(deps.log).not.toHaveBeenCalledWith(expect.stringMatching(/elevat/i));
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

    it("reports installed:true based on exit code alone, regardless of stdout locale", () => {
      const deps = winDeps({
        runCommand: vi.fn(() => ({
          code: 0,
          // German-localized schtasks output — no "Running"/"Ready" substrings
          // our regex would ever match. `installed` must not depend on this.
          stdout: "Taskname: SyncHubAgent\nStatus: Wird ausgeführt\n",
          stderr: "",
        })),
      });

      const status = serviceStatus(deps);

      expect(status.installed).toBe(true);
    });
  });
});
