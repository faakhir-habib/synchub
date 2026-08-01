import { useSyncExternalStore } from "react";
import type { MachineStatus } from "@synchub/shared";

export interface PresenceEntry {
  status: MachineStatus;
  lastSeenAt: string | null;
}

type Listener = () => void;

// Module-level store — deliberately NOT React state. The WebSocket dispatch
// (realtime-provider.tsx) writes here from an event handler, components read
// via useSyncExternalStore. Keeps presence updates out of the query cache
// (it's live/ephemeral, not server-fetched data) without adding a state lib.
const presence = new Map<number, PresenceEntry>();
const listeners = new Set<Listener>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setPresence(machineId: number, entry: PresenceEntry): void {
  presence.set(machineId, entry);
  emit();
}

export function usePresence(machineId: number): PresenceEntry | undefined {
  return useSyncExternalStore(subscribe, () => presence.get(machineId));
}

export function useAllPresence(): ReadonlyMap<number, PresenceEntry> {
  return useSyncExternalStore(subscribe, () => presence);
}
