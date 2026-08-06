/**
 * The guards that make a provider rate a fact rather than a literal.
 *
 * `AI_UNIT_COST_CENTS` is derived arithmetic, and every derivation in this
 * package could already be executed by a test — except for the one number each
 * of them multiplies by. A verifier showed what that was worth: lower the
 * thread catch-up's output rate from $0.384 to $0.045 and 104 of 104 tests stay
 * green, because each guard re-derives from the number that has just moved.
 *
 * A test cannot phone Cloudflare, so what follows does the three things a test
 * CAN do about an external number, and the file it guards says plainly that
 * none of them makes the number true:
 *
 *   COVERAGE  — every model this product calls is priced here or admitted as a
 *               gap, so a new model cannot arrive unpriced and unremarked.
 *   MIRROR    — every figure appears in docs/PRICING-AUDIT.md §4.2, which
 *               `costs.ts` names as its cost basis. Changing a rate in code
 *               without re-auditing it fails, and so does the reverse.
 *   FRESHNESS — a recheck date the suite fails on, the same posture
 *               `carrier-list-prices.ts` and `carrier-throughput.ts` take.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { VOICEMAIL_INTAKE_MODEL } from "../calls/voicemail-intake";
import {
  VOICEMAIL_TRANSCRIPT_FALLBACK_MODEL,
  VOICEMAIL_TRANSCRIPT_MODEL,
} from "../calls/voicemail-transcript";
import { SUGGEST_REPLY_MODEL } from "../messaging/reply-suggestions";
import { THREAD_SUMMARY_MODEL } from "../messaging/thread-summary";
import { ENRICHMENT_MODEL } from "../tasks/enrichment";
import {
  WORKERS_AI_AUDIO_PRICES,
  WORKERS_AI_PRICES_AUDIT,
  WORKERS_AI_PRICES_RECHECK_AFTER,
  WORKERS_AI_PRICES_SOURCE,
  WORKERS_AI_PRICES_VERIFIED_ON,
  WORKERS_AI_TOKEN_PRICES,
  WORKERS_AI_UNPRICED,
  workersAiAudioPrice,
  workersAiTokenPrice,
} from "./workers-ai-prices";

/** Every model id this product can pass to `env.AI.run`, from its own constant. */
const SHIPPED_MODELS = [
  ENRICHMENT_MODEL,
  SUGGEST_REPLY_MODEL,
  THREAD_SUMMARY_MODEL,
  VOICEMAIL_INTAKE_MODEL,
  VOICEMAIL_TRANSCRIPT_MODEL,
  VOICEMAIL_TRANSCRIPT_FALLBACK_MODEL,
];

const AUDIT = readFileSync(
  join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "..",
    "..",
    "docs",
    "PRICING-AUDIT.md",
  ),
  "utf8",
);

/** The audit line that names `model`, or a throw naming what is missing. */
function auditLine(model: string): string {
  const found = AUDIT.split("\n").find((line) => line.includes(`\`${model}\``));
  if (!found) {
    throw new Error(
      `${WORKERS_AI_PRICES_AUDIT} has no row for ${model} — a rate is shipped ` +
        "that the cost basis has never been audited against",
    );
  }
  return found;
}

