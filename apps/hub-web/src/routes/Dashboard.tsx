import { useQuery } from "@tanstack/react-query";
import { getHealth } from "../lib/api.js";

export function Dashboard() {
  const { data, isPending, isError } = useQuery({
    queryKey: ["health"],
    queryFn: getHealth,
  });
  if (isPending) return <p>Loading…</p>;
  if (isError) return <p>hub-api unreachable</p>;
  return (
    <div>
      <h1>Dashboard</h1>
      <p>
        hub-api: <strong>{data?.status}</strong> · db: <strong>{data?.db}</strong> · v
        {data?.version}
      </p>
    </div>
  );
}

// A trivial second route to demonstrate no-refresh navigation.
export function Projects() {
  return <h1>Projects</h1>;
}
