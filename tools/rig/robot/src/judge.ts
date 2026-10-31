/**
 * Judging a recording the robot made, locally, from bytes held in memory.
 *
 * The audio is never written anywhere. What survives the judgement is the
 * summary, and on a failure the per-frame numbers as well (D112): enough to
 * see why a code was missed, not enough to play anything back.
 */
import { calibrate, type Calibration } from "./audio/calibrate.ts";
import { detectCodes, type Detection, type Margins } from "./audio/detect.ts";
import { analyzeFrames, framesForEvidence, type FrameTable } from "./audio/frames.ts";
import { SURFACES, SURFACE_HZ, type Surface } from "./audio/surfaces.ts";
import { decodeWav } from "./audio/wav.ts";

export interface JudgeOptions {
  /** The robot's own code on this call, if it played one: echo, never the answerer. */
  own?: Surface;
  /** The surface that should answer; null when the line should stay silent. */
  expect?: Surface | null;
  /** Fail when any other surface is heard too (a race with two winners). */
  exclusive?: boolean;
  answerOffsetMs?: number;
  windowStartMs?: number;
  windowEndMs?: number;
  margins?: Margins;
  /** Treat the recording as a calibration call for this surface. */
  calibrate?: Surface;
}

export interface SurfaceSummary {
  cycles: number;
  cycles_in_window: number;
  contrast_db: number;
  bursts_missing: number;
}

export interface RecordingJudgement {
  verdict: Detection["verdict"];
  answered: Surface | null;
  heard: Surface[];
  echo: Detection["echo"];
  surfaces: Partial<Record<Surface, SurfaceSummary>>;
  silent_frames: number;
  /** How long Telnyx's opening announcement ran, which the window waited out; 0 for none. */
  announcement_ms: number;
  /** Undefined when nothing was expected. */
  pass?: boolean;
  expected?: Surface | null;
  channel: number;
  channels: number;
  sample_rate: number;
  duration_ms: number;
  /** Per-frame numbers, kept only when the judgement failed. */
  frames?: ReturnType<typeof framesForEvidence>;
  calibration?: Calibration;
}

const BANDS = SURFACES.map((surface) => SURFACE_HZ[surface]);

export function judgeRecording(wav: Uint8Array, options: JudgeOptions = {}): RecordingJudgement {
  const pcm = decodeWav(wav);
  const tables = pcm.channels.map((channel) => analyzeFrames(channel, pcm.sampleRate, BANDS));
  const detect = (table: FrameTable) =>
    detectCodes(table, {
      own: options.own,
      answerOffsetMs: options.answerOffsetMs,
      windowStartMs: options.windowStartMs,
      windowEndMs: options.windowEndMs,
      margins: options.margins,
    });
  const detections = tables.map(detect);
  const channel = inboundChannel(detections, options.own);
  const detection = detections[channel]!;

  let pass: boolean | undefined;
  if (options.expect === null) pass = detection.verdict === "silent";
  else if (options.expect !== undefined) {
    pass =
      detection.verdict === "heard" &&
      detection.answered === options.expect &&
      (!options.exclusive || detection.heard.length === 1);
  }

  const surfaces: Partial<Record<Surface, SurfaceSummary>> = {};
  for (const [surface, score] of Object.entries(detection.scores) as [Surface, NonNullable<Detection["scores"][Surface]>][]) {
    surfaces[surface] = {
      cycles: score.cycles,
      cycles_in_window: score.cyclesInWindow,
      contrast_db: Math.round(score.meanContrastDb * 10) / 10,
      bursts_missing: score.burstsMissing,
    };
  }
  return {
    verdict: detection.verdict,
    answered: detection.answered,
    heard: detection.heard,
    echo: detection.echo,
    surfaces,
    silent_frames: detection.window.silentFrames,
    announcement_ms: detection.window.announcementMs,
    pass,
    expected: options.expect,
    channel,
    channels: pcm.channels.length,
    sample_rate: pcm.sampleRate,
    duration_ms: Math.round((pcm.channels[0]!.length / pcm.sampleRate) * 1000),
    frames: pass === false ? framesForEvidence(tables[channel]!) : undefined,
    calibration: options.calibrate
      ? calibrate(tables[channel]!, {
          surface: options.calibrate,
          own: options.own,
          answerOffsetMs: options.answerOffsetMs,
          windowStartMs: options.windowStartMs,
          windowEndMs: options.windowEndMs,
        })
      : undefined,
  };
}

/**
 * Which channel of a two-channel recording is what the robot heard. Telnyx's
 * dual recording puts one leg on each side and the order is not promised, so
 * the inbound side is the one that carries the robot's own code least.
 */
function inboundChannel(detections: Detection[], own: Surface | undefined): number {
  if (detections.length === 1 || !own) return 0;
  let best = 0;
  for (let c = 1; c < detections.length; c++) {
    const ownHere = detections[c]!.scores[own]?.cycles ?? 0;
    const ownBest = detections[best]!.scores[own]?.cycles ?? 0;
    if (ownHere < ownBest || (ownHere === ownBest && detections[c]!.heard.length > detections[best]!.heard.length)) {
      best = c;
    }
  }
  return best;
}
