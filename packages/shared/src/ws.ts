import { z } from "zod";
import { MachineStatus } from "./enums.js";

// --- Handshake (both directions) ---
export const WsWelcome = z.object({
  type: z.literal("welcome"),
  machineId: z.number().int().optional(),
  userId: z.number().int().optional(),
});

// --- Agent-directed: pull this file (also reused browser-side as invalidation) ---
export const WsChanged = z.object({
  type: z.literal("changed"),
  projectId: z.number().int(),
  filename: z.string(),
  hash: z.string(),
});

// --- Agent-directed: file deleted (also reused browser-side as invalidation) ---
export const WsDeleted = z.object({
  type: z.literal("deleted"),
  projectId: z.number().int(),
  filename: z.string(),
});

// --- Agent-directed: manual-mode "sync now" trigger (renamed from "sync") ---
export const WsSyncTrigger = z.object({
  type: z.literal("sync-trigger"),
  projectId: z.number().int(),
});

// --- Browser-directed: live machine presence (NEW) ---
export const WsPresence = z.object({
  type: z.literal("presence"),
  machineId: z.number().int(),
  status: MachineStatus,
  lastSeenAt: z.string().nullable(),
});

// --- Browser-directed: live per-file sync progress (NEW) ---
export const WsSyncProgress = z.object({
  type: z.literal("sync-progress"),
  projectId: z.number().int(),
  machineId: z.number().int(),
  filename: z.string().optional(),
  completed: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  phase: z.enum(["scan", "push", "pull"]),
});

// --- Browser-directed: a reconcile finished (NEW) ---
export const WsSyncComplete = z.object({
  type: z.literal("sync-complete"),
  projectId: z.number().int(),
  machineId: z.number().int().optional(),
  at: z.string(),
});

// --- Browser-directed: live conflict surfacing (NEW) ---
export const WsConflict = z.object({
  type: z.literal("conflict"),
  projectId: z.number().int(),
  filename: z.string(),
  conflictId: z.number().int(),
});

// --- Browser-directed: notification ---
export const WsNotification = z.object({
  type: z.literal("notification"),
  notification: z.object({
    type: z.string(),
    title: z.string(),
    body: z.string().nullable().optional(),
  }),
});

export const WsMessage = z.discriminatedUnion("type", [
  WsWelcome,
  WsChanged,
  WsDeleted,
  WsSyncTrigger,
  WsPresence,
  WsSyncProgress,
  WsSyncComplete,
  WsConflict,
  WsNotification,
]);
export type WsMessage = z.infer<typeof WsMessage>;
