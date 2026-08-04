import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ConflictDiffView } from "./ConflictDiffView.js";

describe("ConflictDiffView", () => {
  it("renders unchanged lines in both columns without highlighting", () => {
    render(<ConflictDiffView canonical={'{"seq":1}\n'} candidate={'{"seq":1}\n'} />);

    const occurrences = screen.getAllByText('{"seq":1}');
    expect(occurrences).toHaveLength(2);
    for (const el of occurrences) {
      expect(el.className).not.toMatch(/destructive|success/);
    }
  });

  it("highlights a line only in canonical as removed (destructive)", () => {
    render(
      <ConflictDiffView
        canonical={'{"seq":1}\n{"seq":2}\n'}
        candidate={'{"seq":1}\n'}
      />,
    );

    const removed = screen.getByText('{"seq":2}');
    expect(removed.className).toMatch(/destructive/);
  });

  it("highlights a line only in candidate as added (success)", () => {
    render(
      <ConflictDiffView
        canonical={'{"seq":1}\n'}
        candidate={'{"seq":1}\n{"seq":2}\n'}
      />,
    );

    const added = screen.getByText('{"seq":2}');
    expect(added.className).toMatch(/success/);
  });

  it("pairs a replaced line into one row: removed on the left, added on the right", () => {
    render(
      <ConflictDiffView
        canonical={'{"seq":1}\n{"seq":2,"old":true}\n'}
        candidate={'{"seq":1}\n{"seq":2,"new":true}\n'}
      />,
    );

    const removedCell = screen.getByText('{"seq":2,"old":true}');
    const addedCell = screen.getByText('{"seq":2,"new":true}');
    expect(removedCell.className).toMatch(/destructive/);
    expect(addedCell.className).toMatch(/success/);

    // Same row: both cells share the same grid-row ancestor.
    const row = removedCell.closest("div.grid");
    expect(row?.contains(addedCell)).toBe(true);
  });

  it("shows an empty-state message when both sides are empty", () => {
    render(<ConflictDiffView canonical="" candidate="" />);

    expect(screen.getByText(/both versions are empty/i)).toBeDefined();
  });
});
