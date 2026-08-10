"use client";

import {
  MARKUP_HALO,
  MARKUP_HALO_SCALE,
  MARKUP_HINT,
  MARKUP_HINT_SECOND_TAP,
  MARKUP_INK,
  MARKUP_SAVE,
  MARKUP_TOOLS,
  MARKUP_TOOL_LABELS,
  MARKUP_UNDO,
  arrowHead,
  circleFromDrag,
  isDeliberateDrag,
  markedUpFileName,
  markupStrokeWidth,
  type MarkupPoint,
  type MarkupTool,
} from "@loonext/shared";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useT } from "@/i18n/provider";
import { cn } from "@/lib/utils";

/**
 * #294 — draw on a photo before it goes.
 *
 * ## Evaluation
 *
 * "An arrow and a circle on a photo beats a paragraph explaining where to look, and
 * takes three seconds instead of thirty." The whole value is in those three seconds,
 * so every decision here is about not spending them.
 *
 * ## What binds it
 *
 * *Zen of Clarity* — two tools, one colour, one undo. No layers, no text, no
 * freehand, no picker. A drawing app is a different product, and every control added
 * here is a control somebody has to skip past on a job.
 *
 * *Smart Defaults* — Arrow is selected on open, because pointing at something is what
 * nine out of ten of these are. The one fixed colour is red with a white halo, which
 * is legible on brick, on rust and on a white bathroom wall — the problem a colour
 * picker exists to solve, solved without asking.
 *
 * *Prioritize Intent* — the photo fills the dialog. The tools are a single row under
 * it, and the hint is one line that says what to do rather than what the app is.
 *
 * ## Why it edits the staged copy
 *
 * D28 keeps two doors into the system, so an annotated photo must be an ordinary note
 * attachment rather than a new kind of thing. The marks are burned into the bytes
 * here and the staged file is replaced. Nothing is destroyed: the original is still
 * in the camera roll or on the disk it was picked from, and this copy has not been
 * sent anywhere yet.
 */

interface Mark {
  tool: MarkupTool;
  from: MarkupPoint;
  to: MarkupPoint;
}

