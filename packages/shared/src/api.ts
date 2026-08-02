import { z } from "zod";
import { SyncMode, MachineStatus } from "./enums.js";

// NOTE ON BOOLEAN FIELDS: SQLite has no native boolean, so the Prisma models
// store these as `Int` (0/1): MeResponse.notify_conflicts, MeResponse.notify_sync,
// Conflict.auto_merged, and NotificationsSummary.items[].read. These DTOs
// intentionally expose real booleans — the hub-api layer MUST map Int → boolean
// (e.g. `!!row.read`) when serializing, or a raw Prisma row will fail
// `.parse()` here. Do NOT change these to `z.number()`; fix the mapping instead.

export const ApiError = z.object({ error: z.string(), code: z.string().optional() });
export type ApiError = z.infer<typeof ApiError>;

export const HealthResponse = z.object({
  status: z.literal("ok"),
  version: z.string(),
  db: z.enum(["up", "down"]),
});
export type HealthResponse = z.infer<typeof HealthResponse>;

export const SignupRequest = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().optional(),
});
export type SignupRequest = z.infer<typeof SignupRequest>;

export const LoginRequest = z.object({
  email: z.string().email(),
  password: z.string(),
});
export type LoginRequest = z.infer<typeof LoginRequest>;

export const MeResponse = z.object({
  id: z.number().int(),
  email: z.string(),
  name: z.string().nullable(),
  notify_webhook_url: z.string().nullable(),
  notify_conflicts: z.boolean(),
  notify_sync: z.boolean(),
});
export type MeResponse = z.infer<typeof MeResponse>;

export const SignupResponse = z.object({
  token: z.string(),
  user: z.object({
    id: z.number().int(),
    email: z.string(),
    name: z.string().nullable(),
  }),
});
export type SignupResponse = z.infer<typeof SignupResponse>;

export const LoginResponse = z.object({
  token: z.string(),
  user: z.object({
    id: z.number().int(),
    email: z.string(),
  }),
});
export type LoginResponse = z.infer<typeof LoginResponse>;

export const ProfileUpdateRequest = z.object({
  name: z.string().nullable().optional(),
  notify_webhook_url: z.string().nullable().optional(),
  notify_conflicts: z.boolean().optional(),
  notify_sync: z.boolean().optional(),
});
export type ProfileUpdateRequest = z.infer<typeof ProfileUpdateRequest>;

export const WebhookUpdateRequest = z.object({
  url: z.string().nullable().optional(),
});
export type WebhookUpdateRequest = z.infer<typeof WebhookUpdateRequest>;

export const MachineCreateRequest = z.object({
  name: z.string().min(1),
  os: z.string().optional(),
  os_version: z.string().optional(),
  label: z.string().optional(),
});
export type MachineCreateRequest = z.infer<typeof MachineCreateRequest>;

export const PublicMachine = z.object({
  id: z.number().int(),
  name: z.string(),
  os: z.string().nullable(),
  os_version: z.string().nullable(),
  label: z.string().nullable(),
  agent_version: z.string().nullable(),
  last_ip: z.string().nullable(),
  status: MachineStatus,
  last_seen_at: z.string().nullable(),
  created_at: z.string(),
});
export type PublicMachine = z.infer<typeof PublicMachine>;

export const MachineWithToken = PublicMachine.extend({
  token: z.string(),
});
export type MachineWithToken = z.infer<typeof MachineWithToken>;

export const PairCreateResponse = z.object({
  code: z.string(),
  expires_in: z.number().int(),
});
export type PairCreateResponse = z.infer<typeof PairCreateResponse>;

export const PairRedeemRequest = z.object({
  code: z.string(),
  name: z.string().optional(),
  os: z.string().optional(),
  os_version: z.string().optional(),
  label: z.string().optional(),
  agent_version: z.string().optional(),
});
export type PairRedeemRequest = z.infer<typeof PairRedeemRequest>;

export const PairRedeemResponse = z.object({
  machineToken: z.string(),
  machineId: z.number().int(),
});
export type PairRedeemResponse = z.infer<typeof PairRedeemResponse>;

export const ProjectCreateRequest = z.object({
  alias: z.string().trim().min(1, "Enter a project alias."),
  sync_mode: SyncMode.optional(),
});
export type ProjectCreateRequest = z.infer<typeof ProjectCreateRequest>;

export const ProjectUpdateRequest = z.object({
  alias: z.string().optional(),
  sync_mode: SyncMode.optional(),
});
export type ProjectUpdateRequest = z.infer<typeof ProjectUpdateRequest>;

export const SyncModeRequest = z.object({
  sync_mode: SyncMode,
});
export type SyncModeRequest = z.infer<typeof SyncModeRequest>;

export const MappingUpsertRequest = z.object({
  local_path: z.string(),
});
export type MappingUpsertRequest = z.infer<typeof MappingUpsertRequest>;

export const Project = z.object({
  id: z.number().int(),
  alias: z.string(),
  sync_mode: SyncMode,
  created_at: z.string(),
});
export type Project = z.infer<typeof Project>;

export const Machine = z.object({
  id: z.number().int(),
  name: z.string(),
  os: z.string().nullable(),
  status: MachineStatus,
  last_seen_at: z.string().nullable(),
});
export type Machine = z.infer<typeof Machine>;

export const Conflict = z.object({
  id: z.number().int(),
  project_id: z.number().int(),
  filename: z.string(),
  status: z.enum(["open", "resolved"]),
  auto_merged: z.boolean(),
  created_at: z.string(),
});
export type Conflict = z.infer<typeof Conflict>;

export const ResolveConflictRequest = z.object({
  choice: z.enum(["candidate", "canonical"]).optional(),
});
export type ResolveConflictRequest = z.infer<typeof ResolveConflictRequest>;

export const ProjectDetail = Project.extend({
  mappings: z.array(
    z.object({
      machine_id: z.number().int(),
      local_path: z.string(),
      alias: z.string().nullable(),
    }),
  ),
  tracked_files: z.number().int(),
  last_sync_at: z.string().nullable(),
  activity: z.array(z.any()),
});
export type ProjectDetail = z.infer<typeof ProjectDetail>;

export const DashboardMetrics = z.object({
  projects: z.object({
    total: z.number().int(),
    syncing: z.number().int(),
  }),
  machines: z.object({
    total: z.number().int(),
    online: z.number().int(),
  }),
  openConflicts: z.number().int(),
  eventsToday: z.number().int(),
  dataTransferredBytes: z.number().int(),
  sessionsSyncedToday: z.number().int(),
  syncSuccessRate: z.number(),
  avgLatencyMs: z.number().nullable(),
  unreadNotifications: z.number().int(),
});
export type DashboardMetrics = z.infer<typeof DashboardMetrics>;

export const NotificationsSummary = z.object({
  unread: z.number().int(),
  items: z.array(
    z.object({
      id: z.number().int(),
      type: z.string(),
      title: z.string(),
      body: z.string().nullable(),
      read: z.boolean(),
      created_at: z.string(),
    }),
  ),
});
export type NotificationsSummary = z.infer<typeof NotificationsSummary>;
