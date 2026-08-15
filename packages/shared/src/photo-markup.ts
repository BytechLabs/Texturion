/**
 * #294 — an arrow and a circle on a photo.
 *
 * The issue's own words: "an arrow and a circle on a photo beats a paragraph
 * explaining where to look, and takes three seconds instead of thirty."
 *
 * ## Why it is drawn into the picture rather than stored beside it
 *
 * D28 says attachments enter through exactly two doors and a task's files are a
 * derived view. An overlay stored as its own object would be a third thing to
 * upload, a third thing to keep in step with the photo, and a third thing that can
 * arrive without it. So the marks are burned into the bytes on the client, and what
 * reaches the server is an ordinary note attachment that happens to have an arrow on
 * it. Every existing rule — the size cap, the type check, the scan, the location
 * strip — applies to it unchanged, because it is not a special kind of file.
 *
 * The original is not destroyed by this: the photo is still in the camera roll, or
 * on the disk it was picked from. What is replaced is the STAGED copy, before it has
 * been sent anywhere.
 *
 * ## Why there is no colour picker
 *
 * One colour, always, with a light halo behind it. A picker is a decision somebody
 * has to make while standing in a customer's kitchen with wet hands, and the reason
 * pickers exist — red vanishing against brick or rust — is solved better by the halo
 * than by asking. Two strokes, one dark and one light, are legible on every
 * photograph a trade takes.
 */

/** The two marks. Anything more is a drawing app, which this is not. */
export const MARKUP_TOOLS = ["arrow", "circle"] as const;

export type MarkupTool = (typeof MARKUP_TOOLS)[number];

export const MARKUP_TOOL_LABELS: Record<MarkupTool, string> = {
  arrow: "domain.markupArrow",
  circle: "domain.markupCircle",
};

/** The one line of instruction, for somebody who has never opened this. */
/**
 * Every catalogue key this module names.
 *
 * All six, not the two the string ledger counts. "Arrow", "Circle", "Done" and
 * "Undo" are below its prose threshold — they are single words — but they are
 * read by a person on a photo editor and both phones have said them in French
 * for months. Converting only the sentences would have left four words English
 * on the web while the Kotlin pin that checks all six had to be split in half.
 */
export type MarkupKey =
  | "domain.markupArrow"
  | "domain.markupCircle"
  | "domain.markupHint"
  | "domain.markupHintSecondTap"
  | "domain.markupSave"
  | "domain.markupUndo";

export const MARKUP_HINT: MarkupKey = "domain.markupHint";

/**
 * What it says once a first tap has landed.
 *
 * The tap-tap path is WCAG 2.5.7's requirement — every dragging movement needs a
 * single-pointer alternative — and it only works if the person can tell the app is
 * waiting for them rather than that their tap did nothing.
 */
export const MARKUP_HINT_SECOND_TAP: MarkupKey = "domain.markupHintSecondTap";

/** Puts the marks on and closes. */
export const MARKUP_SAVE: MarkupKey = "domain.markupSave";

/** Takes the last mark off. Not a full undo stack — one step is what a thumb wants. */
export const MARKUP_UNDO: MarkupKey = "domain.markupUndo";

/** The mark itself: a strong red that reads as deliberate rather than decorative. */
export const MARKUP_INK = "#E23D28";

/**
 * The halo drawn under it.
 *
 * White, and wider than the ink. This is what makes one fixed colour work: red on
 * red brick disappears, red with a white edge does not, and neither does white with
 * a red edge on a bathroom wall.
 */
export const MARKUP_HALO = "#FFFFFF";

/** A point in image pixels, not screen pixels. */
export interface MarkupPoint {
  x: number;
  y: number;
}

/**
 * How thick to draw, for an image of this size.
 *
 * Proportional, because a 3-pixel line on a 4000-pixel photo is invisible at the
 * size anybody views it, and a 30-pixel line on a 600-pixel thumbnail covers the
 * thing it is pointing at. Clamped at both ends so a panorama and a tiny crop both
 * come out usable.
 */
export function markupStrokeWidth(width: number, height: number): number {
  const shortest = Math.min(Math.abs(width), Math.abs(height));
  if (!Number.isFinite(shortest) || shortest <= 0) return MIN_STROKE;
  return Math.max(MIN_STROKE, Math.min(MAX_STROKE, Math.round(shortest * 0.006)));
}

const MIN_STROKE = 3;
const MAX_STROKE = 18;

/** The halo is drawn first, at this multiple of the ink's width. */
export const MARKUP_HALO_SCALE = 2.2;

/**
 * The two barbs of an arrowhead at `to`, for a shaft coming from `from`.
 *
 * Shared because it is the one piece of this with real arithmetic in it, and three
 * hand-written versions of the same trigonometry is three chances for one client to
 * draw a arrowhead that points slightly the wrong way.
 *
 * The head is a fixed fraction of the shaft with a floor, so a short jab still gets a
 * visible head and a long drag does not grow a comical one.
 */
export function arrowHead(
  from: MarkupPoint,
  to: MarkupPoint,
  stroke: number,
): [MarkupPoint, MarkupPoint] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  // A zero-length drag has no direction to point in. Returning the tip twice draws
  // nothing rather than dividing by zero and drawing NaN.
  if (length === 0) return [{ ...to }, { ...to }];

  const angle = Math.atan2(dy, dx);
  const head = Math.max(stroke * 3, Math.min(length * 0.32, stroke * 9));
  // 28 degrees either side: wide enough to read at a glance, narrow enough that the
  // barbs do not look like a separate mark.
  const spread = 0.49;
  return [
    {
      x: to.x - head * Math.cos(angle - spread),
      y: to.y - head * Math.sin(angle - spread),
    },
    {
      x: to.x - head * Math.cos(angle + spread),
      y: to.y - head * Math.sin(angle + spread),
    },
  ];
}

/**
 * The ellipse a circle mark occupies, from the two corners of the drag.
 *
 * Returned as centre + radii rather than a box, because that is what every drawing
 * API on all three platforms actually wants, and converting in three places is three
 * places to get an off-by-half wrong.
 */
export function circleFromDrag(
  from: MarkupPoint,
  to: MarkupPoint,
): { cx: number; cy: number; rx: number; ry: number } {
  return {
    cx: (from.x + to.x) / 2,
    cy: (from.y + to.y) / 2,
    rx: Math.abs(to.x - from.x) / 2,
    ry: Math.abs(to.y - from.y) / 2,
  };
}

/**
 * Is this drag big enough to have been meant?
 *
 * A tap while scrolling a photo should not leave a dot on a customer's job record.
 * Measured against the image rather than in absolute pixels, so the same flick means
 * the same thing on a phone photo and a DSLR one.
 */
export function isDeliberateDrag(
  from: MarkupPoint,
  to: MarkupPoint,
  width: number,
  height: number,
): boolean {
  const shortest = Math.min(Math.abs(width), Math.abs(height));
  if (!Number.isFinite(shortest) || shortest <= 0) return false;
  return Math.hypot(to.x - from.x, to.y - from.y) >= shortest * 0.03;
}

/** What the file is called once it has marks on it. */
export function markedUpFileName(original: string): string {
  const trimmed = original.trim();
  if (trimmed === "") return "marked-up.jpg";
  // Always .jpg: the client re-encodes to JPEG, so keeping a .png extension on
  // JPEG bytes would be a lie the type check downstream would then catch.
  const stem = trimmed.replace(/\.[^./\\]+$/, "");
  return `${stem || "photo"}-marked.jpg`;
}
