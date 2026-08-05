import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createApi, pairRedeem } from "./api.js";

const HUB = "http://hub.example";
const TOKEN = "tok-123";

function fakeResponse({
  status,
  ok,
  body,
  jsonThrows = false,
  textRejects = false,
}: {
  status: number;
  ok?: boolean;
  body?: string;
  jsonThrows?: boolean;
  textRejects?: boolean;
}) {
  return {
    status,
    ok: ok ?? (status >= 200 && status < 300),
    text: async () => {
      if (textRejects) throw new Error("ECONNRESET while reading body");
      return body ?? "";
    },
    json: async () => {
      if (jsonThrows) throw new Error("invalid json");
      return body ? JSON.parse(body) : null;
    },
  };
}

describe("api client", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fetchSpy: any;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  describe("getMappings", () => {
    it("sends X-Machine-Token and returns validated data on 2xx JSON array", async () => {
      const mappings = [
        {
          project_id: 1,
          machine_id: 2,
          local_path: "C:\\proj",
          alias: "myproj",
          sync_mode: "auto",
        },
      ];
      fetchSpy.mockResolvedValue(
        fakeResponse({ status: 200, body: JSON.stringify(mappings) }) as unknown as Response,
      );

      const api = createApi({ hubUrl: HUB, machineToken: TOKEN });
      const result = await api.getMappings();

      expect(result).toEqual({ ok: true, data: mappings });
      const [url, init] = fetchSpy.mock.calls[0]!;
      expect(url).toBe(`${HUB}/api/agent/mappings`);
      expect((init as RequestInit).headers).toMatchObject({ "x-machine-token": TOKEN });
    });
  });

  describe("schema mismatch", () => {
    it("returns kind:'parse' (not ok:true with bad data, not a throw) when getMappings gets a 2xx body of the wrong shape", async () => {
      fetchSpy.mockResolvedValue(
        fakeResponse({
          status: 200,
          body: JSON.stringify([{ wrong: true }]),
        }) as unknown as Response,
      );

      const api = createApi({ hubUrl: HUB, machineToken: TOKEN });
      const result = await api.getMappings();

      expect(result).toEqual({ ok: false, kind: "parse" });
    });

    it("returns kind:'parse' when getMappings gets a 2xx body that is valid JSON but not an array at all", async () => {
      fetchSpy.mockResolvedValue(
        fakeResponse({ status: 200, body: JSON.stringify({}) }) as unknown as Response,
      );

      const api = createApi({ hubUrl: HUB, machineToken: TOKEN });
      const result = await api.getMappings();

      expect(result).toEqual({ ok: false, kind: "parse" });
    });
  });

  describe("getManifest", () => {
    it("returns validated ManifestEntry[] on 2xx JSON", async () => {
      const manifest = [
        { filename: "a.txt", hash: "deadbeef", size: 10, updated_at: "2026-01-01T00:00:00Z" },
      ];
      fetchSpy.mockResolvedValue(
        fakeResponse({ status: 200, body: JSON.stringify(manifest) }) as unknown as Response,
      );

      const api = createApi({ hubUrl: HUB, machineToken: TOKEN });
      const result = await api.getManifest(42);

      expect(result).toEqual({ ok: true, data: manifest });
      const [url] = fetchSpy.mock.calls[0]!;
      expect(url).toBe(`${HUB}/api/agent/manifest/42`);
    });
  });

  describe("push", () => {
    it("POSTs filename/content/base_hash and returns accepted on 200", async () => {
      const responseBody = { status: "accepted", hash: "abc123" };
      fetchSpy.mockResolvedValue(
        fakeResponse({ status: 200, body: JSON.stringify(responseBody) }) as unknown as Response,
      );

      const api = createApi({ hubUrl: HUB, machineToken: TOKEN });
      const result = await api.push(7, "file.txt", "hello", "prevhash");

      expect(result).toEqual({ ok: true, data: responseBody });
      const [url, init] = fetchSpy.mock.calls[0]!;
      expect(url).toBe(`${HUB}/api/agent/push/7`);
      const opts = init as RequestInit;
      expect(opts.method).toBe("POST");
      expect(JSON.parse(opts.body as string)).toEqual({
        filename: "file.txt",
        content: "hello",
        base_hash: "prevhash",
      });
    });

  });

  describe("deleteFile", () => {
    it("POSTs filename and returns ok:true on 200", async () => {
      const responseBody = { status: "deleted" };
      fetchSpy.mockResolvedValue(
        fakeResponse({ status: 200, body: JSON.stringify(responseBody) }) as unknown as Response,
      );

      const api = createApi({ hubUrl: HUB, machineToken: TOKEN });
      const result = await api.deleteFile(7, "file.jsonl");

      expect(result).toEqual({ ok: true, data: responseBody });
      const [url, init] = fetchSpy.mock.calls[0]!;
      expect(url).toBe(`${HUB}/api/agent/delete/7`);
      const opts = init as RequestInit;
      expect(opts.method).toBe("POST");
      expect(JSON.parse(opts.body as string)).toEqual({ filename: "file.jsonl" });
    });

    it("returns unauthorized on 401", async () => {
      fetchSpy.mockResolvedValue(
        fakeResponse({ status: 401, ok: false, body: "" }) as unknown as Response,
      );

      const api = createApi({ hubUrl: HUB, machineToken: TOKEN });
      const result = await api.deleteFile(7, "file.jsonl");

      expect(result).toEqual({ ok: false, kind: "unauthorized" });
    });
  });

  describe("unauthorized", () => {
    it("returns a distinct unauthorized kind on 401 for any authed call", async () => {
      fetchSpy.mockResolvedValue(
        fakeResponse({ status: 401, ok: false, body: "" }) as unknown as Response,
      );

      const api = createApi({ hubUrl: HUB, machineToken: TOKEN });
      const result = await api.getMappings();

      expect(result).toEqual({ ok: false, kind: "unauthorized" });
    });

    it("returns unauthorized on 401 for push too", async () => {
      fetchSpy.mockResolvedValue(
        fakeResponse({ status: 401, ok: false, body: "" }) as unknown as Response,
      );

      const api = createApi({ hubUrl: HUB, machineToken: TOKEN });
      const result = await api.push(7, "file.txt", "hello", null);

      expect(result).toEqual({ ok: false, kind: "unauthorized" });
    });
  });

  describe("non-JSON body", () => {
    it("returns kind:'parse' instead of throwing on a non-JSON 2xx body", async () => {
      fetchSpy.mockResolvedValue(
        fakeResponse({ status: 200, body: "<html>oops" }) as unknown as Response,
      );

      const api = createApi({ hubUrl: HUB, machineToken: TOKEN });
      const result = await api.getMappings();

      expect(result).toEqual({ ok: false, kind: "parse" });
    });

    it("returns kind:'parse' (not ok:true/undefined) on an empty 2xx body when a schema is expected", async () => {
      fetchSpy.mockResolvedValue(fakeResponse({ status: 200, body: "" }) as unknown as Response);

      const api = createApi({ hubUrl: HUB, machineToken: TOKEN });
      const result = await api.getMappings();

      expect(result).toEqual({ ok: false, kind: "parse" });
    });
  });

  describe("5xx", () => {
    it("returns kind:'http' with status on a 500 with JSON body", async () => {
      fetchSpy.mockResolvedValue(
        fakeResponse({
          status: 500,
          ok: false,
          body: JSON.stringify({ error: "boom" }),
        }) as unknown as Response,
      );

      const api = createApi({ hubUrl: HUB, machineToken: TOKEN });
      const result = await api.getMappings();

      expect(result).toEqual({ ok: false, kind: "http", status: 500 });
    });

    it("returns kind:'http' with status on a 500 with non-JSON body", async () => {
      fetchSpy.mockResolvedValue(
        fakeResponse({ status: 500, ok: false, body: "internal error" }) as unknown as Response,
      );

      const api = createApi({ hubUrl: HUB, machineToken: TOKEN });
      const result = await api.getManifest(1);

      expect(result).toEqual({ ok: false, kind: "http", status: 500 });
    });
  });

  describe("network errors", () => {
    it("returns kind:'network' when fetch rejects, without throwing", async () => {
      fetchSpy.mockRejectedValue(new Error("ECONNREFUSED"));

      const api = createApi({ hubUrl: HUB, machineToken: TOKEN });
      const result = await api.getMappings();

      expect(result).toEqual({ ok: false, kind: "network" });
    });

    it("returns kind:'network' (not a throw) when the body read rejects mid-stream on getMappings", async () => {
      fetchSpy.mockResolvedValue(
        fakeResponse({ status: 200, textRejects: true }) as unknown as Response,
      );

      const api = createApi({ hubUrl: HUB, machineToken: TOKEN });
      const result = await api.getMappings();

      expect(result).toEqual({ ok: false, kind: "network" });
    });

    it("returns kind:'network' (not a throw) when the body read rejects mid-stream on getManifest", async () => {
      fetchSpy.mockResolvedValue(
        fakeResponse({ status: 200, textRejects: true }) as unknown as Response,
      );

      const api = createApi({ hubUrl: HUB, machineToken: TOKEN });
      const result = await api.getManifest(1);

      expect(result).toEqual({ ok: false, kind: "network" });
    });
  });

  describe("pull", () => {
    it("returns raw text on 2xx without JSON parsing", async () => {
      fetchSpy.mockResolvedValue(
        fakeResponse({ status: 200, body: '{"not":"parsed"}\nmore text' }) as unknown as Response,
      );

      const api = createApi({ hubUrl: HUB, machineToken: TOKEN });
      const result = await api.pull(3, "data.ndjson");

      expect(result).toBe('{"not":"parsed"}\nmore text');
      const [url] = fetchSpy.mock.calls[0]!;
      expect(url).toBe(`${HUB}/api/agent/pull/3/data.ndjson`);
    });

    it("returns null on a non-OK response", async () => {
      fetchSpy.mockResolvedValue(
        fakeResponse({ status: 404, ok: false, body: "not found" }) as unknown as Response,
      );

      const api = createApi({ hubUrl: HUB, machineToken: TOKEN });
      const result = await api.pull(3, "missing.ndjson");

      expect(result).toBeNull();
    });

    it("returns null instead of throwing on a network error", async () => {
      fetchSpy.mockRejectedValue(new Error("ECONNRESET"));

      const api = createApi({ hubUrl: HUB, machineToken: TOKEN });
      const result = await api.pull(3, "data.ndjson");

      expect(result).toBeNull();
    });

    it("returns null (not a throw) when the body read rejects mid-stream", async () => {
      fetchSpy.mockResolvedValue(
        fakeResponse({ status: 200, textRejects: true }) as unknown as Response,
      );

      const api = createApi({ hubUrl: HUB, machineToken: TOKEN });
      const result = await api.pull(3, "data.ndjson");

      expect(result).toBeNull();
    });
  });
});

