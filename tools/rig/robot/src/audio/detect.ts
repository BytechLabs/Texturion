/**
 * Code verdicts: which surface's code was heard, whether the
 * line was silent, and the echo and dropouts on the way.
 *
 * For each surface the detector slides the pattern over the judging window,
 * one frame at a time, and keeps the phase that lines up the most cycles. A
 * cycle correlates when its frames follow the pattern's shape, its bursts hold
 * a real share of the frame's power, and its bursts stand above its gaps by the
 * surface's margin. Each cycle may also slip two frames from the call's phase,
 * because a jitter buffer stretches time as it goes.
 */
import { analyzeFrames, type FrameTable } from "./frames.ts";
import { PATTERN, SLOT_MS, SURFACES, SURFACE_HZ, type Surface } from "./surfaces.ts";

/** Bursts above gaps, in dB, until a calibration call sets a surface's own margin. */
export const DEFAULT_MARGIN_DB = 6;
/** A burst's tone must hold at least this share of its frames' power. */
export const PRESENCE_DB = -25;
export const MIN_CORRELATION = 0.5;
export const MIN_CYCLES = 3;
export const WINDOW_START_MS = 2_000;
export const WINDOW_END_MS = 12_000;
/** Cycles that correlate in the listener's own code before it counts as echo. */
export const ECHO_MIN_CYCLES = 2;
const SLIP_FRAMES = 2;

export type Margins = Partial<Record<Surface, number>>;

export interface DetectOptions {
  /** Where the call was answered, from the start of the audio. */
  answerOffsetMs?: number;
  /** The judging window, from answer. */
  windowStartMs?: number;
  windowEndMs?: number;
  margins?: Margins;
  /** The listener's own code: never "answered", and its presence is echo. */
  own?: Surface;
  surfaces?: readonly Surface[];
  minCycles?: number;
}

export interface CycleScore {
  startMs: number;
  onDb: number;
  offDb: number;
  contrastDb: number;
  correlation: number;
  /** Each burst's mean share, in pattern order. */
  burstsDb: number[];
  correlates: boolean;
}

export interface SurfaceScore {
  surface: Surface;
  hz: number;
  marginDb: number;
  /** Cycles that correlate. */
  cycles: number;
  cyclesInWindow: number;
  /** Where the best phase puts the first cycle, from the start of the audio. */
  phaseMs: number;
  meanContrastDb: number;
  cycleScores: CycleScore[];
  burstsExpected: number;
  /** Bursts missing from the window's cycles: the dropouts. */
  burstsMissing: number;
}

export type CodeVerdict = "heard" | "faint" | "silent";

export interface Detection {
  /** heard: some surface correlates in enough cycles. faint: in some. silent: in none. */
  verdict: CodeVerdict;
  /** The heard surface with the most cycles, or null when none was heard. */
  answered: Surface | null;
  heard: Surface[];
  echo: { surface: Surface; cycles: number; meanContrastDb: number } | null;
  scores: Partial<Record<Surface, SurfaceScore>>;
  window: { startMs: number; endMs: number; silentFrames: number };
  frameMs: number;
}

/** Analyses the samples for every surface's frequency, then detects. */
export function detectInSamples(
  samples: Float32Array,
  sampleRate: number,
  options: DetectOptions = {},
): { detection: Detection; table: FrameTable } {
  const table = analyzeFrames(samples, sampleRate, SURFACES.map((s) => SURFACE_HZ[s]));
  return { detection: detectCodes(table, options), table };
}

