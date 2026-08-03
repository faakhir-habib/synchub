# Sync each project's `memory/` folder

**Date:** 2026-08-03
**Status:** Approved (design)

## Problem

SyncHub currently syncs only Claude session transcripts — top-level `*.jsonl`
files in each mapped project folder. Alongside those transcripts, Claude also
keeps a `memory/` subfolder (`MEMORY.md` plus individual `*.md` memory files).
These are not synced today, so memory written on computer A never reaches
computer B.

The existing system is built on three assumptions that the memory folder
breaks:

1. **Flat filenames** — every file is keyed by a plain basename; `isSafeFilename`
   rejects any name containing `/`.
2. **`.jsonl` only** — the watcher and reconcile both hard-filter to `.jsonl`.
3. **Append-merge** — the Hub's `autoMerge` is tuned for append-only
   transcripts.

## Scope

- **In scope:** top-level `*.md` files directly inside each mapped project's
  `memory/` subfolder (e.g. `memory/MEMORY.md`, `memory/foo.md`).
- **Out of scope:** non-`.md` files in `memory/`, and any nested subfolders
  under `memory/` (arbitrary-depth sync is explicitly not part of this change).

## Conflict / merge behavior

Memory files flow through the **identical push → merge → conflict pipeline** as
transcripts. No special-casing, no new merge strategy.

The existing `autoMerge` (`apps/hub-api/src/sync/merge.service.ts`) is safe on
markdown, verified by tracing:

- **Identical content** → `unchanged`.
- **One side purely appended** (canonical is a prefix of incoming) → `forward`,
  take incoming.
- **One side behind** → `behind`, pull canonical.
- **Genuine divergent in-place edits** → the union path calls `parseLine` on
  each divergent tail line; markdown lines (`# Memory`, `- fact`) are not valid
  JSON, so `parseLine` returns `null` and `autoMerge` returns `conflict`
  (merge.service.ts line 66). It never silently corrupts the file.

A divergent memory edit therefore opens a conflict for manual resolution in the
Hub UI — exactly like a transcript conflict. This is strictly safer than
last-write-wins for hand-edited notes.

**Consequence:** memory files are keyed and merged as opaque `filename` strings,
so there are **no changes on the Hub side** — push, pull, delete, merge, the
`FileState` table, the blob store, and the conflict flow all work unchanged.

## Keying

Memory files reuse the existing `FileState` table, keyed by the relative path
**`memory/<name>.md`** (e.g. `memory/MEMORY.md`). No schema change — `filename`
is already an arbitrary string with a per-project unique constraint.

The allowed filename shapes become:

- a plain top-level transcript basename: `*.jsonl` (unchanged), **or**
- a memory file: `memory/<safe-name>.md`.

## Changes

All changes are on the agent side plus the shared filename guard.

### 1. `isSafeFilename` (mirrored: agent + Hub)

Files:
- `apps/agent/src/safe-filename.ts`
- `apps/hub-api/src/sync/sync.service.ts`

Relax to accept **either**:

- the existing plain basename (no `/`, no `\`, no `..`, not absolute, no `\0`,
  charset `[A-Za-z0-9._-]`, length ≤ 255), **or**
- exactly one `memory/` prefix followed by a plain safe basename ending in
  `.md` — i.e. `memory/<basename>` where `<basename>` passes the existing
  basename rules.

Still reject: `..` anywhere, backslashes, absolute paths, `\0`, and any nesting
deeper than the single `memory/` segment (no `memory/a/b.md`, no `x/y.md`).

The two implementations must stay behaviorally identical, as they are today.

### 2. Watcher (`apps/agent/src/watcher.ts`)

Currently watches each auto-mapped folder at `depth: 0` and reacts only to
`*.jsonl`.

- Bump the mapped-folder watch to `depth: 1`.
- Accept an event only if the path is **either** a top-level `*.jsonl`
  **or** a `memory/<name>.md` (one level down, inside `memory/`, ending `.md`).
  All other depth-1 paths (other subfolders, non-`.md` files in `memory/`) are
  ignored.
- Key a memory push as `memory/<basename>`; key a transcript push as the
  basename (unchanged).
- `add` / `change` → debounced push; `unlink` → eager tombstone + delete,
  using the `memory/<name>.md` key. The tombstone/delete lifecycle already
  operates on opaque keys, so it carries over with no logic change.

### 3. Reconcile (`apps/agent/src/reconcile.ts`)

- `localFiles(dir)` also scans `dir/memory/*.md`, keying each entry as
  `memory/<basename>` (transcripts stay keyed by basename). Missing/unreadable
  `memory/` dir is tolerated (returns nothing for it), same as the existing
  top-level tolerance.
- When pulling a file whose key starts with `memory/`, `mkdir` the `memory/`
  subdir (recursive) before `writeFile(join(localPath, key), content)`.
- The manifest already lists whatever `filename` strings the Hub holds, so
  `memory/<name>.md` entries appear and reconcile treats them like any other
  file. The `isSafeFilename` guard in reconcile now accepts the `memory/` shape,
  so these are pulled/pushed instead of skipped.
- Path-traversal guard: because `isSafeFilename` still forbids `..`,
  backslashes, absolute paths, and deeper nesting, `join(localPath, key)` for an
  accepted key can only ever resolve to `localPath/<basename>` or
  `localPath/memory/<basename>` — never outside `localPath`.

## Testing

- **`safe-filename` (agent + Hub):** accept `foo.jsonl` and `memory/foo.md`;
  reject `memory/foo.txt` (memory shape must end `.md`), `memory/a/b.md`
  (deeper nesting), `memory/..`, `memory/`, `../x`, `x/y.md`, and a backslash
  or absolute variant. Both implementations must agree on every case.
- **Watcher:** a `memory/foo.md` add/change enqueues a push keyed
  `memory/foo.md`; a top-level `foo.jsonl` still works; a `memory/foo.txt` or a
  nested `memory/a/b.md` is ignored; a `memory/foo.md` unlink tombstones +
  deletes under the `memory/foo.md` key.
- **Reconcile:** a Hub manifest entry `memory/foo.md` with no local copy is
  pulled and written to `localPath/memory/foo.md` (creating the dir); a local
  `memory/foo.md` with no Hub entry is pushed; divergent hashes push local;
  identical hashes update state only.
- **Merge (no code change, add coverage):** confirm `autoMerge` returns
  `conflict` for two divergent markdown edits and `forward`/`behind` for
  append/prefix cases.

## Non-goals

- Nested subfolders under `memory/`.
- Non-`.md` files in `memory/`.
- Any new merge strategy or last-write-wins path.
- Any Hub-side schema, endpoint, or merge change.
