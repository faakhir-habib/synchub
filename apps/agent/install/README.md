# SyncHub Agent — one-line install

Fetches the pre-built SEA (Single Executable Application) `synchub-agent`
binary from GitHub Releases (built by CI — see the Task 5 release workflow)
and installs it. No Node.js required on the target machine.

## macOS / Linux

```sh
curl -fsSL https://raw.githubusercontent.com/faakhir-habib/synchub/main/apps/agent/install/install.sh | sh
```

## Windows

```powershell
irm https://raw.githubusercontent.com/faakhir-habib/synchub/main/apps/agent/install/install.ps1 | iex
```

The repo is public, so no token is needed. (Installing from a **private**
fork? Set `SYNCHUB_TOKEN` to a GitHub token — see the table below.)

## Pairing during install

Piping a script into `sh`/`iex` leaves no room for positional arguments, so
the **primary** way to pair during install is environment variables, not
`install.sh <CODE> <HUB>`-style flags:

```sh
SYNCHUB_CODE=ABC123 SYNCHUB_HUB=https://synchub.example.com \
  curl -fsSL https://raw.githubusercontent.com/faakhir-habib/synchub/main/apps/agent/install/install.sh | sh
```

```powershell
$env:SYNCHUB_CODE = "ABC123"
$env:SYNCHUB_HUB = "https://synchub.example.com"
irm https://raw.githubusercontent.com/faakhir-habib/synchub/main/apps/agent/install/install.ps1 | iex
```

If you've downloaded the script and run it locally instead of piping it,
`install.sh` also accepts the code/hub as positional args
(`sh install.sh ABC123 https://synchub.example.com`), and `install.ps1`
accepts `-Code`/`-Hub` params.

Without a pairing code, the script just installs the binary and prints the
next steps (`synchub-agent pair <CODE> <HUB_URL>`, then
`synchub-agent install` to register the background service).

## Environment variables

| Variable | Scripts | Purpose | Default |
|---|---|---|---|
| `SYNCHUB_VERSION` | both | Release tag to install (pin a specific version instead of latest) | `latest` |
| `SYNCHUB_CODE` | both | Pairing code, used when no positional arg / `-Code` is given | (none — skips pairing) |
| `SYNCHUB_HUB` | both | Hub URL, paired with `SYNCHUB_CODE` | (none — skips pairing) |
| `SYNCHUB_REPO` | both | GitHub `owner/repo` to download release assets from (point at a fork) | `faakhir-habib/synchub` |
| `SYNCHUB_TOKEN` | ps1 | GitHub token to download from a **private** repo's releases (not needed — this repo is public) | (none) |

## What the scripts do

1. Detect OS + CPU architecture.
2. Download the matching release asset
   (`synchub-agent-{linux,macos}-{x64,arm64}` on Unix,
   `synchub-agent-win-{x64,arm64}.exe` on Windows) from
   `https://github.com/<repo>/releases/latest/download/<asset>` (or
   `.../releases/download/<SYNCHUB_VERSION>/<asset>` when pinned).
3. Install it: `/usr/local/bin/synchub-agent` on Unix (falling back to
   `~/.local/bin` if that isn't writable), or
   `%LOCALAPPDATA%\Programs\SyncHub\synchub-agent.exe` on Windows (adding
   that directory to your user `PATH` if it's missing).
4. Optionally pair, per the env vars above.
5. Print next steps, including `synchub-agent install` to register the
   background OS service (see `apps/agent/service/`).

Both scripts are idempotent — re-running upgrades the installed binary to
whatever `SYNCHUB_VERSION` currently resolves to.
