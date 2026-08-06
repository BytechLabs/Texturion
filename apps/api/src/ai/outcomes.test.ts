/**
 * #431 — the outcome ledger and the AI ledger must stay the same ledger.
 *
 * We metered every AI unit we spent and recorded nothing about whether anyone
 * used the output. The fix records three outcomes per feature ON THE SAME row as
 * the spend, so "what did Lou cost?" and "did anyone use it?" cannot be read
 * apart. Two things can quietly undo that:
 *
 *  1. A NEW cost centre. `AiFeatureSpec.key` is already typed to the priced
 *     feature keys, so a new one cannot reach the model without a price. Nothing
 *     made it declare what its outcomes MEAN, or made the route willing to
 *     accept them — so a fourth feature could ship metered and unmeasured,
 *     which is precisely the state this issue is about.
 *
 *  2. A RENAMED key. The route's enum is written out as literals (zod needs a
 *     tuple), so a feature key changed in its spec and not in the route sends
 *     outcomes for a feature the ledger has never heard of. Postgres would
 *     happily open a second row, and cost and value would be permanently
 *     separated with nothing failing.
 *
 * So: the route's accepted features are asserted to be exactly the ledger's, and
 * every spec is asserted to say what its own outcomes mean.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { AI_USAGE_FEATURES } from "./usage";

const API_SRC = join(fileURLToPath(new URL(".", import.meta.url)), "..");

/** The `feature:` enum out of `aiOutcomeSchema` in routes/conversations.ts. */
function routeFeatures(): string[] {
  const source = readFileSync(join(API_SRC, "routes", "conversations.ts"), "utf8");
  const schema = source.slice(source.indexOf("const aiOutcomeSchema"));
  const match = /feature: z\.enum\(\[([^\]]+)\]\)/.exec(schema);
  expect(match, "aiOutcomeSchema no longer declares a feature enum").not.toBeNull();
  return (match?.[1] ?? "")
    .split(",")
    .map((part) => part.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
}

describe("#431 — POST /v1/ai/outcome accepts exactly the metered features", () => {
  it("accepts every ledger feature key, and nothing else", () => {
    const ledger = AI_USAGE_FEATURES.map((spec) => spec.key).sort();
    expect(
      routeFeatures().sort(),
      "The outcome route's feature enum and the AI ledger's features have " +
        "diverged. An outcome for a feature the ledger does not know opens a " +
        "SECOND row in company_ai_usage, which separates what Lou cost from " +
        "whether anyone used it — the exact gap #431 exists to close.",
    ).toEqual(ledger);
  });

  it("uses the ledger keys, not display names", () => {
    // The specific trap: task enrichment reads naturally as "enrich_task" and
    // meters as "enrich". Writing the friendlier one in the route would have
    // recorded every enrichment outcome against a feature that does not exist.
    expect(routeFeatures()).toContain("enrich");
  });
});

describe("#431 — every AI feature says what its own outcomes mean", () => {
  it.each(AI_USAGE_FEATURES.map((spec) => [spec.key, spec] as const))(
    "%s labels at least one observable outcome, distinctly",
    (_key, spec) => {
      // Three generic counters, feature-specific words. The server sends the
      // words so all three clients label the same numbers identically — #437 was
      // the same claim written sixteen different ways because nothing owned it.
      const labels = [
        spec.outcomes.used,
        spec.outcomes.edited,
        spec.outcomes.discarded,
      ].filter((label): label is string => label !== null);
      expect(
        labels.length,
        "A metered feature that declares NO observable outcome is metered and " +
          "unmeasured, which is the state #431 exists to end.",
      ).toBeGreaterThan(0);
      for (const label of labels) expect(label.trim().length).toBeGreaterThan(0);
      expect(new Set(labels).size, "two outcomes share a label").toBe(labels.length);
    },
  );

  it("names exactly which features cannot observe an outcome, and why", () => {
    // A null label means UNOBSERVABLE, not "not yet" — the row omits the line
    // rather than printing a zero, because printing "0 read without listening"
    // would report an unobservable outcome as a measured absence.
    //
    // Enumerated rather than checked loosely so that a new null anywhere fails
    // here and has to justify itself. All four of the current ones are voicemail
    // features, and they are null for the same two reasons: there is nothing to
    // EDIT in a transcript or an intake, and the positive case — read it and got
    // on with the job — is a person NOT doing something, which no client can see
    // without inferring it from scroll and unmount timing.
    //
    // #367 added the second pair rather than a third feature with no signal at
    // all: both voicemail features declare the one thing that IS observable,
    // somebody playing the audio anyway, each recorded only when that feature
    // actually produced something to ignore.
    const missing = AI_USAGE_FEATURES.flatMap((spec) =>
      (["used", "edited", "discarded"] as const)
        .filter((kind) => spec.outcomes[kind] === null)
        .map((kind) => `${spec.key}.${kind}`),
    );
    //
    // #247 adds the MIRROR IMAGE of the voicemail pair and it is worth reading
    // as one: a thread catch-up can only observe the positive act (somebody
    // tapped a cited line and landed on the message it came from), and cannot
    // observe the negative — "read it and got on with the job" is again a
    // person not doing something. It also has nothing to edit, because a
    // summary is not a draft.
    expect(missing.sort()).toEqual([
      "thread_summary.discarded",
      "thread_summary.edited",
      "voicemail_intake.edited",
      "voicemail_intake.used",
      "voicemail_transcript.edited",
      "voicemail_transcript.used",
    ]);
  });
});
