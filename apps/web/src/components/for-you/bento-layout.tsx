"use client";

import {
  type LayoutPanelId,
  PANEL_SPAN,
  type PanelSize,
  placePanels,
} from "@loonext/shared";
import { ArrowLeft, ArrowRight, Columns3, GripVertical, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { useT } from "@/i18n/provider";
import { cn } from "@/lib/utils";

import { PANEL_LABEL_KEYS, PANEL_SIZE_KEYS } from "./panel-catalogue";

/** Space between panels, in pixels: the page's own 24px rhythm. */
export const BENTO_GAP = 24;

/** Columns for the width the page actually has, which the sidebar changes. */
export function columnsForWidth(width: number): number {
  if (width >= 1040) return 3;
  if (width >= 680) return 2;
  return 1;
}

export interface BentoCell {
  id: LayoutPanelId;
  size: PanelSize;
  node: React.ReactNode;
}

export interface BentoEditing {
  onMove: (id: LayoutPanelId, delta: number) => void;
  onMoveTo: (id: LayoutPanelId, target: LayoutPanelId) => void;
  onResize: (id: LayoutPanelId) => void;
  onRemove: (id: LayoutPanelId) => void;
}

/** Watches one element's rendered height; the browsers without ResizeObserver report nothing. */
function useHeight(onHeight: (height: number) => void): React.RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement | null>(null);
  const latest = useRef(onHeight);
  latest.current = onHeight;
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      latest.current(Math.round(entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return ref;
}

/**
 * #736 — the For you panels, packed by their real heights so no column holds
 * a hole beside a shorter neighbour (`placePanels`).
 *
 * Panels are measured where they stand and then placed absolutely. A panel
 * whose content renders nothing (an empty queue, a measure with nothing true
 * to say yet) takes no place at all, but stays mounted and measured, so it
 * appears the moment it has something. Until every panel has been measured,
 * or on a single column, the panels simply stack.
 */
export function BentoLayout({
  cells,
  editing,
}: {
  cells: readonly BentoCell[];
  /** Present while the member is arranging the page. */
  editing?: BentoEditing;
}) {
  const [width, setWidth] = useState(0);
  const [heights, setHeights] = useState<Partial<Record<LayoutPanelId, number>>>({});
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const element = containerRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const columns = width > 0 ? columnsForWidth(width) : 1;
  const measured = cells.every((cell) => heights[cell.id] !== undefined);
  const shown = useMemo(
    () => cells.filter((cell) => (heights[cell.id] ?? 1) > 0),
    [cells, heights],
  );

  const layout = useMemo(
    () =>
      placePanels(
        shown.map((cell) => ({
          id: cell.id,
          span: PANEL_SPAN[cell.size],
          height: heights[cell.id] ?? 0,
        })),
        columns,
        BENTO_GAP,
      ),
    [shown, heights, columns],
  );
  const placed = new Map(layout.placements.map((p) => [p.id as LayoutPanelId, p]));
  const positioned = measured && width > 0;

  return (
    <div
      ref={containerRef}
      className={cn("relative", !positioned && "flex flex-col gap-6")}
      style={positioned ? { height: layout.height } : undefined}
    >
      {cells.map((cell, index) => {
        const place = placed.get(cell.id);
        const style: React.CSSProperties | undefined = !positioned
          ? undefined
          : place
            ? {
                position: "absolute",
                top: place.top,
                left: `calc((100% + ${BENTO_GAP}px) * ${place.column} / ${columns})`,
                width: `calc((100% + ${BENTO_GAP}px) * ${place.span} / ${columns} - ${BENTO_GAP}px)`,
              }
            : {
                position: "absolute",
                top: 0,
                left: 0,
                width: `calc((100% + ${BENTO_GAP}px) / ${columns} - ${BENTO_GAP}px)`,
                visibility: "hidden",
              };
        return (
          <PanelFrame
            key={cell.id}
            cell={cell}
            position={index}
            count={cells.length}
            style={style}
            animate={positioned}
            editing={editing}
            onHeight={(height) =>
              setHeights((previous) =>
                previous[cell.id] === height ? previous : { ...previous, [cell.id]: height },
              )
            }
          />
        );
      })}
    </div>
  );
}

function PanelFrame({
  cell,
  position,
  count,
  style,
  animate,
  editing,
  onHeight,
}: {
  cell: BentoCell;
  position: number;
  count: number;
  style: React.CSSProperties | undefined;
  animate: boolean;
  editing: BentoEditing | undefined;
  onHeight: (height: number) => void;
}) {
  const t = useT();
  const [contentHeight, setContentHeight] = useState<number | null>(null);
  const frameRef = useHeight(onHeight);
  const contentRef = useHeight(setContentHeight);
  const [dropTarget, setDropTarget] = useState(false);
  const panel = t(PANEL_LABEL_KEYS[cell.id]);
  const size = t(PANEL_SIZE_KEYS[cell.size]);

  return (
    <div
      ref={frameRef}
      style={style}
      className={cn(
        animate && "motion-safe:transition-[top,left,width] motion-safe:duration-200 motion-safe:ease-out",
        editing && "rounded-app-card outline-dashed outline-1 outline-offset-4 outline-app-line",
        dropTarget && "outline-2 outline-app-olive",
      )}
      onDragOver={
        editing
          ? (event) => {
              event.preventDefault();
              setDropTarget(true);
            }
          : undefined
      }
      onDragLeave={editing ? () => setDropTarget(false) : undefined}
      onDrop={
        editing
          ? (event) => {
              event.preventDefault();
              setDropTarget(false);
              const dragged = event.dataTransfer.getData("text/plain") as LayoutPanelId;
              if (dragged && dragged !== cell.id) editing.onMoveTo(dragged, cell.id);
            }
          : undefined
      }
    >
      {editing && (
        <div className="mb-2 flex items-center gap-1">
          <span
            draggable
            onDragStart={(event) => {
              event.dataTransfer.setData("text/plain", cell.id);
              event.dataTransfer.effectAllowed = "move";
            }}
            aria-label={t("inbox.forYouDragPanel", { panel })}
            role="img"
            className="grid size-8 cursor-grab place-items-center rounded-[9px] text-app-muted active:cursor-grabbing"
          >
            <GripVertical className="size-4" strokeWidth={1.75} aria-hidden />
          </span>
          {/* A panel with content shows its own heading; only an empty one
              needs naming here. */}
          <span className="mr-auto min-w-0 truncate text-[12.5px] font-medium text-app-ink">
            {contentHeight === 0 ? panel : null}
          </span>
          <EditButton
            label={t("inbox.forYouMoveEarlier", { panel })}
            disabled={position === 0}
            onClick={() => editing.onMove(cell.id, -1)}
          >
            <ArrowLeft className="size-4" strokeWidth={1.75} aria-hidden />
          </EditButton>
          <EditButton
            label={t("inbox.forYouMoveLater", { panel })}
            disabled={position === count - 1}
            onClick={() => editing.onMove(cell.id, 1)}
          >
            <ArrowRight className="size-4" strokeWidth={1.75} aria-hidden />
          </EditButton>
          <EditButton
            label={t("inbox.forYouResizePanel", { panel, size })}
            onClick={() => editing.onResize(cell.id)}
          >
            <Columns3 className="size-4" strokeWidth={1.75} aria-hidden />
          </EditButton>
          <EditButton label={t("inbox.forYouRemovePanel", { panel })} onClick={() => editing.onRemove(cell.id)}>
            <X className="size-4" strokeWidth={1.75} aria-hidden />
          </EditButton>
        </div>
      )}
      {/* While arranging, a panel is something to move, not to use. */}
      <div ref={contentRef} inert={editing ? true : undefined}>
        {cell.node}
      </div>
      {editing && contentHeight === 0 && (
        <p className="rounded-app-card border border-dashed border-app-line px-4 py-6 text-center text-[13px] text-app-muted">
          {t("inbox.forYouPanelEmpty")}
        </p>
      )}
    </div>
  );
}

function EditButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="tap-target grid size-8 place-items-center rounded-[9px] text-app-muted transition-colors hover:bg-app-hover hover:text-app-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
    >
      {children}
    </button>
  );
}
