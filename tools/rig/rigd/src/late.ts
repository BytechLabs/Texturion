/**
 * Texts that reached the API after Telnyx's signature had gone stale.
 *
 * The edge queues text events and redelivers them for up to 24 hours, each
 * with the signature Telnyx sent. The API accepts a signature for five
 * minutes, so a text queued longer (the rig was offline, or the uplink was
 * down) is refused however often it is redelivered. rigd still delivers it,
 * then acks it so the edge stops, and counts it here: a late delivery is an
 * outage's footprint, not a product failure, and the runner reads this ledger
 * to say so.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

/** The API's tolerance for `telnyx-timestamp` (apps/api/src/webhooks/telnyx.ts). */
export const SIGNATURE_WINDOW_S = 300;

export interface LateDelivery {
  at: number;
  frame_id: string;
  path: string;
  attempt: number;
  age_s: number;
}

/** Seconds since Telnyx signed the event, or undefined when it carries no timestamp. */
export function signatureAge(headers: Record<string, string>, now: number): number | undefined {
  const entry = Object.entries(headers).find(([name]) => name.toLowerCase() === "telnyx-timestamp");
  const signed = entry ? Number(entry[1]) : Number.NaN;
  return Number.isFinite(signed) ? Math.round(now / 1000 - signed) : undefined;
}

export class LateDeliveries {
  readonly #file: string;

  constructor(file: string) {
    this.#file = file;
    mkdirSync(dirname(file), { recursive: true });
  }

  record(entry: LateDelivery): void {
    appendFileSync(this.#file, `${JSON.stringify(entry)}\n`);
  }

  since(ms: number): LateDelivery[] {
    if (!existsSync(this.#file)) return [];
    return readFileSync(this.#file, "utf8")
      .split("\n")
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as LateDelivery];
        } catch {
          return [];
        }
      })
      .filter((entry) => entry.at >= ms);
  }
}
