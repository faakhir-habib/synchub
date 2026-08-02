import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, within, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiError } from "../lib/api-error.js";

const { pairMachineMock } = vi.hoisted(() => ({
  pairMachineMock: vi.fn(),
}));

vi.mock("@/lib/endpoints", () => ({
  pairMachine: pairMachineMock,
}));

// Imported after the mock above so it picks up the mocked module.
import { PairMachineDialog } from "./PairMachineDialog.js";

/**
 * A stable QueryClientProvider wrapper so a single test can `rerender` the
 * dialog (e.g. flipping `open` to simulate a close) against the same
 * QueryClient — and so `invalidateQueries` calls are observable via a spy.
 */
function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
  function Provider({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  }
  return { Provider, invalidateSpy };
}

/** Flushes the pending microtask(s) from an in-flight mocked pairMachine() call. */
async function flush() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

beforeEach(() => {
  pairMachineMock.mockReset();

  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();

  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    configurable: true,
  });

  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("PairMachineDialog", () => {
  it("generates a code on open and shows it as the hero element", async () => {
    pairMachineMock.mockResolvedValue({ code: "AB12CD", expires_in: 600 });
    const { Provider } = wrap();

    render(
      <Provider>
        <PairMachineDialog open onOpenChange={() => {}} />
      </Provider>,
    );
    await flush();

    expect(pairMachineMock).toHaveBeenCalledTimes(1);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("AB12CD")).toBeDefined();
  });

  it("counts the countdown down from expires_in and formats it mm:ss", async () => {
    pairMachineMock.mockResolvedValue({ code: "AB12CD", expires_in: 600 });
    const { Provider } = wrap();

    render(
      <Provider>
        <PairMachineDialog open onOpenChange={() => {}} />
      </Provider>,
    );
    await flush();

    expect(screen.getByText("10:00")).toBeDefined();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(screen.getByText("09:59")).toBeDefined();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(59_000);
    });
    expect(screen.getByText("09:00")).toBeDefined();
  });

  it("shows an expired state with a generate-new-code action once the countdown hits zero", async () => {
    pairMachineMock
      .mockResolvedValueOnce({ code: "AB12CD", expires_in: 2 })
      .mockResolvedValueOnce({ code: "ZZ99YY", expires_in: 600 });
    const { Provider } = wrap();

    render(
      <Provider>
        <PairMachineDialog open onOpenChange={() => {}} />
      </Provider>,
    );
    await flush();

    expect(screen.getByText("AB12CD")).toBeDefined();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(screen.getByText(/code expired/i)).toBeDefined();
    const regenerateBtn = screen.getByRole("button", { name: /generate new code/i });

    await act(async () => {
      regenerateBtn.click();
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(pairMachineMock).toHaveBeenCalledTimes(2);
    expect(screen.getByText("ZZ99YY")).toBeDefined();
    expect(screen.getByText("10:00")).toBeDefined();
    expect(screen.queryByText(/code expired/i)).toBeNull();
  });

  it("copies the code to the clipboard via the copy button", async () => {
    pairMachineMock.mockResolvedValue({ code: "AB12CD", expires_in: 600 });
    const { Provider } = wrap();

    render(
      <Provider>
        <PairMachineDialog open onOpenChange={() => {}} />
      </Provider>,
    );
    await flush();

    const copyBtn = screen.getByRole("button", { name: /^copy code$/i });
    await act(async () => {
      copyBtn.click();
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("AB12CD");
    expect(screen.getByRole("button", { name: /^copied$/i })).toBeDefined();
  });

  it("shows the agent pairing command with the generated code", async () => {
    pairMachineMock.mockResolvedValue({ code: "AB12CD", expires_in: 600 });
    const { Provider } = wrap();

    render(
      <Provider>
        <PairMachineDialog open onOpenChange={() => {}} />
      </Provider>,
    );
    await flush();

    expect(screen.getByText(/synchub-agent pair AB12CD/)).toBeDefined();
  });

  it("shows an inline error with a retry action when pairMachine fails", async () => {
    pairMachineMock
      .mockRejectedValueOnce(new ApiError(503, "unavailable", "hub-api is unreachable"))
      .mockResolvedValueOnce({ code: "AB12CD", expires_in: 600 });
    const { Provider } = wrap();

    render(
      <Provider>
        <PairMachineDialog open onOpenChange={() => {}} />
      </Provider>,
    );
    await flush();

    expect(screen.getByRole("alert").textContent).toMatch(/hub-api is unreachable/);

    const retryBtn = screen.getByRole("button", { name: /try again/i });
    await act(async () => {
      retryBtn.click();
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(pairMachineMock).toHaveBeenCalledTimes(2);
    expect(screen.getByText("AB12CD")).toBeDefined();
  });

  it("invalidates the machines list when the dialog closes", async () => {
    pairMachineMock.mockResolvedValue({ code: "AB12CD", expires_in: 600 });
    const { Provider, invalidateSpy } = wrap();
    const onOpenChange = vi.fn();

    const { rerender } = render(
      <Provider>
        <PairMachineDialog open onOpenChange={onOpenChange} />
      </Provider>,
    );
    await flush();

    expect(invalidateSpy).not.toHaveBeenCalled();

    // Simulate the parent flipping `open` to false (Escape / overlay click /
    // an explicit close all funnel through the parent calling onOpenChange).
    rerender(
      <Provider>
        <PairMachineDialog open={false} onOpenChange={onOpenChange} />
      </Provider>,
    );

    expect(invalidateSpy).toHaveBeenCalledWith(expect.objectContaining({ queryKey: ["machines"] }));
  });
});
