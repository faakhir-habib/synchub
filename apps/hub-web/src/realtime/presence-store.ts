import { useSyncExternalStore } from "react";
import type { MachineStatus } from "@synchub/shared";

export interface PresenceEntry {
  status: MachineStatus;
  lastSeenAt: string | null;
}

type Listener = () => void;
type Snapshot = Record<number, PresenceEntry>;

// Module-level store — deliberately NOT React state. The WebSocket dispatch
// (realtime-provider.tsx) writes here from an event handler, components read
// via useSyncExternalStore. Keeps presence updates out of the query cache
// (it's live/ephemeral, not server-fetched data) without adding a state lib.
const presence = new Map<number, PresenceEntry>();
const listeners = new Set<Listener>();

// useSyncExternalStore's getSnapshot must return a value that is
// reference-stable between mutations (Object.is compared) or it triggers an
// infinite re-render loop. A plain Map read (`presence.get(id)` /
// `presence` itself) is a NEW/unchanged-by-identity value semantics problem:
// the Map object never changes identity even when its contents do, so
// consumers subscribed via useSyncExternalStore never see updates. Mirror
// the Map into an immutable snapshot object that gets a fresh identity on
// every write instead.
let snapshot: Snapshot = {};

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setPresence(machineId: number, entry: PresenceEntry): void {
  presence.set(machineId, entry);
  snapshot = { ...snapshot, [machineId]: entry };
  emit();
}

export function usePresence(machineId: number): PresenceEntry | undefined {
  return useSyncExternalStore(subscribe, () => snapshot[machineId]);
}

export function useAllPresence(): Readonly<Snapshot> {
  return useSyncExternalStore(subscribe, () => snapshot);
}
