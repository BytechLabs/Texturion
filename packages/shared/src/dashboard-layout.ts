/**
 * #736: the For you page as panels a member arranges: which ones, in what
 * order, and how wide. Stored per member (`company_members.dashboard_layout`);
 * a member who never arranges anything gets `defaultDashboardLayout`, which
 * follows the queue's urgency order on every load.
 *
 * Widths are thirds of the widest screen. Heights are the panels' own, so the
 * page is packed by `placePanels`, which never leaves a hole beside a shorter
 * neighbour: a wide panel that would is narrowed until it fits.
 */
import type { DashboardTileId } from "./dashboard-tiles";

export const LAYOUT_PANEL_IDS = [
  "follow_ups",
  "unassigned",
  "waiting",
  "tasks",
  "unread",
  "outstanding_quotes",
  "recent_calls",
  "response_time",
  "pipeline",
  "satisfaction",
  "lead_sources",
] as const;

export type LayoutPanelId = (typeof LAYOUT_PANEL_IDS)[number];

/** Work owed to a customer. Taking one off the page still leaves a line saying what is waiting. */
export const QUEUE_PANEL_IDS: readonly LayoutPanelId[] = [
  "follow_ups",
  "unassigned",
  "waiting",
  "tasks",
  "unread",
];

export const PANEL_SIZES = ["third", "two_thirds", "full"] as const;

export type PanelSize = (typeof PANEL_SIZES)[number];

/** Columns a size takes on a three-column screen. */
export const PANEL_SPAN: Record<PanelSize, 1 | 2 | 3> = {
  third: 1,
  two_thirds: 2,
  full: 3,
};

export interface LayoutEntry {
  id: LayoutPanelId;
  size: PanelSize;
}

export interface DashboardLayout {
  panels: LayoutEntry[];
}

const MEASURES: readonly LayoutPanelId[] = [
  "response_time",
  "pipeline",
  "satisfaction",
  "lead_sources",
];

const QUEUE_PANEL_FOR_TILE: Record<DashboardTileId, LayoutPanelId> = {
  unassigned: "unassigned",
  waiting: "waiting",
  tasks: "tasks",
  unread: "unread",
};

/**
 * The page nobody has arranged: the measures, then "Chase these" (only there
 * because the member asked to be reminded), then the queues in the order the
 * urgency rule gives with the first one wide, then quotes and recent calls.
 */
export function defaultDashboardLayout(
  queueOrder: readonly DashboardTileId[],
): DashboardLayout {
  const queues = queueOrder.map((tile, index): LayoutEntry => ({
    id: QUEUE_PANEL_FOR_TILE[tile],
    size: index === 0 ? "two_thirds" : "third",
  }));
  return {
    panels: [
      ...MEASURES.map((id): LayoutEntry => ({ id, size: "third" })),
      { id: "follow_ups", size: "two_thirds" },
      ...queues,
      { id: "outstanding_quotes", size: "two_thirds" },
      { id: "recent_calls", size: "third" },
    ],
  };
}

function isLayoutPanelId(value: unknown): value is LayoutPanelId {
  return (LAYOUT_PANEL_IDS as readonly unknown[]).includes(value);
}

function isPanelSize(value: unknown): value is PanelSize {
  return (PANEL_SIZES as readonly unknown[]).includes(value);
}

/**
 * A stored or submitted layout made safe to render, or null for "use the
 * default". Unknown panels and sizes are dropped rather than refused, like
 * `normaliseHiddenPanels`: a layout written by a newer client should still
 * draw, and a panel this build has withdrawn simply goes.
 */
export function normaliseDashboardLayout(raw: unknown): DashboardLayout | null {
  if (typeof raw !== "object" || raw === null) return null;
  const panels = (raw as { panels?: unknown }).panels;
  if (!Array.isArray(panels)) return null;
  const seen = new Set<LayoutPanelId>();
  const clean: LayoutEntry[] = [];
  for (const entry of panels) {
    if (typeof entry !== "object" || entry === null) continue;
    const { id, size } = entry as { id?: unknown; size?: unknown };
    if (!isLayoutPanelId(id) || seen.has(id)) continue;
    seen.add(id);
    clean.push({ id, size: isPanelSize(size) ? size : "third" });
  }
  return { panels: clean };
}

