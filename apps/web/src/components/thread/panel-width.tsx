"use client";

import { GripVertical, MoreHorizontal } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useT } from "@/i18n/provider";

// Persisted side-panel width. Clamped so the thread column (min-w-0) is never
// crushed even at a 1280px viewport.
export const PANEL_WIDTH_KEY = "loonext:contact-panel-width";
export const PANEL_MIN_WIDTH = 260;
export const PANEL_MAX_WIDTH = 560;
export const PANEL_DEFAULT_WIDTH = 300;
export const PANEL_WIDTH_NUDGE = 16;
export const PANEL_WIDTH_BIG_NUDGE = 64;
/** The panel's own ⋯ menu lists these; they never live on the grip (#742). */
export const PANEL_WIDTH_PRESETS = [
  { width: PANEL_MIN_WIDTH, labelKey: "thread.panelWidthNarrow" },
  { width: PANEL_DEFAULT_WIDTH, labelKey: "thread.panelWidthDefault" },
  { width: 440, labelKey: "thread.panelWidthWide" },
] as const;

export function clampPanelWidth(px: number): number {
  // Whole CSS pixels, so drag, keys and presets share one stable value.
  return Math.min(PANEL_MAX_WIDTH, Math.max(PANEL_MIN_WIDTH, Math.round(px)));
}

function readPanelWidth(): number {
  if (typeof window === "undefined") return PANEL_DEFAULT_WIDTH;
  try {
    const raw = window.localStorage.getItem(PANEL_WIDTH_KEY);
    const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
    return Number.isFinite(parsed) ? clampPanelWidth(parsed) : PANEL_DEFAULT_WIDTH;
  } catch {
    return PANEL_DEFAULT_WIDTH;
  }
}

function persistPanelWidth(px: number): void {
  try {
    window.localStorage.setItem(PANEL_WIDTH_KEY, String(px));
  } catch {
    /* preference only: losing it is harmless. */
  }
}

/** The width, the live setter a drag calls, and the setter that also saves. */
export function usePanelWidth() {
  const [width, setWidth] = useState(PANEL_DEFAULT_WIDTH);
  // Read after mount so server and first client render agree.
  useEffect(() => {
    setWidth(readPanelWidth());
  }, []);
  const widthRef = useRef(width);
  widthRef.current = width;
  const resize = useCallback((px: number) => setWidth(clampPanelWidth(px)), []);
  const commit = useCallback((px: number) => {
    const next = clampPanelWidth(px);
    setWidth(next);
    persistPanelWidth(next);
  }, []);
  return { width, widthRef, resize, commit };
}

/**
 * The panel's left edge. The whole edge, grip pill included, starts a drag:
 * the pill is decoration inside the separator, not a control of its own.
 * Without a drag: arrows step (Shift further, Home and End to the limits) and
 * a double-click resets; the preset widths are in {@link PanelOverflowMenu}.
 */
export function PanelResizeHandle({
  width,
  widthRef,
  onResize,
  onCommit,
}: {
  width: number;
  widthRef: { readonly current: number };
  onResize: (px: number) => void;
  onCommit: (px: number) => void;
}) {
  const t = useT();

  const startResize = (event: React.PointerEvent) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = widthRef.current;
    let latest = startWidth;
    const onMove = (moveEvent: PointerEvent) => {
      // The handle is on the left edge, so dragging left (clientX down) widens.
      latest = clampPanelWidth(startWidth + (startX - moveEvent.clientX));
      onResize(latest);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      onCommit(latest);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={t("thread.resizePanelAria")}
      // A focusable, arrow-key-operable separator behaves like a slider, so it
      // exposes its current, min and max width.
      aria-valuenow={Math.round(width)}
      aria-valuemin={PANEL_MIN_WIDTH}
      aria-valuemax={PANEL_MAX_WIDTH}
      aria-valuetext={t("thread.panelWidthAria", { pixels: Math.round(width) })}
      tabIndex={0}
      onPointerDown={startResize}
      onDoubleClick={() => onCommit(PANEL_DEFAULT_WIDTH)}
      onKeyDown={(event) => {
        const step = event.shiftKey ? PANEL_WIDTH_BIG_NUDGE : PANEL_WIDTH_NUDGE;
        // The handle is the left edge, so left widens.
        const target =
          event.key === "ArrowLeft"
            ? width + step
            : event.key === "ArrowRight"
              ? width - step
              : event.key === "Home"
                ? PANEL_MIN_WIDTH
                : event.key === "End"
                  ? PANEL_MAX_WIDTH
                  : null;
        if (target === null) return;
        event.preventDefault();
        onCommit(target);
      }}
      className="absolute inset-y-0 -left-1.5 z-10 w-3 cursor-col-resize touch-none select-none transition-colors hover:bg-app-tint-line focus-visible:bg-app-olive/40 focus-visible:outline-none"
    >
      {/* Always visible, so the drag is findable without hovering. */}
      <span
        aria-hidden
        data-testid="panel-grip"
        className="absolute top-1/2 -left-0.5 flex h-8 w-4 -translate-y-1/2 items-center justify-center rounded-full border border-app-line bg-app-paper text-app-muted-2"
      >
        <GripVertical className="size-3" strokeWidth={1.75} aria-hidden />
      </span>
    </div>
  );
}

/** The panel's ⋯ menu: the no-drag way to pick a width. */
export function PanelOverflowMenu({
  width,
  onCommit,
}: {
  width: number;
  onCommit: (px: number) => void;
}) {
  const t = useT();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t("thread.panelOptionsAria")}
          className="tap-target grid size-8 place-items-center rounded-full text-app-muted-2 transition-colors hover:bg-app-hover hover:text-app-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <MoreHorizontal className="size-4" strokeWidth={1.75} aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{t("thread.panelWidthLabel")}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={String(width)}>
          {PANEL_WIDTH_PRESETS.map((preset) => (
            <DropdownMenuRadioItem
              key={preset.width}
              value={String(preset.width)}
              onSelect={() => onCommit(preset.width)}
            >
              {t(preset.labelKey)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
