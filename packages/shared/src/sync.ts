import { z } from "zod";
import { SyncMode } from "./enums.js";

export const ManifestEntry = z.object({
  filename: z.string(),
  hash: z.string(),
  size: z.number().int().nonnegative(),
  updated_at: z.string(),
});
export type ManifestEntry = z.infer<typeof ManifestEntry>;

export const PushRequest = z.object({
  filename: z.string(),
  content: z.string(),
  base_hash: z.string().nullable().default(null),
});
export type PushRequest = z.infer<typeof PushRequest>;
export type PushRequestInput = z.input<typeof PushRequest>;

// Sync is last-write-wins: a push either lands as the new canonical
// ("accepted") or the Hub already had this exact content ("unchanged").
// There is no merge/behind/conflict outcome — the incoming version always
// wins when it differs.
export const PushResponse = z.object({
  status: z.enum(["accepted", "unchanged"]),
  hash: z.string().optional(),
});
export type PushResponse = z.infer<typeof PushResponse>;

export const DeleteRequest = z.object({
  filename: z.string(),
});
export type DeleteRequest = z.infer<typeof DeleteRequest>;

export const AgentMapping = z.object({
  project_id: z.number().int(),
  machine_id: z.number().int(),
  local_path: z.string(),
  alias: z.string().nullable(),
  sync_mode: SyncMode,
});
export type AgentMapping = z.infer<typeof AgentMapping>;
