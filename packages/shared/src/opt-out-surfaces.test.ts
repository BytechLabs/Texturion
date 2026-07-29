/**
 * #407 — no surface may offer to reinstate consent the business does not own.
 *
 * The rule itself is settled and correct: a STOP the customer sent is a
 * CARRIER block, clearing our row would not clear Telnyx's, and the server
 * refuses the revoke and always will. Each client already carries the
 * predicate — `isCarrierEnforcedOptOut` exists in `lib/api/types.ts`,
 * `core/model/Contacts.kt` and `Core/Model/Contacts.swift`.
 *
 * What kept going wrong was the *use*. Five surfaces offer to undo an opt-out;
 * four of them learned to ask the predicate one at a time, over three separate
 * issues, and the fifth (the web contact panel) sat wrong for months while the
 * page beside it was right. That is #376 and #392's whole complaint: a rule
 * implemented per-client is a rule that differs per-client.
 *
 * ---------------------------------------------------------------------------
 * WHY A SOURCE TEST RATHER THAN A RENDER TEST.
 *
 * A render test per surface would pin the four we know about and say nothing
 * about the fifth somebody adds next quarter — which is precisely the failure
 * that has happened three times already. This asks the question that actually
 * matters: does every file that offers a revoke also ask which kind of opt-out
 * it is? A new surface on any client fails this the day it is written,
 * including the two clients that have no UI test runner at all.
 *
 * The cost is honest: this greps source. It cannot tell a correctly gated
 * button from a mention of the predicate in a comment. It is a floor, not a
 * proof — but it is a floor that spans three languages, and there was none.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** packages/shared/src → repo root. */
const REPO = join(__dirname, "..", "..", "..");

const CLIENT_ROOTS = [
  join(REPO, "apps", "web", "src"),
  join(REPO, "apps", "android", "app", "src", "main", "kotlin"),
  join(REPO, "apps", "ios", "Loonext"),
];

const SOURCE = /\.(tsx?|kt|swift)$/;

function walk(dir: string): string[] {
  let out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "build" || entry === ".next") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out = out.concat(walk(full));
    else if (SOURCE.test(entry) && !entry.includes(".test.")) out.push(full);
  }
  return out;
}

/**
 * Comments stripped, because a label named in prose is not an offer.
 *
 * `lib/api/contacts.ts` documents the transport hook as "Mark opted in again"
 * and correctly has no idea which kind of opt-out it is carrying — that is
 * what a transport is for. Matching it would have forced a gate into the layer
 * furthest from the person, which is the opposite of the fix.
 */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
}

/**
 * JSX and Kotlin string concatenation both wrap a sentence across lines, so
 * the copy assertions read the text as a person sees it rather than as the
 * file stores it. Without this, a sentence broken after "by texting" fails a
 * check that the rendered UI passes.
 */
function flat(source: string): string {
  return source.replace(/\s+/g, " ");
}

/**
 * A file that OFFERS the revoke, as opposed to one that merely performs it.
 *
 * The repository layer and the controller/mutation layer legitimately call
 * `revokeOptOut` with no idea what kind of opt-out it is — that is the point of
 * a transport. The question is only asked of the files that put a control in
 * front of a person, which is what the label text identifies.
 */
const OFFERS_REVOKE = /Mark opted in again|Remove opt-out/;

describe("#407 — every surface offering a revoke asks which kind it is", () => {
  const offering = CLIENT_ROOTS.flatMap(walk).filter((file) =>
    OFFERS_REVOKE.test(code(readFileSync(file, "utf8"))),
  );

  it("finds the surfaces at all (a passing test that greps nothing is a lie)", () => {
    // Five today: web contact panel, web contact detail, web thread header,
    // Android thread sheet, iOS thread sheet — plus the two mobile contact
    // detail screens. If this drops to zero because a label was reworded, the
    // test below would pass vacuously, which is the failure mode of every
    // grep-shaped assertion.
    expect(offering.length).toBeGreaterThanOrEqual(5);
  });

  it("spans all three clients, so no client is silently unprotected", () => {
    for (const root of CLIENT_ROOTS) {
      expect(offering.some((file) => file.startsWith(root))).toBe(true);
    }
  });

  it.each(offering.map((file) => [file.slice(REPO.length + 1)] as const))(
    "%s asks isCarrierEnforcedOptOut before offering it",
    (relative) => {
      const source = code(readFileSync(join(REPO, relative), "utf8"));
      expect(source).toContain("isCarrierEnforcedOptOut");
    },
  );

  it("names START as the customer's route back wherever it refuses", () => {
    // Ask 2: the owner will speak to this customer on the phone. "You can't do
    // that" is a dead end; "tell them to text START to your number" is a thing
    // they can say. Every refusing surface must carry it.
    for (const file of offering) {
      const source = readFileSync(file, "utf8");
      if (!code(source).includes("isCarrierEnforcedOptOut")) continue;
      expect(flat(source), `${file.slice(REPO.length + 1)} refuses without naming START`)
        .toMatch(/texting START|text START/);
    }
  });
});