/** The panels a layout leaves off, in catalogue order: what "Add a panel" offers. */
export function panelsNotInLayout(layout: DashboardLayout): LayoutPanelId[] {
  const on = new Set(layout.panels.map((entry) => entry.id));
  return LAYOUT_PANEL_IDS.filter((id) => !on.has(id));
}

export interface PanelBox {
  id: string;
  /** Columns wanted, 1 to 3; more than the screen has is clamped. */
  span: number;
  /** The panel's rendered height, in pixels. */
  height: number;
}

export interface PanelPlacement {
  id: string;
  column: number;
  span: number;
  top: number;
}

/**
 * Packs panels top-down, each at the highest place it fits.
 *
 * A panel spanning columns that end at different heights would leave a hole
 * under the shorter one, so it is placed only where those columns end within
 * `gap` of each other, and is narrowed until such a place exists. One column
 * always fits, so every panel is placed and no column ever holds a hole taller
 * than the gap beside a neighbour. `narrowToFit: false` packs without that
 * rule, for the test that proves it matters.
 */
export function placePanels(
  boxes: readonly PanelBox[],
  columns: number,
  gap: number,
  options: { narrowToFit?: boolean } = {},
): { placements: PanelPlacement[]; height: number } {
  const narrowToFit = options.narrowToFit ?? true;
  const cols = Math.max(1, Math.floor(columns));
  const nextTop: number[] = Array.from({ length: cols }, () => 0);
  const placements: PanelPlacement[] = [];

  for (const box of boxes) {
    const wanted = Math.min(cols, Math.max(1, Math.floor(box.span)));
    let chosen: PanelPlacement | null = null;
    for (let span = wanted; span >= 1 && chosen === null; span--) {
      for (let column = 0; column + span <= cols; column++) {
        const tops = nextTop.slice(column, column + span);
        const top = Math.max(...tops);
        const hole = top - Math.min(...tops);
        if (narrowToFit && hole > gap) continue;
        if (chosen === null || top < chosen.top) chosen = { id: box.id, column, span, top };
      }
      if (!narrowToFit) break;
    }
    // One column never leaves a hole, so the loop above always chooses.
    const placed = chosen as PanelPlacement;
    placements.push(placed);
    for (let column = placed.column; column < placed.column + placed.span; column++) {
      nextTop[column] = placed.top + box.height + gap;
    }
  }

  const height = placements.length === 0 ? 0 : Math.max(...nextTop) - gap;
  return { placements, height };
}

/** Third, then two thirds, then full, then back: the one width control. */
export function nextPanelSize(size: PanelSize): PanelSize {
  return PANEL_SIZES[(PANEL_SIZES.indexOf(size) + 1) % PANEL_SIZES.length];
}

/** Moves a panel `delta` places through the order, stopping at either end. */
export function movePanel(
  layout: DashboardLayout,
  id: LayoutPanelId,
  delta: number,
): DashboardLayout {
  const from = layout.panels.findIndex((entry) => entry.id === id);
  if (from === -1) return layout;
  const to = Math.min(layout.panels.length - 1, Math.max(0, from + delta));
  if (to === from) return layout;
  const panels = [...layout.panels];
  const [entry] = panels.splice(from, 1);
  panels.splice(to, 0, entry);
  return { panels };
}

/** Puts a dragged panel where the one it was dropped on stood. */
export function movePanelTo(
  layout: DashboardLayout,
  id: LayoutPanelId,
  target: LayoutPanelId,
): DashboardLayout {
  const to = layout.panels.findIndex((entry) => entry.id === target);
  const from = layout.panels.findIndex((entry) => entry.id === id);
  if (to === -1 || from === -1) return layout;
  return movePanel(layout, id, to - from);
}

export function resizePanel(
  layout: DashboardLayout,
  id: LayoutPanelId,
  size: PanelSize,
): DashboardLayout {
  return {
    panels: layout.panels.map((entry) => (entry.id === id ? { ...entry, size } : entry)),
  };
}

export function removePanel(layout: DashboardLayout, id: LayoutPanelId): DashboardLayout {
  return { panels: layout.panels.filter((entry) => entry.id !== id) };
}

/** Adds a panel at the end, a third wide; a panel already on the page stays where it is. */
export function addPanel(layout: DashboardLayout, id: LayoutPanelId): DashboardLayout {
  if (layout.panels.some((entry) => entry.id === id)) return layout;
  return { panels: [...layout.panels, { id, size: "third" }] };
}
