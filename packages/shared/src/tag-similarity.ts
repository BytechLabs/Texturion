/**
 * #298 — catching a near-duplicate tag before it exists.
 *
 * # Why this is the half that matters
 *
 * #298: "catching it at creation is worth more than any amount of cleanup
 * afterwards." Merge is the repair; this is the prevention, and prevention is
 * cheaper because nobody has to notice the problem first. Sprawl is invisible
 * while it happens — each act is reasonable on its own, a tech typing
 * "warranty" instead of "Warranty" — and only becomes visible once a filter has
 * been quietly under-returning for months.
 *
 * The create-on-attach RPC already keys on `lower(name)`, so exact case
 * collisions cannot happen. What it cannot catch is "warranty" against
 * "Warranty claim" against "wrnty", which is the actual failure.
 *
 * # It SUGGESTS. It never refuses.
 *
 * The devil's advocate in #298 is the design constraint: "the temptation is to
 * impose a taxonomy. That is the wrong move for this market — a plumber's
 * categories are not an HVAC company's, and a locked-down tag list would be
 * ignored in favour of the notes field."
 *
 * So a match is an offer. A crew that genuinely wants "Warranty" and "Warranty
 * claim" as separate tags gets both, on the second tap, and nothing here can
 * stop them.
 */

/**
 * Strip a name to what it MEANS, for comparison only.
 *
 * Case, punctuation, and whitespace all go: "Quote sent", "quote-sent" and
 * "quotesent" are one idea typed three ways. The stored name is untouched — the
 * crew's spelling is theirs.
 */
export function normalizeTagName(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Levenshtein distance, capped.
 *
 * Capped because the answer is only ever compared against a small threshold, and
 * an uncapped distance over two long strings is work spent computing a number
 * that will be discarded. Bails as soon as the best possible result exceeds the
 * cap.
 */
export function editDistance(a: string, b: string, cap = 3): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > cap) return cap + 1;

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let rowBest = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + cost,
      );
      current.push(value);
      if (value < rowBest) rowBest = value;
    }
    // Every remaining row can only add to the best value in this one, so once
    // that exceeds the cap the answer is settled.
    if (rowBest > cap) return cap + 1;
    previous = current;
  }
  return previous[b.length];
}

/**
 * How close two typed names are, as a distance on the normalised forms.
 *
 * Returns 0 for "the same idea", which is what a differing case or a hyphen
 * amounts to, and the edit distance otherwise.
 */
export function tagNameDistance(a: string, b: string): number {
  return editDistance(normalizeTagName(a), normalizeTagName(b));
}

/**
 * The edit distance at which two names are worth questioning.
 *
 * Two is a typo — a transposition, a doubled letter, a missing one. Three
 * starts matching genuinely different short words ("hvac" and "hvacs" is one,
 * but "gas" and "was" is also one) and the false offers would train people to
 * dismiss the prompt, which costs more than the duplicates it catches.
 */
export const TAG_SUGGEST_DISTANCE = 2;

/**
 * The shortest name that gets fuzzy matching at all.
 *
 * Below five characters an edit distance of two is most of the word, so "gas"
 * would suggest "was" and "van" would suggest "vat". Short names still get the
 * exact normalised match, which is where the real duplicates are anyway.
 */
const FUZZY_MIN_LENGTH = 5;

export interface TagLike {
  id: string;
  name: string;
}

export interface TagSuggestion<T extends TagLike> {
  tag: T;
  /** True when the names mean the same thing once punctuation and case go. */
  exact: boolean;
}

/**
 * The existing tag a typed name probably means, if there is one.
 *
 * Exact normalised matches always win over a fuzzy one, and among fuzzy matches
 * the closest wins. Returns null when nothing is close enough — the caller then
 * creates the tag, which is the common path and must stay frictionless.
 */
export function suggestExistingTag<T extends TagLike>(
  typed: string,
  existing: readonly T[],
): TagSuggestion<T> | null {
  const target = normalizeTagName(typed);
  if (target === "") return null;

  let best: TagSuggestion<T> | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const tag of existing) {
    const candidate = normalizeTagName(tag.name);
    if (candidate === "") continue;
    if (candidate === target) return { tag, exact: true };
    // Fuzzy only above the length floor, and only against names that are
    // themselves long enough for a two-edit gap to mean something.
    if (target.length < FUZZY_MIN_LENGTH || candidate.length < FUZZY_MIN_LENGTH) {
      continue;
    }
    const distance = editDistance(target, candidate, TAG_SUGGEST_DISTANCE);
    if (distance <= TAG_SUGGEST_DISTANCE && distance < bestDistance) {
      bestDistance = distance;
      best = { tag, exact: false };
    }
  }
  return best;
}

/**
 * How many tags one workspace may hold.
 *
 * #298 asks for "a sane ceiling, high enough that nobody legitimate hits it and
 * low enough to catch runaway automation". Two hundred is far past the forty
 * that already makes a tag list unusable, so a crew reaching it has a bug or an
 * integration, not a taxonomy.
 */
export const TAGS_PER_WORKSPACE = 200;