describe("coverage — no model this product calls goes unpriced", () => {
  it("prices or admits every shipped model constant", () => {
    // Read off the feature constants rather than a list typed here, so adding
    // a cost centre on a new model fails this instead of passing it silently.
    for (const model of SHIPPED_MODELS) {
      const known =
        model in WORKERS_AI_TOKEN_PRICES ||
        model in WORKERS_AI_AUDIO_PRICES ||
        model in WORKERS_AI_UNPRICED;
      expect(
        known,
        `${model} is called by this product and neither priced nor listed as ` +
          "an admitted gap in workers-ai-prices.ts",
      ).toBe(true);
    }
  });

  it("gives every admitted gap a reason, never a zero", () => {
    // A zero is a claim that a call is free. An empty reason is the same claim
    // with the evidence left out.
    for (const [model, reason] of Object.entries(WORKERS_AI_UNPRICED)) {
      expect(reason.length, `${model} is unpriced with no reason`).toBeGreaterThan(40);
      expect(model in WORKERS_AI_TOKEN_PRICES).toBe(false);
      expect(model in WORKERS_AI_AUDIO_PRICES).toBe(false);
    }
  });

  it("refuses to invent a price for a model it does not carry", () => {
    // The published table has this row; this product does not call it, so
    // nothing here prices it. Falling back to a neighbour's rate is exactly
    // what the model-id lookup exists to prevent.
    expect(() => workersAiTokenPrice("@cf/meta/llama-3.1-8b-instruct")).toThrow(
      /no Workers AI token price recorded/,
    );
    expect(() => workersAiAudioPrice("@cf/openai/whisper")).toThrow(
      /no Workers AI audio price recorded/,
    );
  });

  it("records where a figure came from when it is not our own model's row", () => {
    // The 8B entry is the reason this field exists: $0.045 / $0.384 is
    // published under `-instruct-fp8-fast`, and this product calls
    // `-instruct-fast`, which the table does not list. A rate read across from
    // a neighbour is a weaker fact than a rate read off your own row, and the
    // difference has to survive in the data rather than in somebody's memory.
    for (const [model, price] of Object.entries(WORKERS_AI_TOKEN_PRICES)) {
      expect(price.usdPerMillionInput).toBeGreaterThan(0);
      expect(price.usdPerMillionOutput).toBeGreaterThan(0);
      if (price.publishedAs !== model) {
        expect(
          price.gap.length,
          `${model} is priced from ${price.publishedAs} with no explanation`,
        ).toBeGreaterThan(40);
      } else {
        expect(price.gap).toBe("");
      }
    }
  });
});

describe("mirror — the code and the cost basis are one fact", () => {
  it("finds the audit, so a guard that matches nothing cannot pass", () => {
    // A file read that silently came back empty would make every assertion
    // below vacuous. Name the section this guard depends on.
    expect(AUDIT).toContain("AI cost basis");
    expect(AUDIT).toContain(WORKERS_AI_PRICES_SOURCE);
  });

  it("matches the audited token rate for every priced model", () => {
    for (const [model, price] of Object.entries(WORKERS_AI_TOKEN_PRICES)) {
      const line = auditLine(model);
      expect(line, `${model} input rate differs from the audit`).toContain(
        `$${price.usdPerMillionInput}/M in`,
      );
      expect(line, `${model} output rate differs from the audit`).toContain(
        `$${price.usdPerMillionOutput}/M out`,
      );
    }
  });

  it("matches the audited audio rate for every priced model", () => {
    for (const [model, usdPerMinute] of Object.entries(WORKERS_AI_AUDIO_PRICES)) {
      expect(auditLine(model)).toContain(`$${usdPerMinute}`);
    }
  });

  it("names a model the audit has never priced", () => {
    // The negative case, so the mirror is known to be capable of failing: the
    // fallback transcript model is called in production and appears nowhere in
    // the cost basis, which is why it is an admitted gap rather than a row.
    expect(() => auditLine(VOICEMAIL_TRANSCRIPT_FALLBACK_MODEL)).toThrow(
      /has no row for/,
    );
  });
});

describe("freshness — an external number rots quietly", () => {
  it("is still within its recheck window", () => {
    expect(
      new Date(WORKERS_AI_PRICES_RECHECK_AFTER).getTime(),
      `Workers AI rates were verified on ${WORKERS_AI_PRICES_VERIFIED_ON} and are ` +
        `due a re-read. Re-read ${WORKERS_AI_PRICES_SOURCE}, update the figures ` +
        `and ${WORKERS_AI_PRICES_AUDIT} together, then move ` +
        "WORKERS_AI_PRICES_RECHECK_AFTER forward.",
    ).toBeGreaterThan(Date.now());
  });

  it("was verified before it is due to be rechecked", () => {
    expect(new Date(WORKERS_AI_PRICES_VERIFIED_ON).getTime()).toBeLessThan(
      new Date(WORKERS_AI_PRICES_RECHECK_AFTER).getTime(),
    );
  });
});
