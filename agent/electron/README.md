# SyncHub Agent — Electron tray (optional)

A desktop tray wrapper around the agent core. It runs the same
`runAgent()` in-process, shows a status menu with recent activity, and raises
native Electron notifications on pulls / merges / conflicts.

Electron is a large dependency, so it is **not** installed by default.

## Enable

From the `agent/` directory:

```
npm install electron --save-dev
npx electron electron/main.js
```

Pair first if you haven't: `node src/cli.js pair <CODE> <hubUrl>`.

## Branding

Drop a `icon.png` (16–32px, template-friendly) into `electron/` to replace the
transparent fallback tray icon.

## Package (later)

Wrap with `electron-builder` / `electron-forge` to produce a signed installer
that launches at login — at which point this replaces the OS-service approach in
`../service/` for desktop users who want a visible status icon.
