/**
 * #303 — the categories `/legal/aup` §4 prohibits outright, and a way to
 * notice one at signup instead of after a carrier complaint.
 *
 * ── WHAT THIS IS FOR, AND WHAT IT MUST NOT BECOME ─────────────────────────
 *
 * A workspace in one of these categories looks like any other signup, and the
 * first thing that distinguishes it is a complaint arriving against OUR
 * account — carrier action applies to the sending pool, not to the offender.
 * Noticing at signup is worth a lot; noticing at the complaint is worth
 * nothing.
 *
 * It reads the business NAME the owner typed and nothing else. Not their
 * messages, not their contacts. The privacy posture that makes the rest of
 * #303 behavioural applies here too: this is a keyword match against a string
 * somebody chose to put on their own workspace.
 *
 * ── WHY IT FLAGS AND NEVER DECLINES ───────────────────────────────────────
 *
 * A name is weak evidence. "Colt Plumbing" is a plumber, "Blazing Trails
 * Landscaping" mows lawns, and a shop called "The Smoke House" sells brisket.
 * Auto-declining on a keyword would refuse real customers at the exact moment
 * they are deciding whether to trust us, with no way to argue.
 *
 * So this returns SUSPICION, and a person decides. That is the same posture
 * the watch job takes for the same reason — see docs/AUP-ENFORCEMENT.md, "a
 * roofer after a storm is statistically indistinguishable from a mass
 * marketer".
 *
 * ── WHY THE TERMS ARE NARROW ──────────────────────────────────────────────
 *
 * Every term here is one that is hard to be in a trade by accident.
 * Deliberately absent: "bar", "pub", "smoke", "shot", "arms", "leaf", "green",
 * "cash", "gun" — each of which appears in ordinary contractor names far more
 * often than in a prohibited one, and a flag that fires on those trains
 * whoever reads it to dismiss the whole thing.
 */

/** A category §4 prohibits outright, in the words the policy uses. */
export type ProhibitedCategory =
  | "adult"
  | "cannabis"
  | "firearms"
  | "gambling"
  | "high_interest_lending"
  | "tobacco_vaping";

export interface CategoryMatch {
  category: ProhibitedCategory;
  /** The term that matched, so a reviewer can judge the evidence themselves. */
  term: string;
}

/**
 * Terms per category. Word-boundary matched, case-insensitive.
 *
 * Multi-word terms are here on purpose: "payday loan" is unambiguous where
 * "loan" alone would flag every mortgage broker's assistant.
 */
const TERMS: Record<ProhibitedCategory, readonly string[]> = {
  adult: ["escort", "escorts", "strip club", "adult entertainment", "xxx"],
  cannabis: ["cannabis", "dispensary", "marijuana", "thc", "cbd", "weed shop"],
  firearms: ["firearm", "firearms", "gunsmith", "ammunition", "ammo shop", "shooting range"],
  gambling: ["casino", "sportsbook", "betting", "lottery"],
  high_interest_lending: [
    "payday loan",
    "payday loans",
    "payday advance",
    "title loan",
    "title loans",
    "cash advance",
    "debt collection",
    "debt collector",
  ],
  tobacco_vaping: ["vape", "vaping", "e-cigarette", "ecig", "tobacconist", "hookah", "smoke shop"],
};

/**
 * Every term, flattened.
 *
 * Exported so the "no term is a common word" rule can be asserted rather than
 * only described above — the list's specificity IS the feature, and prose
 * cannot fail a build.
 *
 * @internal — for that assertion and nothing else. No client has any use for the raw
 * term list, and `check-shared-barrel` would otherwise require it to be published as
 * part of what `@loonext/shared` promises, which is a bigger claim than a test helper
 * should be able to make on its own.
 */
export function allTerms(): string[] {
  return Object.values(TERMS).flatMap((terms) => [...terms]);
}

/**
 * Every category a business name suggests, with the term that suggested it.
 *
 * Returns ALL matches rather than the first: a name hitting two categories is
 * stronger evidence than one hitting a single term, and a reviewer should see
 * both rather than whichever the loop reached first.
 */
export function screenBusinessName(name: string): CategoryMatch[] {
  const haystack = ` ${name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
  const matches: CategoryMatch[] = [];

  for (const [category, terms] of Object.entries(TERMS) as [
    ProhibitedCategory,
    readonly string[],
  ][]) {
    for (const term of terms) {
      // The haystack is already punctuation-normalised to single spaces, so a
      // multi-word term matches as its own words rather than as a substring —
      // which is what keeps "cash advance" from matching "Cashmere Advanced
      // Cleaning".
      const needle = ` ${term.replace(/[^a-z0-9]+/g, " ")} `;
      if (haystack.includes(needle)) {
        matches.push({ category, term });
        break;
      }
    }
  }
  return matches;
}

/** The line an ops alert leads with. Plain, and never a verdict. */
export function screeningSummary(name: string, matches: CategoryMatch[]): string {
  if (matches.length === 0) return `“${name}” matched nothing.`;
  const parts = matches.map((m) => `${m.category.replace(/_/g, " ")} (“${m.term}”)`);
  return (
    `“${name}” looks like it could be in a category the AUP prohibits: ` +
    `${parts.join(", ")}. This is a keyword match on the name they typed, not ` +
    `a finding — plenty of real businesses share these words. Look before ` +
    `acting.`
  );
}
