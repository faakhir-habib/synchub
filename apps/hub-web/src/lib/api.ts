import type { ZodType } from "zod";
import { HealthResponse } from "@synchub/shared";
import { ApiError } from "./api-error.js";
import { notifyUnauthorized } from "./unauthorized.js";

let authToken: string | null = null;

export function setAuthToken(token: string | null) {
  authToken = token;
}

type Method = "GET" | "POST" | "PUT" | "DELETE";

interface RequestOpts<T> {
  body?: unknown;
  schema?: ZodType<T>;
}

interface ErrorBody {
  error?: string;
  code?: string;
}

async function request<T>(method: Method, path: string, opts?: RequestOpts<T>): Promise<T> {
  const url = path.startsWith("/api") || path.startsWith("/") ? path : `/api/${path}`;

  const res = await fetch(url, {
    method,
    headers: {
      ...(opts?.body !== undefined ? { "content-type": "application/json" } : {}),
      ...(authToken ? { authorization: `Bearer ${authToken}` } : {}),
    },
    body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  if (!res.ok) {
    let body: ErrorBody = {};
    try {
      body = (await res.json()) as ErrorBody;
    } catch {
      // response had no (or non-JSON) body — fall back below
    }
    if (res.status === 401) {
      // Any 401 from any query/mutation means the session is no longer
      // valid — clear it globally, not just on the initial rehydration.
      notifyUnauthorized();
    }

    throw new ApiError(res.status, body.code ?? `http_${res.status}`, body.error ?? res.statusText);
  }

  if (res.status === 204) return undefined as T;

  const json = await res.json();
  return opts?.schema ? opts.schema.parse(json) : (json as T);
}

export function get<T>(path: string, schema?: ZodType<T>): Promise<T> {
  return request<T>("GET", path, { schema });
}

export function post<T>(path: string, body?: unknown, schema?: ZodType<T>): Promise<T> {
  return request<T>("POST", path, { body, schema });
}

export function put<T>(path: string, body?: unknown, schema?: ZodType<T>): Promise<T> {
  return request<T>("PUT", path, { body, schema });
}

export function del<T>(path: string, schema?: ZodType<T>): Promise<T> {
  return request<T>("DELETE", path, { schema });
}

// Kept from Phase 3a Task 1 (proxy smoke test) — consumed by Dashboard.tsx
// until Task 6 (real dashboard data) replaces it.
export function getHealth() {
  return get("/health", HealthResponse);
}
