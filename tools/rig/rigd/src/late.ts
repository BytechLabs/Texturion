/**
 * Texts that reached the API after Telnyx's signature had gone stale.
 *
 * The edge queues text events while the rig is unreachable and offers each
 * one last time once its signature is older than the API accepts (tools/edge
 * uplink.ts, `queue.signature_lapsed`). The API refuses that offer with a 400,
 * the same answer it gives a forged or broken signature, so rigd checks the
 * signature itself with the key the API uses: only an event that is genuine
 * and merely old is recorded here. A run reads this ledger to tell "the text
 * I sent came back too late to verify" from a product failure, matching its
 * own texts by a hash of the body, so nothing else on the rig can excuse it.
 */
import { createHash, createPublicKey, verify, type KeyObject } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

const CLOCK_SKEW_MS = 60_000;

export interface LateDelivery {
  at: number;
  frame_id: string;
  path: string;
  attempt: number;
  age_s: number;
  /** When Telnyx signed it, epoch ms. */
  signed_at: number;
  /** sha256 of the message body, so a run can claim its own texts without the ledger holding any. */
  text_sha256?: string;
}

export function textHash(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function header(headers: Record<string, string>, name: string): string | undefined {
  return Object.entries(headers).find(([key]) => key.toLowerCase() === name)?.[1];
}

/** Seconds since Telnyx signed the event, or undefined when it carries no timestamp. */
export function signatureAge(headers: Record<string, string>, now: number): number | undefined {
  const signed = Number(header(headers, "telnyx-timestamp") ?? Number.NaN);
  return Number.isFinite(signed) ? Math.round(now / 1000 - signed) : undefined;
}

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

/** The account's webhook key as the API holds it: base64 of the raw 32 bytes. */
export function telnyxPublicKey(base64: string): KeyObject {
  const raw = Buffer.from(base64.trim(), "base64");
  if (raw.length !== 32) throw new Error("late: the Telnyx public key is not 32 bytes of base64");
  return createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, raw]), format: "der", type: "spki" });
}

/** Whether Telnyx signed this body, at its timestamp, whatever the timestamp's age. */
export function signedByTelnyx(key: KeyObject, headers: Record<string, string>, body: string): boolean {
  const signature = header(headers, "telnyx-signature-ed25519");
  const timestamp = header(headers, "telnyx-timestamp");
  if (!signature || !timestamp || !/^\d{1,12}$/.test(timestamp)) return false;
  try {
    return verify(null, Buffer.from(`${timestamp}|${body}`, "utf8"), key, Buffer.from(signature, "base64"));
  } catch {
    return false;
  }
}

/** The message body of a Telnyx `message.*` event, if it has one. */
export function messageText(body: string): string | undefined {
  try {
    const text = (JSON.parse(body) as { data?: { payload?: { text?: unknown } } })?.data?.payload?.text;
    return typeof text === "string" ? text : undefined;
  } catch {
    return undefined;
  }
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

  /** Late texts Telnyx signed after `since` (less a minute of clock skew) whose body is one of `texts`. */
  matching(query: { since: number; texts: ReadonlySet<string> }): LateDelivery[] {
    return this.since(query.since).filter(
      (entry) =>
        entry.signed_at >= query.since - CLOCK_SKEW_MS && entry.text_sha256 !== undefined && query.texts.has(entry.text_sha256),
    );
  }
}
