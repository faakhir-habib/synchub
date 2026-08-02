import { Injectable } from "@nestjs/common";

// Injection token for the realtime broker. Phase 2b uses a no-op implementation;
// Phase 2c replaces the provider with the real WebSocket gateway. The method
// signatures are frozen here so the sync engine can emit events without the real
// gateway existing yet. All methods are fire-and-forget (return void).
export const REALTIME_PORT = Symbol("REALTIME_PORT");

export interface PresencePayload {
  machineId: number;
  status: "online" | "offline";
  lastSeenAt: string | null;
}

export interface SyncProgressPayload {
  projectId: number;
  machineId: number;
  filename?: string;
  completed: number;
  total: number;
  phase: "scan" | "push" | "pull";
}

export interface SyncCompletePayload {
  projectId: number;
  machineId?: number;
  at: string;
}

export interface RealtimePort {
  // Tell other agents (auto-mode) + the owning user's browsers that a file changed.
  notifyProjectChanged(
    projectId: number,
    p: { filename: string; hash: string; excludeMachineId?: number },
  ): void;
  // Live per-file sync progress → the owning user's browsers.
  syncProgress(userId: number, p: SyncProgressPayload): void;
  // A reconcile finished → the owning user's browsers.
  syncComplete(userId: number, p: SyncCompletePayload): void;
  // Machine online/offline → the owning user's browsers.
  broadcastPresence(userId: number, p: PresencePayload): void;
  // Arbitrary notification (e.g. webhook failure, conflict raised) → the owning user's browsers.
  pushNotification(
    userId: number,
    notification: { type: string; title: string; body?: string | null },
  ): void;
  // Manual-mode "Sync now": nudge every agent mapped into this project to
  // reconcile, regardless of the project's sync_mode (unlike
  // notifyProjectChanged, which only auto-fans-out agents in "auto" mode).
  triggerSync(projectId: number): void;
}

// No-op default. Phase 2c swaps this out for the real gateway.
@Injectable()
export class NoopRealtime implements RealtimePort {
  notifyProjectChanged(): void {}
  syncProgress(): void {}
  syncComplete(): void {}
  broadcastPresence(): void {}
  pushNotification(): void {}
  triggerSync(): void {}
}
