// REST client for the Hub's agent-facing endpoints (auth via X-Machine-Token).
export function createApi({ hubUrl, machineToken }) {
  const headers = { "content-type": "application/json", "x-machine-token": machineToken };
  async function j(method, path, body) {
    const res = await fetch(hubUrl + path, {
      method, headers, body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    return { status: res.status, data: text ? JSON.parse(text) : null };
  }
  return {
    getMappings: () => j("GET", "/api/agent/mappings"),
    getManifest: (projectId) => j("GET", `/api/agent/manifest/${projectId}`),
    async pull(projectId, filename) {
      const res = await fetch(`${hubUrl}/api/agent/pull/${projectId}/${encodeURIComponent(filename)}`, {
        headers: { "x-machine-token": machineToken },
      });
      return res.ok ? await res.text() : null;
    },
    push: (projectId, filename, content, baseHash) =>
      j("POST", `/api/agent/push/${projectId}`, { filename, content, base_hash: baseHash }),
  };
}

// Redeem a pairing code (unauthenticated) -> { machineToken, machineId }.
export async function pairRedeem(hubUrl, code, info) {
  const res = await fetch(`${hubUrl}/api/agent/pair/redeem`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, ...info }),
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}
