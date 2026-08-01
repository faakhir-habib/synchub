import { z } from "zod";

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

export const PushResponse = z.object({
  status: z.enum(["accepted", "unchanged", "merged", "behind", "conflict"]),
  hash: z.string().optional(),
  conflictId: z.number().int().optional(),
});
export type PushResponse = z.infer<typeof PushResponse>;

export const AgentMapping = z.object({
  project_id: z.number().int(),
  machine_id: z.number().int(),
  local_path: z.string(),
  alias: z.string().nullable(),
  sync_mode: z.enum(["auto", "manual", "stopped"]),
});
export type AgentMapping = z.infer<typeof AgentMapping>;
