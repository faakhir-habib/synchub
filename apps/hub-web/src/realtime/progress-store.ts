import { useSyncExternalStore } from "react";

export interface ProgressEntry {
  machineId: number;
  filename?: string;
  completed: number;
  total: number;
  phase: "scan" | "push" | "pull";
}

type Listener = () => void;
type Snapshot = Record<number, ProgressEntry>;

// Same rationale as presence-store.ts: this is transient, live data driven
// by WebSocket frames (realtime-provider.tsx writes here from an event
// handler), not server-fetched data, so it lives outside the query cache in
// a module-level store read via useSyncExternalStore.
const progress = new Map<number, ProgressEntry>();
const listeners = new Set<Listener>();

// Mirror the Map into an immutable snapshot object on every write so it gets
// a fresh identity useSyncExternalStore's Object.is comparison can see —
// see presence-store.ts for why a plain Map read doesn't work here.
let snapshot: Snapshot = {};

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setProgress(projectId: number, entry: ProgressEntry): void {
  progress.set(projectId, entry);
  snapshot = { ...snapshot, [projectId]: entry };
  emit();
}

export function clearProgress(projectId: number): void {
  if (!progress.has(projectId)) return;
  progress.delete(projectId);
  const next = { ...snapshot };
  delete next[projectId];
  snapshot = next;
  emit();
}

export function useProjectProgress(projectId: number): ProgressEntry | undefined {
  return useSyncExternalStore(subscribe, () => snapshot[projectId]);
}
