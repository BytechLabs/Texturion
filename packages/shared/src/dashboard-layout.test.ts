import { describe, expect, it } from "vitest";

import {
  addPanel,
  defaultDashboardLayout,
  LAYOUT_PANEL_IDS,
  movePanel,
  movePanelTo,
  nextPanelSize,
  normaliseDashboardLayout,
  panelsNotInLayout,
  placePanels,
  removePanel,
  resizePanel,
  type PanelBox,
  type PanelPlacement,
} from "./dashboard-layout";

const GAP = 24;

/** The tallest stretch of empty space above any panel, in any column. */
function tallestHole(
  boxes: readonly PanelBox[],
  placements: readonly PanelPlacement[],
  columns: number,
): number {
  const height = new Map(boxes.map((box) => [box.id, box.height]));
  let worst = 0;
  for (let column = 0; column < columns; column++) {
    const inColumn = placements
      .filter((p) => p.column <= column && column < p.column + p.span)
      .sort((a, b) => a.top - b.top);
    let end = 0;
    for (const p of inColumn) {
      const expected = end === 0 ? 0 : end + GAP;
      worst = Math.max(worst, p.top - expected);
      end = p.top + (height.get(p.id) ?? 0);
    }
  }
  return worst;
}

/** A small deterministic generator, so a failure names a reproducible case. */
function rng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

describe("#736 placePanels never leaves a hole", () => {
  it("packs every mix of widths and 0 to 10 rows of height without a hole taller than the gap", () => {
    const next = rng(736);
    let layouts = 0;
    for (let round = 0; round < 2000; round++) {
      const count = 1 + Math.floor(next() * 11);
      const boxes: PanelBox[] = Array.from({ length: count }, (_, i) => ({
        id: `p${i}`,
        span: 1 + Math.floor(next() * 3),
        // A header and 0 to 10 rows of 64px.
        height: 48 + Math.floor(next() * 11) * 64,
      }));
      for (const columns of [1, 2, 3]) {
        const { placements } = placePanels(boxes, columns, GAP);
        expect(placements).toHaveLength(boxes.length);
        const hole = tallestHole(boxes, placements, columns);
        expect(hole, `round ${round}, ${columns} columns`).toBeLessThanOrEqual(GAP);
        layouts += 1;
      }
    }
    // Coverage, stated: an empty sample would pass every assertion above.
    expect(layouts).toBe(6000);
  });

  it("is the rule that matters: packing without it reproduces the founder's screenshot", () => {
    // A short first queue, seven unassigned beside it, recent calls full width.
    const boxes: PanelBox[] = [
      { id: "waiting", span: 2, height: 200 },
      { id: "unassigned", span: 1, height: 520 },
      { id: "recent_calls", span: 3, height: 250 },
    ];
    const naive = placePanels(boxes, 3, GAP, { narrowToFit: false });
    expect(tallestHole(boxes, naive.placements, 3)).toBeGreaterThan(300);

    const packed = placePanels(boxes, 3, GAP);
    expect(tallestHole(boxes, packed.placements, 3)).toBeLessThanOrEqual(GAP);
    // Recent calls fills the space under the short queue instead.
    const calls = packed.placements.find((p) => p.id === "recent_calls");
    expect(calls).toMatchObject({ column: 0, span: 2, top: 200 + GAP });
  });

  it("keeps a member's width wherever the columns allow it", () => {
    const { placements } = placePanels(
      [
        { id: "a", span: 3, height: 100 },
        { id: "b", span: 2, height: 100 },
        { id: "c", span: 1, height: 100 },
      ],
      3,
      GAP,
    );
    expect(placements.map((p) => p.span)).toEqual([3, 2, 1]);
  });

  it("fits a three-column layout on two columns and on one", () => {
    const boxes = [
      { id: "a", span: 3, height: 100 },
      { id: "b", span: 2, height: 100 },
    ];
    expect(placePanels(boxes, 2, GAP).placements.map((p) => p.span)).toEqual([2, 2]);
    expect(placePanels(boxes, 1, GAP).placements.map((p) => p.top)).toEqual([0, 124]);
  });
});

describe("#736 the stored layout", () => {
  it("drops unknown panels, repeats and bad sizes rather than refusing the layout", () => {
    expect(
      normaliseDashboardLayout({
        panels: [
          { id: "recent_calls", size: "full" },
          { id: "recent_calls", size: "third" },
          { id: "a_panel_from_the_future", size: "third" },
          { id: "pipeline", size: "enormous" },
        ],
      }),
    ).toEqual({
      panels: [
        { id: "recent_calls", size: "full" },
        { id: "pipeline", size: "third" },
      ],
    });
    expect(normaliseDashboardLayout(null)).toBeNull();
    expect(normaliseDashboardLayout({ panels: "no" })).toBeNull();
  });

  it("starts with every panel on the page, the most urgent queue wide", () => {
    const layout = defaultDashboardLayout(["waiting", "unassigned", "tasks", "unread"]);
    expect(panelsNotInLayout(layout)).toEqual([]);
    expect(layout.panels.map((p) => p.id).sort()).toEqual([...LAYOUT_PANEL_IDS].sort());
    expect(layout.panels.find((p) => p.id === "waiting")?.size).toBe("two_thirds");
    expect(layout.panels.find((p) => p.id === "unassigned")?.size).toBe("third");
  });
});

describe("#736 arranging the page", () => {
  const base = {
    panels: [
      { id: "unassigned" as const, size: "two_thirds" as const },
      { id: "waiting" as const, size: "third" as const },
      { id: "recent_calls" as const, size: "third" as const },
    ],
  };
  const ids = (layout: { panels: { id: string }[] }) => layout.panels.map((p) => p.id);

  it("moves a panel through the order and stops at the ends", () => {
    expect(ids(movePanel(base, "recent_calls", -1))).toEqual(["unassigned", "recent_calls", "waiting"]);
    expect(ids(movePanel(base, "unassigned", -1))).toEqual(ids(base));
    expect(ids(movePanel(base, "unassigned", 9))).toEqual(["waiting", "recent_calls", "unassigned"]);
  });

  it("drops a dragged panel where the target stood", () => {
    expect(ids(movePanelTo(base, "recent_calls", "unassigned"))).toEqual([
      "recent_calls",
      "unassigned",
      "waiting",
    ]);
  });

  it("cycles width, removes, and adds at the end without doubling", () => {
    expect(nextPanelSize("third")).toBe("two_thirds");
    expect(nextPanelSize("full")).toBe("third");
    expect(resizePanel(base, "waiting", "full").panels[1]).toEqual({ id: "waiting", size: "full" });
    const without = removePanel(base, "waiting");
    expect(ids(without)).toEqual(["unassigned", "recent_calls"]);
    expect(ids(addPanel(without, "waiting"))).toEqual(["unassigned", "recent_calls", "waiting"]);
    expect(addPanel(base, "waiting")).toBe(base);
  });
});
