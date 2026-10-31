/**
 * Each surface's margin, set from a calibration call on day one.
 *
 * A calibration call carries one known surface's code over the real path. Its
 * cycles give the contrast that path delivers (the signal); every surface that
 * is not on the call gives the contrast the same path manufactures from noise,
 * at that surface's luckiest phase. The margin sits between the two, nearer
 * the noise, so a later call a little worse than the calibration call still
 * passes and noise never does.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { FrameTable } from "./frames.ts";
import { detectCodes, MIN_CYCLES, type DetectOptions, type Margins } from "./detect.ts";
import { SURFACES, isSurface, type Surface } from "./surfaces.ts";

/** Signal must clear the noise by this much, or the code does not survive the path. */
export const MIN_SEPARATION_DB = 10;
const MARGIN_FRACTION = 0.35;
const MIN_ABOVE_NOISE_DB = 4;
const MIN_BELOW_SIGNAL_DB = 6;

export interface Calibration {
  surface: Surface;
  signalDb: number;
  noiseDb: number;
  marginDb: number;
  ok: boolean;
  reason?: string;
}

export function calibrate(
  table: FrameTable,
  options: Omit<DetectOptions, "margins" | "surfaces"> & { surface: Surface },
): Calibration {
  const { surface, own } = options;
  const open = Object.fromEntries(SURFACES.map((s) => [s, Number.NEGATIVE_INFINITY])) as Margins;
  const raw = detectCodes(table, { ...options, margins: open });
  const known = raw.scores[surface]!;
  const signalDb = median(known.cycleScores.map((cycle) => cycle.contrastDb));
  const absent = SURFACES.filter((s) => s !== surface && s !== own);
  const noiseDb = Math.max(
    ...absent.map((s) => median(raw.scores[s]!.cycleScores.map((cycle) => cycle.contrastDb))),
  );
  const span = signalDb - noiseDb;
  const marginDb = round1(
    Math.min(
      signalDb - MIN_BELOW_SIGNAL_DB,
      Math.max(noiseDb + MIN_ABOVE_NOISE_DB, noiseDb + MARGIN_FRACTION * span),
    ),
  );
  const result = { surface, signalDb: round1(signalDb), noiseDb: round1(noiseDb), marginDb };
  if (known.cycleScores.length < MIN_CYCLES) {
    return { ...result, ok: false, reason: `only ${known.cycleScores.length} whole cycles in the window` };
  }
  if (!(span >= MIN_SEPARATION_DB)) {
    return {
      ...result,
      ok: false,
      reason: `signal clears noise by ${round1(span)} dB, under ${MIN_SEPARATION_DB} dB: the code does not survive this path`,
    };
  }
  // The margin must reproduce the call it came from: the surface heard, nothing else.
  const margins = Object.fromEntries(SURFACES.map((s) => [s, marginDb])) as Margins;
  const check = detectCodes(table, { ...options, margins });
  if (check.answered !== surface || check.heard.length !== 1) {
    return {
      ...result,
      ok: false,
      reason: `at ${marginDb} dB the call reads as ${check.heard.join(", ") || "silent"}`,
    };
  }
  return { ...result, ok: true };
}

export function loadMargins(path: string): Margins {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${path}: margins must be an object of surface to dB`);
  }
  const margins: Margins = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (!isSurface(key) || typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error(`${path}: ${key} is not a surface with a finite margin`);
    }
    margins[key] = value;
  }
  return margins;
}

/** Writes only calibrations that passed; a failed one keeps the old margin. */
export function saveMargins(path: string, current: Margins, calibrations: Calibration[]): Margins {
  const next: Margins = { ...current };
  for (const calibration of calibrations) {
    if (calibration.ok) next[calibration.surface] = calibration.marginDb;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
