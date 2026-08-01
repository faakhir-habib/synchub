import { HealthResponse } from "@synchub/shared";

export async function getHealth(): Promise<HealthResponse> {
  const res = await fetch("/health");
  if (!res.ok) throw new Error(`health ${res.status}`);
  return HealthResponse.parse(await res.json());
}