export function PhotoMarkupDialog({
  file,
  onDone,
  onCancel,
}: {
  /** The staged image, or null when nothing is being marked up. */
  file: File | null;
  /** The replacement. Called once, with JPEG bytes and a name that says .jpg. */
  onDone: (marked: File) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [tool, setTool] = useState<MarkupTool>("arrow");
  const [marks, setMarks] = useState<Mark[]>([]);
  const [dragging, setDragging] = useState<Mark | null>(null);
  /**
   * WCAG 2.5.7 — the way to make a mark WITHOUT dragging.
   *
   * A drag is the fast gesture and most people will use it, but a screen-reader
   * user, somebody with a tremor, or anybody whose touch never registers as a drag
   * would otherwise be unable to annotate at all. So a tap sets this anchor and the
   * next tap finishes the mark: two pointer-downs, no movement required, same
   * result.
   */
  const [anchor, setAnchor] = useState<MarkupPoint | null>(null);
  const [saving, setSaving] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Decode when a file arrives, and let the bitmap go when the dialog closes: a
  // 25 MB photo held after the fact is 25 MB of a phone browser's memory.
  useEffect(() => {
    if (file === null) {
      setImage(null);
      setMarks([]);
      setDragging(null);
      setAnchor(null);
      return;
    }
    const url = URL.createObjectURL(file);
    const next = new Image();
    next.onload = () => setImage(next);
    next.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // Redraw on every change. Cheap: one photo, at most a handful of marks.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || image === null) return;
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (ctx === null) return;
    ctx.drawImage(image, 0, 0);
    const stroke = markupStrokeWidth(canvas.width, canvas.height);
    // The anchored point shows as a mark to itself: a dot the size of the stroke,
    // so a person who tapped can see where they tapped.
    const pending: Mark[] = dragging
      ? [dragging]
      : anchor
        ? [{ tool, from: anchor, to: anchor }]
        : [];
    for (const mark of [...marks, ...pending]) {
      // Halo first, then ink on top of it. That order is what makes one fixed
      // colour legible on any photograph.
      drawMark(ctx, mark, stroke * MARKUP_HALO_SCALE, MARKUP_HALO);
      drawMark(ctx, mark, stroke, MARKUP_INK);
    }
  }, [image, marks, dragging, anchor, tool]);

  /** Pointer position in IMAGE pixels — the canvas is displayed scaled. */
  const at = (event: React.PointerEvent<HTMLCanvasElement>): MarkupPoint => {
    const canvas = event.currentTarget;
    const box = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - box.left) / box.width) * canvas.width,
      y: ((event.clientY - box.top) / box.height) * canvas.height,
    };
  };

  const save = () => {
    const canvas = canvasRef.current;
    if (canvas === null || file === null) return;
    setSaving(true);
    canvas.toBlob(
      (blob) => {
        setSaving(false);
        if (blob === null) return;
        onDone(
          new File([blob], markedUpFileName(file.name), { type: "image/jpeg" }),
        );
      },
      "image/jpeg",
      // 0.9: the marks must stay crisp, and this is a photo somebody will look at
      // closely enough to read a serial number off.
      0.9,
    );
  };

  return (
    <Dialog open={file !== null} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("misc.markupTitle")}</DialogTitle>
        </DialogHeader>

        <div className="space-y-2">
          <canvas
            ref={canvasRef}
            // `touch-none`: without it a drag scrolls the dialog on a phone
            // instead of drawing, which is the only device this really matters on.
            className="max-h-[60vh] w-full touch-none rounded-lg border bg-muted object-contain"
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              const start = at(event);
              setDragging({ tool, from: start, to: start });
            }}
            onPointerMove={(event) => {
              if (dragging === null) return;
              setDragging({ ...dragging, to: at(event) });
            }}
            onPointerUp={() => {
              if (dragging === null) return;
              const canvas = canvasRef.current;
              const moved =
                canvas !== null &&
                isDeliberateDrag(dragging.from, dragging.to, canvas.width, canvas.height);
              setDragging(null);

              if (moved) {
                // Dragged: the mark is the drag, and any half-set anchor is stale.
                setMarks((current) => [...current, dragging]);
                setAnchor(null);
                return;
              }

              // Tapped. First tap anchors, second tap finishes — the single-pointer
              // path (WCAG 2.5.7). Nothing is drawn from a lone tap, so a stray one
              // while looking at the photo cannot leave a dot on a job record.
              if (anchor === null) {
                setAnchor(dragging.to);
                return;
              }
              if (
                canvas !== null &&
                isDeliberateDrag(anchor, dragging.to, canvas.width, canvas.height)
              ) {
                setMarks((current) => [...current, { tool, from: anchor, to: dragging.to }]);
              }
              setAnchor(null);
            }}
          />

          <div className="flex flex-wrap items-center gap-1.5">
            {MARKUP_TOOLS.map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={tool === option}
                onClick={() => setTool(option)}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-[12.5px] transition-colors",
                  tool === option
                    ? "border-transparent bg-app-ink text-app-paper"
                    : "border-app-line text-muted-foreground hover:bg-app-hover",
                )}
              >
                {MARKUP_TOOL_LABELS[option]}
              </button>
            ))}
            <Button
              variant="ghost"
              size="sm"
              disabled={marks.length === 0}
              onClick={() => setMarks((current) => current.slice(0, -1))}
            >
              {MARKUP_UNDO}
            </Button>
            {/* The hint changes to name the half-finished mark, because a person
                who tapped once needs to know the app is waiting for them rather
                than that nothing happened. */}
            <span className="text-[12px] text-muted-foreground">
              {anchor === null ? MARKUP_HINT : MARKUP_HINT_SECOND_TAP}
            </span>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onCancel} disabled={saving}>
            {t("common.cancel")}
          </Button>
          <Button onClick={save} disabled={saving || marks.length === 0}>
            {saving ? t("common.saving") : MARKUP_SAVE}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * One mark, in one colour, at one width.
 *
 * Called twice per mark — once wide in white, once narrow in red — which is the
 * whole of the "no colour picker" decision.
 */
function drawMark(
  ctx: CanvasRenderingContext2D,
  mark: Mark,
  width: number,
  colour: string,
): void {
  ctx.strokeStyle = colour;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  if (mark.tool === "circle") {
    const { cx, cy, rx, ry } = circleFromDrag(mark.from, mark.to);
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();
    return;
  }

  ctx.beginPath();
  ctx.moveTo(mark.from.x, mark.from.y);
  ctx.lineTo(mark.to.x, mark.to.y);
  ctx.stroke();

  const [left, right] = arrowHead(mark.from, mark.to, width);
  ctx.beginPath();
  ctx.moveTo(left.x, left.y);
  ctx.lineTo(mark.to.x, mark.to.y);
  ctx.lineTo(right.x, right.y);
  ctx.stroke();
}