describe("pairRedeem", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fetchSpy: any;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("POSTs to /api/agent/pair/redeem without a token and returns validated data on 201", async () => {
    const body = { machineToken: "new-tok", machineId: 5 };
    fetchSpy.mockResolvedValue(
      fakeResponse({ status: 201, body: JSON.stringify(body) }) as unknown as Response,
    );

    const result = await pairRedeem(HUB, "ABC123", {
      name: "my-laptop",
      os: "windows",
      os_version: "11",
      agent_version: "1.0.0",
    });

    expect(result).toEqual({ ok: true, data: body });
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe(`${HUB}/api/agent/pair/redeem`);
    const opts = init as RequestInit;
    expect(opts.method).toBe("POST");
    expect(opts.headers).not.toHaveProperty("x-machine-token");
    expect(JSON.parse(opts.body as string)).toMatchObject({ code: "ABC123", name: "my-laptop" });
  });

  it("returns a typed failure on a non-JSON body without throwing", async () => {
    fetchSpy.mockResolvedValue(
      fakeResponse({ status: 200, body: "<html>nope" }) as unknown as Response,
    );

    const result = await pairRedeem(HUB, "BAD", {});

    expect(result.ok).toBe(false);
  });

  it("returns a typed failure on network error without throwing", async () => {
    fetchSpy.mockRejectedValue(new Error("offline"));

    const result = await pairRedeem(HUB, "ABC", {});

    expect(result).toEqual({ ok: false, kind: "network" });
  });

  it("returns a typed failure on a non-2xx/201 status", async () => {
    fetchSpy.mockResolvedValue(
      fakeResponse({ status: 400, ok: false, body: JSON.stringify({ error: "bad code" }) }) as unknown as Response,
    );

    const result = await pairRedeem(HUB, "WRONG", {});

    expect(result).toEqual({ ok: false, kind: "http", status: 400 });
  });
});
