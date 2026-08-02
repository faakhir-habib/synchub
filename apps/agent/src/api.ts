import type { ZodType } from "zod";

import { AgentMapping, ManifestEntry, PairRedeemResponse, PushResponse } from "@synchub/shared";
import type { PairRedeemRequest } from "@synchub/shared";

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; kind: "unauthorized" | "http" | "parse" | "network"; status?: number };

interface RequestOptions<T> {
  body?: unknown;
  schema?: ZodType<T>;
  /** Return the raw response text instead of JSON-parsing it. */
  raw?: boolean;
  /** HTTP statuses (in addition to 2xx) that count as a successful outcome. */
  acceptStatuses?: number[];
}

async function doRequest<T>(
  method: string,
  url: string,
  headers: Record<string, string>,
  opts?: RequestOptions<T>,
): Promise<ApiResult<T>> {
  let res: { status: number; ok: boolean; text: () => Promise<string> };
  try {
    res = await fetch(url, {
      method,
      headers: {
        ...headers,
        ...(opts?.body ? { "content-type": "application/json" } : {}),
      },
      body: opts?.body ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    return { ok: false, kind: "network" };
  }

  if (res.status === 401) {
    return { ok: false, kind: "unauthorized" };
  }

  const accepted = res.ok || (opts?.acceptStatuses?.includes(res.status) ?? false);
  if (!accepted) {
    return { ok: false, kind: "http", status: res.status };
  }

  // Headers can resolve successfully while the body stream itself fails
  // mid-read (e.g. ECONNRESET downloading a large manifest/ndjson pull).
  // That rejection must be caught here too, or it throws out of doRequest.
  try {
    if (opts?.raw) {
      return { ok: true, data: (await res.text()) as unknown as T };
    }

    const text = await res.text();
    if (!text) {
      // An empty body only counts as a valid (voidish) result when no
      // schema was expected. If a schema was provided, an empty body is
      // a parse failure, not `undefined` masquerading as valid data.
      if (opts?.schema) {
        return { ok: false, kind: "parse" };
      }
      return { ok: true, data: undefined as unknown as T };
    }

    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return { ok: false, kind: "parse" };
    }

    if (opts?.schema) {
      const parsed = opts.schema.safeParse(json);
      if (!parsed.success) {
        return { ok: false, kind: "parse" };
      }
      return { ok: true, data: parsed.data };
    }

    return { ok: true, data: json as T };
  } catch {
    return { ok: false, kind: "network" };
  }
}

/** REST client for the Hub's agent-facing endpoints (auth via X-Machine-Token). */
export function createApi({ hubUrl, machineToken }: { hubUrl: string; machineToken: string }) {
  const authHeaders = { "x-machine-token": machineToken };

  return {
    getMappings: () =>
      doRequest(
        "GET",
        `${hubUrl}/api/agent/mappings`,
        authHeaders,
        { schema: AgentMapping.array() },
      ),

    getManifest: (projectId: number | string) =>
      doRequest(
        "GET",
        `${hubUrl}/api/agent/manifest/${projectId}`,
        authHeaders,
        { schema: ManifestEntry.array() },
      ),

    /** Raw text on 2xx; null on any non-OK response or network error (no JSON parsing). */
    async pull(projectId: number | string, filename: string): Promise<string | null> {
      const result = await doRequest<string>(
        "GET",
        `${hubUrl}/api/agent/pull/${projectId}/${encodeURIComponent(filename)}`,
        authHeaders,
        { raw: true },
      );
      return result.ok ? result.data : null;
    },

    push: (projectId: number | string, filename: string, content: string, baseHash: string | null) =>
      doRequest(
        "POST",
        `${hubUrl}/api/agent/push/${projectId}`,
        authHeaders,
        {
          body: { filename, content, base_hash: baseHash },
          schema: PushResponse,
          // A 409 conflict is a valid, expected push outcome — not an error.
          acceptStatuses: [409],
        },
      ),
  };
}

/** The shape returned by createApi — a clean seam for the Phase 4b sync engine. */
export type Api = ReturnType<typeof createApi>;

/** Redeem a pairing code (unauthenticated). */
export async function pairRedeem(
  hubUrl: string,
  code: string,
  info: Omit<PairRedeemRequest, "code">,
): Promise<ApiResult<PairRedeemResponse>> {
  return doRequest(
    "POST",
    `${hubUrl}/api/agent/pair/redeem`,
    {},
    {
      body: { code, ...info },
      schema: PairRedeemResponse,
      acceptStatuses: [201],
    },
  );
}
