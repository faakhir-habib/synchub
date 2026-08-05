import { z } from "zod";
import {
  LoginRequest,
  LoginResponse,
  SignupRequest,
  SignupResponse,
  MeResponse,
  ProfileUpdateRequest,
  WebhookUpdateRequest,
  Project,
  ProjectCreateRequest,
  ProjectUpdateRequest,
  SyncModeRequest,
  ProjectDetail,
  MappingUpsertRequest,
  PublicMachine,
  MachineWithToken,
  MachineCreateRequest,
  PairCreateResponse,
  DashboardMetrics,
  NotificationsSummary,
} from "@synchub/shared";
import { get, post, put, del } from "./api.js";

// ---- shapes with no dedicated schema in @synchub/shared ----

/** Generic `{ ok: true }` acknowledgement returned by logout/delete-style endpoints. */
export const OkResponse = z.object({ ok: z.literal(true) });
export type OkResponse = z.infer<typeof OkResponse>;

/** Mapping row returned by PUT /api/projects/:id/mappings/:machineId (Prisma `mapping` row). */
export const ProjectMapping = z.object({
  project_id: z.number().int(),
  machine_id: z.number().int(),
  local_path: z.string(),
});
export type ProjectMapping = z.infer<typeof ProjectMapping>;

/** POST /api/projects/:id/sync-now response. */
export const SyncNowResponse = z.object({ status: z.literal("triggered") });
export type SyncNowResponse = z.infer<typeof SyncNowResponse>;

/** PUT /api/auth/me/notify-webhook response. */
export const NotifyWebhookResponse = z.object({ notify_webhook_url: z.string().nullable() });
export type NotifyWebhookResponse = z.infer<typeof NotifyWebhookResponse>;

/**
 * GET /api/dashboard/activity item. No shared schema exists for this shape
 * (see hub-api DashboardService.ActivityEvent).
 */
export const ActivityEvent = z.object({
  id: z.number().int(),
  user_id: z.number().int(),
  machine_id: z.number().int().nullable(),
  project_id: z.number().int().nullable(),
  type: z.string(),
  filename: z.string().nullable(),
  bytes: z.number().int(),
  latency_ms: z.number().nullable(),
  created_at: z.string(),
});
export type ActivityEvent = z.infer<typeof ActivityEvent>;

// ---- auth ----

export function login(body: LoginRequest) {
  return post("/api/auth/login", body, LoginResponse);
}

export function signup(body: SignupRequest) {
  return post("/api/auth/signup", body, SignupResponse);
}

export function logout() {
  return post("/api/auth/logout", undefined, OkResponse);
}

export function getMe() {
  return get("/api/auth/me", MeResponse);
}

export function updateMe(body: ProfileUpdateRequest) {
  return put("/api/auth/me", body, MeResponse);
}

export function updateNotifyWebhook(body: WebhookUpdateRequest) {
  return put("/api/auth/me/notify-webhook", body, NotifyWebhookResponse);
}

// ---- projects ----

export function getProjects() {
  return get("/api/projects", z.array(Project));
}

export function createProject(body: ProjectCreateRequest) {
  return post("/api/projects", body, Project);
}

export function getProject(id: number) {
  return get(`/api/projects/${id}`, ProjectDetail);
}

export function updateProject(id: number, body: ProjectUpdateRequest) {
  return put(`/api/projects/${id}`, body, Project);
}

export function setProjectSyncMode(id: number, body: SyncModeRequest) {
  return put(`/api/projects/${id}/sync-mode`, body, Project);
}

export function deleteProject(id: number) {
  return del(`/api/projects/${id}`, OkResponse);
}

export function upsertMapping(projectId: number, machineId: number, body: MappingUpsertRequest) {
  return put(`/api/projects/${projectId}/mappings/${machineId}`, body, ProjectMapping);
}

export function removeMapping(projectId: number, machineId: number) {
  return del(`/api/projects/${projectId}/mappings/${machineId}`, OkResponse);
}

export function syncNow(id: number) {
  return post(`/api/projects/${id}/sync-now`, undefined, SyncNowResponse);
}

// ---- machines ----

export function getMachines() {
  return get("/api/machines", z.array(PublicMachine));
}

export function createMachine(body: MachineCreateRequest) {
  return post("/api/machines", body, MachineWithToken);
}

export function deleteMachine(id: number) {
  return del(`/api/machines/${id}`, OkResponse);
}

export function pairMachine() {
  return post("/api/machines/pair", undefined, PairCreateResponse);
}

// ---- notifications ----

export function getNotifications() {
  return get("/api/notifications", NotificationsSummary);
}

export function markNotificationRead(id: number) {
  return post(`/api/notifications/${id}/read`, undefined, OkResponse);
}

export function markAllNotificationsRead() {
  return post("/api/notifications/read-all", undefined, OkResponse);
}

// ---- dashboard ----

export function getMetrics() {
  return get("/api/dashboard/metrics", DashboardMetrics);
}

export function getActivity(limit?: number) {
  const query = limit != null ? `?limit=${limit}` : "";
  return get(`/api/dashboard/activity${query}`, z.array(ActivityEvent));
}
