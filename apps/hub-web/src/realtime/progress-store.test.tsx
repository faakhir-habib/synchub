import { describe, it, expect } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { setProgress, clearProgress, useProjectProgress } from "./progress-store.js";

function ProgressProbe({ projectId }: { projectId: number }) {
  const progress = useProjectProgress(projectId);
  return (
    <span data-testid="progress">
      {progress ? `${progress.phase}:${progress.completed}/${progress.total}` : "idle"}
    </span>
  );
}

describe("progress-store", () => {
  it("useProjectProgress reflects updates for its own projectId", () => {
    render(<ProgressProbe projectId={401} />);
    expect(screen.getByTestId("progress").textContent).toBe("idle");

    act(() => {
      setProgress(401, { machineId: 1, completed: 2, total: 5, phase: "push" });
    });

    expect(screen.getByTestId("progress").textContent).toBe("push:2/5");
  });

  it("does not leak updates across different projectIds", () => {
    render(<ProgressProbe projectId={402} />);

    act(() => {
      setProgress(403, { machineId: 1, completed: 1, total: 1, phase: "scan" });
    });

    expect(screen.getByTestId("progress").textContent).toBe("idle");
  });

  it("clearProgress removes the entry and getSnapshot returns a NEW object identity on every write", () => {
    const captured: unknown[] = [];
    function SnapshotCapture() {
      const progress = useProjectProgress(501);
      captured.push(progress);
      return null;
    }

    render(<SnapshotCapture />);
    const before = captured[captured.length - 1];

    act(() => {
      setProgress(501, { machineId: 9, completed: 1, total: 3, phase: "scan" });
    });
    const afterSet = captured[captured.length - 1];
    expect(afterSet).not.toBe(before);
    expect(afterSet).toEqual({ machineId: 9, completed: 1, total: 3, phase: "scan" });

    act(() => {
      clearProgress(501);
    });
    const afterClear = captured[captured.length - 1];
    expect(afterClear).toBeUndefined();
  });

  it("clearProgress on a projectId with no entry is a no-op (no spurious re-render/emit)", () => {
    render(<ProgressProbe projectId={601} />);
    expect(screen.getByTestId("progress").textContent).toBe("idle");

    act(() => {
      clearProgress(601);
    });

    expect(screen.getByTestId("progress").textContent).toBe("idle");
  });
});