export function detectCodes(table: FrameTable, options: DetectOptions = {}): Detection {
  const { frameMs } = table;
  const answer = options.answerOffsetMs ?? 0;
  const startMs = answer + (options.windowStartMs ?? WINDOW_START_MS);
  const endMs = answer + (options.windowEndMs ?? WINDOW_END_MS);
  const frames = table.level.length;
  const w0 = Math.max(0, Math.round(startMs / frameMs));
  const w1 = Math.min(frames, Math.round(endMs / frameMs));
  const minCycles = options.minCycles ?? MIN_CYCLES;
  const surfaces = options.surfaces ?? SURFACES;

  const scores: Partial<Record<Surface, SurfaceScore>> = {};
  for (const surface of surfaces) {
    const index = table.frequencies.indexOf(SURFACE_HZ[surface]);
    if (index < 0) throw new Error(`detectCodes: the frame table has no ${SURFACE_HZ[surface]} Hz band for ${surface}`);
    const margin = options.margins?.[surface] ?? DEFAULT_MARGIN_DB;
    scores[surface] = scoreSurface(surface, table.share[index]!, maskFor(table, index), frameMs, w0, w1, margin);
  }

  const others = surfaces.filter((s) => s !== options.own).map((s) => scores[s]!);
  const heard = others
    .filter((score) => score.cycles >= minCycles)
    .sort((a, b) => b.cycles - a.cycles || b.meanContrastDb - a.meanContrastDb)
    .map((score) => score.surface);
  const verdict: CodeVerdict =
    heard.length > 0 ? "heard" : others.some((score) => score.cycles > 0) ? "faint" : "silent";

  const ownScore = options.own ? scores[options.own] : undefined;
  const echo =
    ownScore && ownScore.cycles >= ECHO_MIN_CYCLES
      ? { surface: ownScore.surface, cycles: ownScore.cycles, meanContrastDb: ownScore.meanContrastDb }
      : null;

  let silentFrames = 0;
  for (let k = w0; k < w1; k++) if (table.level[k]! <= -69) silentFrames++;

  return {
    verdict,
    answered: heard[0] ?? null,
    heard,
    echo,
    scores,
    window: { startMs, endMs, silentFrames },
    frameMs,
  };
}

/**
 * Frames another surface's tone owns, as seen from band `index`. A share is
 * relative to the whole frame, so while a loud code plays every other band's
 * share drops; read as a pattern, that dip is the loud code's pattern upside
 * down, and at the wrong phase it looks like bursts in a band that holds only
 * noise. Those frames say nothing about this band, so they are left out of its
 * cycles. A frame where this band is within 10 dB of the loudest is its own.
 */
const MASK_DOMINANT_DB = -10;
const MASK_BELOW_DB = 10;

function maskFor(table: FrameTable, index: number): Uint8Array {
  const frames = table.level.length;
  const mask = new Uint8Array(frames);
  for (let k = 0; k < frames; k++) {
    let loudest = Number.NEGATIVE_INFINITY;
    for (let f = 0; f < table.share.length; f++) {
      if (f !== index) loudest = Math.max(loudest, table.share[f]![k]!);
    }
    if (loudest >= MASK_DOMINANT_DB && table.share[index]![k]! < loudest - MASK_BELOW_DB) mask[k] = 1;
  }
  return mask;
}

/** Fewer unmasked frames than this in a cycle's bursts or gaps, and the cycle says nothing. */
const MIN_ON_FRAMES = 6;
const MIN_OFF_FRAMES = 12;

interface Template {
  cycleFrames: number;
  /** +1 on, -1 off, 0 for a frame on a slot edge, which a slip of one frame may cross. */
  sign: Int8Array;
  burst: Int8Array;
  bursts: number;
}

const templates = new Map<number, Template>();

function template(frameMs: number): Template {
  const cached = templates.get(frameMs);
  if (cached) return cached;
  const slotFrames = SLOT_MS / frameMs;
  if (!Number.isInteger(slotFrames)) throw new Error(`detectCodes: ${frameMs} ms frames do not divide a ${SLOT_MS} ms slot`);
  const cycleFrames = slotFrames * PATTERN.length;
  const sign = new Int8Array(cycleFrames);
  const burst = new Int8Array(cycleFrames).fill(-1);
  let bursts = 0;
  PATTERN.forEach((on, slot) => {
    for (let i = 0; i < slotFrames; i++) {
      const edge = slotFrames >= 3 && (i === 0 || i === slotFrames - 1);
      const q = slot * slotFrames + i;
      sign[q] = edge ? 0 : on ? 1 : -1;
      if (on && !edge) burst[q] = bursts;
    }
    if (on) bursts++;
  });
  const built = { cycleFrames, sign, burst, bursts };
  templates.set(frameMs, built);
  return built;
}

