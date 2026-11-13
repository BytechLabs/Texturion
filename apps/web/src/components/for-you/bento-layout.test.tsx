/**
 * @vitest-environment happy-dom
 *
 * #736: For you painted one stacked column first, then re-placed every panel
 * from heights measured at the wrong width, then animated the correction, on
 * every visit. The packed layout has to exist in the first commit, before a
 * ResizeObserver has said anything (happy-dom's never does), with every panel
 * measured at the width it is drawn at.
 */
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BENTO_GAP, BentoLayout, type BentoCell } from "./bento-layout";

const CONTAINER_WIDTH = 1100;
const THIRD = `calc((100% + ${BENTO_GAP}px) * 1 / 3 - ${BENTO_GAP}px)`;

/** The frame widths each panel had when its height was read. */
let measuredAt: Record<string, string[]>;

function panel(name: string, height: number): React.ReactNode {
  return <div data-panel={name} data-height={height} />;
}

function cells(): BentoCell[] {
  return [
    { id: "waiting", size: "third", node: panel("waiting", 100) },
    { id: "tasks", size: "third", node: panel("tasks", 200) },
    { id: "unread", size: "third", node: panel("unread", 50) },
    { id: "pipeline", size: "third", node: panel("pipeline", 0) },
  ];
}

/** The frame (outer div) that carries one panel. */
function frameOf(root: HTMLElement, name: string): HTMLElement {
  const node = root.querySelector<HTMLElement>(`[data-panel="${name}"]`);
  return node!.parentElement!.parentElement!;
}

beforeEach(() => {
  measuredAt = {};
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    const node = this.firstElementChild?.firstElementChild;
    const name = node?.getAttribute("data-panel");
    let width = 0;
    let height = 0;
    if (name) {
      (measuredAt[name] ??= []).push(this.style.width);
      height = Number(node!.getAttribute("data-height"));
    } else if (this.querySelector("[data-panel]")) {
      width = CONTAINER_WIDTH;
    }
    return { width, height, top: 0, left: 0, x: 0, y: 0, right: width, bottom: height } as DOMRect;
  });
});

afterEach(cleanup);

describe("BentoLayout first paint", () => {
  it("is packed into columns in the first commit, with no ResizeObserver report", () => {
    const root = render(<BentoLayout cells={cells()} />).container;

    const lefts = ["waiting", "tasks", "unread"].map((name) => {
      const frame = frameOf(root, name);
      expect(frame.style.position, name).toBe("absolute");
      expect(frame.style.width, name).toBe(THIRD);
      return frame.style.left;
    });
    expect(new Set(lefts).size).toBe(3);
    // The tallest column, not the stack of all three.
    expect((root.firstElementChild as HTMLElement).style.height).toBe("200px");
  });

  it("reads each height at the column width the panel is drawn at", () => {
    render(<BentoLayout cells={cells()} />);
    for (const name of ["waiting", "tasks", "unread"]) {
      expect(measuredAt[name], name).toEqual([THIRD]);
    }
  });

  it("keeps a panel with nothing to show mounted, measured and out of the way", () => {
    const root = render(<BentoLayout cells={cells()} />).container;
    const empty = frameOf(root, "pipeline");
    expect(measuredAt.pipeline?.length).toBeGreaterThan(0);
    expect(empty.style.visibility).toBe("hidden");
  });

  it("does not glide into its first placement, then glides top and left only", async () => {
    const root = render(<BentoLayout cells={cells()} />).container;
    const frame = frameOf(root, "tasks");
    expect(frame.className).not.toContain("transition");

    await waitFor(() => expect(frame.className).toContain("transition-[top,left]"));
    expect(frame.className).not.toContain("width");
  });
});
