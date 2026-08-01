import { z } from "zod";

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
  notify_conflicts: z.boolean(),
  notify_sync: z.boolean(),
});
export type MeResponse = z.infer<typeof MeResponse>;

export const Project = z.object({
  id: z.number().int(),
  alias: z.string(),
  sync_mode: z.enum(["auto", "manual", "stopped"]),
  created_at: z.string(),
});
export type Project = z.infer<typeof Project>;

export const Machine = z.object({
  id: z.number().int(),
  name: z.string(),
  os: z.string().nullable(),
  status: z.enum(["online", "offline"]),
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