function scoreCycle(
  share: Float32Array,
  mask: Uint8Array,
  start: number,
  shape: Template,
  margin: number,
  frameMs: number,
): CycleScore {
  let onSum = 0;
  let onCount = 0;
  let offSum = 0;
  let offCount = 0;
  let sumX = 0;
  let sumXX = 0;
  let sumXY = 0;
  let sumY = 0;
  let count = 0;
  const burstSums = new Float64Array(shape.bursts);
  const burstCounts = new Uint16Array(shape.bursts);
  for (let q = 0; q < shape.cycleFrames; q++) {
    const y = shape.sign[q]!;
    if (y === 0 || mask[start + q]) continue;
    const x = share[start + q]!;
    if (y > 0) {
      onSum += x;
      onCount++;
      const b = shape.burst[q]!;
      burstSums[b] = burstSums[b]! + x;
      burstCounts[b] = burstCounts[b]! + 1;
    } else {
      offSum += x;
      offCount++;
    }
    sumX += x;
    sumXX += x * x;
    sumXY += x * y;
    sumY += y;
    count++;
  }
  if (onCount < MIN_ON_FRAMES || offCount < MIN_OFF_FRAMES) {
    return {
      startMs: start * frameMs,
      onDb: Number.NaN,
      offDb: Number.NaN,
      contrastDb: 0,
      correlation: 0,
      burstsDb: Array.from({ length: shape.bursts }, () => Number.NaN),
      correlates: false,
    };
  }
  const onDb = onSum / onCount;
  const offDb = offSum / offCount;
  const contrastDb = onDb - offDb;
  // Pearson against the +1/-1 shape; y*y is always 1.
  const covariance = sumXY - (sumX * sumY) / count;
  const varianceX = sumXX - (sumX * sumX) / count;
  const varianceY = count - (sumY * sumY) / count;
  const correlation = varianceX > 1e-9 ? covariance / Math.sqrt(varianceX * varianceY) : 0;
  // A burst every frame of which was masked reads NaN: unknown, not missing.
  const burstsDb = Array.from(burstSums, (sum, b) => (burstCounts[b] ? sum / burstCounts[b]! : Number.NaN));
  return {
    startMs: start * frameMs,
    onDb,
    offDb,
    contrastDb,
    correlation,
    burstsDb,
    correlates: correlation >= MIN_CORRELATION && onDb >= PRESENCE_DB && contrastDb >= margin,
  };
}

function scoreSurface(
  surface: Surface,
  share: Float32Array,
  mask: Uint8Array,
  frameMs: number,
  w0: number,
  w1: number,
  margin: number,
): SurfaceScore {
  const shape = template(frameMs);
  const { cycleFrames } = shape;
  let best: { phase: number; cycles: CycleScore[]; hits: number; total: number } | undefined;

  for (let phase = 0; phase < cycleFrames; phase++) {
    const cycles: CycleScore[] = [];
    for (let start = w0 + phase; start + cycleFrames <= w1; start += cycleFrames) {
      let chosen: CycleScore | undefined;
      for (let slip = -SLIP_FRAMES; slip <= SLIP_FRAMES; slip++) {
        const at = start + slip;
        if (at < 0 || at + cycleFrames > share.length) continue;
        const score = scoreCycle(share, mask, at, shape, margin, frameMs);
        if (!chosen || rank(score) > rank(chosen)) chosen = score;
      }
      if (chosen) cycles.push(chosen);
    }
    const hits = cycles.filter((cycle) => cycle.correlates).length;
    const total = cycles.reduce((sum, cycle) => sum + cycle.contrastDb, 0);
    if (!best || hits > best.hits || (hits === best.hits && total > best.total)) {
      best = { phase, cycles, hits, total };
    }
  }

  const cycles = best?.cycles ?? [];
  let missing = 0;
  for (const cycle of cycles) {
    if (Number.isNaN(cycle.offDb)) continue;
    for (const burstDb of cycle.burstsDb) {
      if (Number.isNaN(burstDb)) continue;
      if (!(burstDb >= PRESENCE_DB && burstDb - cycle.offDb >= margin / 2)) missing++;
    }
  }
  return {
    surface,
    hz: SURFACE_HZ[surface],
    marginDb: margin,
    cycles: best?.hits ?? 0,
    cyclesInWindow: cycles.length,
    phaseMs: cycles[0]?.startMs ?? (w0 + (best?.phase ?? 0)) * frameMs,
    meanContrastDb: cycles.length > 0 ? (best?.total ?? 0) / cycles.length : 0,
    cycleScores: cycles,
    burstsExpected: cycles.length * shape.bursts,
    burstsMissing: missing,
  };
}

/** A correlating slip beats any that does not; then the larger contrast wins. */
function rank(score: CycleScore): number {
  return (score.correlates ? 1_000 : 0) + score.contrastDb;
}
