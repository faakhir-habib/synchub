import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ConflictWithProjectAlias } from "@/lib/endpoints";

const { getConflictContentMock, resolveConflictMock } = vi.hoisted(() => ({
  getConflictContentMock: vi.fn(),
  resolveConflictMock: vi.fn(),
}));

vi.mock("@/lib/endpoints", () => ({
  getConflictContent: getConflictContentMock,
  resolveConflict: resolveConflictMock,
}));

// Imported after the mocks above so it picks up the mocked module.
import { ResolveConflictDialog } from "./ResolveConflictDialog.js";

const CONFLICT: ConflictWithProjectAlias = {
  id: 501,
  project_id: 7,
  filename: "session.jsonl",
  status: "open",
  auto_merged: false,
  created_at: new Date().toISOString(),
  machine_id: 3,
  candidate_hash: "abc123",
  resolved_at: null,
  project_alias: "field-notes",
};

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

beforeEach(() => {
  getConflictContentMock.mockReset();
  resolveConflictMock.mockReset();
  getConflictContentMock.mockResolvedValue({
    canonical: '{"seq":1}\n',
    candidate: '{"seq":1}\n{"seq":2}\n',
  });

  // jsdom doesn't implement scrollIntoView or pointer capture — needed
  // defensively for the Radix Dialog.
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
});

describe("ResolveConflictDialog", () => {
  it("fetches and renders the diff for the given conflict", async () => {
    render(wrap(<ResolveConflictDialog open onOpenChange={vi.fn()} conflict={CONFLICT} />));

    await waitFor(() => expect(getConflictContentMock).toHaveBeenCalledWith(7, 501));
    expect(await screen.findByText('{"seq":2}')).toBeDefined();
  });

  it('"keep incoming" quick button resolves with choice=candidate', async () => {
    resolveConflictMock.mockResolvedValue({ status: "resolved", choice: "candidate" });
    render(wrap(<ResolveConflictDialog open onOpenChange={vi.fn()} conflict={CONFLICT} />));

    fireEvent.click(await screen.findByRole("button", { name: /keep the incoming version/i }));

    await waitFor(() =>
      expect(resolveConflictMock).toHaveBeenCalledWith(7, 501, { choice: "candidate" }),
    );
  });

  it('"keep current" quick button resolves with choice=canonical', async () => {
    resolveConflictMock.mockResolvedValue({ status: "resolved", choice: "canonical" });
    render(wrap(<ResolveConflictDialog open onOpenChange={vi.fn()} conflict={CONFLICT} />));

    fireEvent.click(await screen.findByRole("button", { name: /keep the current synced version/i }));

    await waitFor(() =>
      expect(resolveConflictMock).toHaveBeenCalledWith(7, 501, { choice: "canonical" }),
    );
  });

  it("seeds the editor with the canonical version once content loads", async () => {
    render(wrap(<ResolveConflictDialog open onOpenChange={vi.fn()} conflict={CONFLICT} />));

    const textarea = await screen.findByLabelText<HTMLTextAreaElement>(/merged resolution content/i);
    await waitFor(() => expect(textarea.value).toBe('{"seq":1}\n'));
  });

  it('"Fill from incoming" loads the candidate content into the editor', async () => {
    render(wrap(<ResolveConflictDialog open onOpenChange={vi.fn()} conflict={CONFLICT} />));

    const textarea = await screen.findByLabelText<HTMLTextAreaElement>(/merged resolution content/i);
    await waitFor(() => expect(textarea.value).toBe('{"seq":1}\n'));

    fireEvent.click(screen.getByRole("button", { name: /fill from incoming/i }));

    expect(textarea.value).toBe('{"seq":1}\n{"seq":2}\n');
  });

  it("editing the merge box and saving posts choice=manual with the edited content", async () => {
    resolveConflictMock.mockResolvedValue({ status: "resolved", choice: "manual" });
    render(wrap(<ResolveConflictDialog open onOpenChange={vi.fn()} conflict={CONFLICT} />));

    const textarea = await screen.findByLabelText<HTMLTextAreaElement>(/merged resolution content/i);
    await waitFor(() => expect(textarea.value).toBe('{"seq":1}\n'));

    fireEvent.change(textarea, { target: { value: '{"seq":1}\n{"seq":3,"merged":true}\n' } });
    fireEvent.click(screen.getByRole("button", { name: /save merged version/i }));

    await waitFor(() =>
      expect(resolveConflictMock).toHaveBeenCalledWith(7, 501, {
        choice: "manual",
        content: '{"seq":1}\n{"seq":3,"merged":true}\n',
      }),
    );
  });

  it("blocks save and shows an inline error when the edited content has invalid JSON, without calling the API", async () => {
    render(wrap(<ResolveConflictDialog open onOpenChange={vi.fn()} conflict={CONFLICT} />));

    const textarea = await screen.findByLabelText<HTMLTextAreaElement>(/merged resolution content/i);
    await waitFor(() => expect(textarea.value).toBe('{"seq":1}\n'));

    fireEvent.change(textarea, { target: { value: "{not valid json}\n" } });
    fireEvent.click(screen.getByRole("button", { name: /save merged version/i }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/invalid json on line 1/i);
    expect(resolveConflictMock).not.toHaveBeenCalled();
  });

  it("renders nothing when no conflict is selected", () => {
    const { container } = render(
      wrap(<ResolveConflictDialog open={false} onOpenChange={vi.fn()} conflict={null} />),
    );
    expect(container.textContent).toBe("");
  });
});
