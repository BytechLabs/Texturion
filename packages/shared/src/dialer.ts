/**
 * #459 — what a keypad means, in one place.
 *
 * The three clients each grew their own answer to "who am I dialling". Android
 * scored app contacts against device contacts; iOS did a substring check over
 * the server's page; web did `.includes` inline in the component. All three
 * answered a narrower question than the founder asked, which was: let me reach
 * somebody I already know **from the keypad**, without knowing their number.
 *
 * # T9, and why a phone keypad already is a name search
 *
 * The letters printed on a keypad are not decoration. 2 is ABC, 6 is MNO, so
 * typing 2-6-2 spells BOB, and every system dialer on Android has worked this
 * way for twenty years. That is what makes "dial by name, from the same screen"
 * possible without a second input: there is no search field to add, because the
 * keypad IS the search field. Nothing about the existing number behaviour
 * changes — a typed area code still matches numbers, because a candidate is
 * scored on BOTH its number and its name and the better match wins.
 *
 * # Why names match at word starts and not anywhere
 *
 * Typing 5-2-6 should find "Jan Kaminski" (KAM) and should not find "Alaska
 * Roofing" because the letters happen to sit in the middle of a word. A
 * dialer that matches mid-word returns a list nobody trusts, and an untrusted
 * list is one people stop reading, which costs more than the extra hits gain.
 * So a name matches when the typed digits prefix any WORD of it.
 *
 * Word splitting is done by hand rather than with `\b`, deliberately: this file
 * is hand-ported to Kotlin and Swift, where `\b` is a backspace character in a
 * Kotlin string and does not compile at all in a Swift regex literal. Explicit
 * splitting ports without a trap.
 */

/** The keypad's letters, as every phone has printed them since 1963. */
const T9_LETTERS: Record<string, string> = {
  a: "2", b: "2", c: "2",
  d: "3", e: "3", f: "3",
  g: "4", h: "4", i: "4",
  j: "5", k: "5", l: "5",
  m: "6", n: "6", o: "6",
  p: "7", q: "7", r: "7", s: "7",
  t: "8", u: "8", v: "8",
  w: "9", x: "9", y: "9", z: "9",
};

/**
 * How many digits before we will match a NUMBER. Four, unchanged from what the
 * clients already did: fewer than that and every contact in the book matches.
 */
export const MIN_NUMBER_DIGITS = 4;

/**
 * How many digits before we will match a NAME. Two, because two letters is a
 * normal way to reach for somebody ("Bo…") and the result list is capped, so a
 * loose early match costs a row rather than a wall of noise.
 */
export const MIN_NAME_DIGITS = 2;

/** How many matches a dialer shows. Four rows is a glance; ten is a directory. */
export const MAX_DIALER_MATCHES = 4;

/** Which book a match came from. On an equal score APP beats DEVICE. */
export type DialerSource = "app" | "device";

/**
 * One thing that could be who you meant. App contacts (ours) and device
 * contacts (the phone's address book) collapse to this single shape so the
 * matcher never has to know which book it is reading.
 */
export interface DialerCandidate {
  /** May be blank: a number-only contact is still a candidate. */
  name?: string | null;
  number: string;
  source: DialerSource;
  /** Our contact id when this came from our own book; absent for device rows. */
  contactId?: string | null;
}

export interface DialerMatch {
  /** What to show: the name, or the formatted number for a number-only row. */
  label: string;
  number: string;
  source: DialerSource;
  contactId?: string | null;
  /** Higher is a tighter match. Exposed so callers can test the ordering. */
  score: number;
}

/**
 * The bare digits with a single leading NANP country code dropped, so
 * "+14165550123", "14165550123" and "4165550123" all compare equal.
 */
export function nationalDigits(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
}

/**
 * A name as its keypad digits: "Bob Vance" → "262" + "82623".
 *
 * Returned per word rather than as one run, because the match rule is
 * per-word. Words with no letters at all (a lone "&", "III") drop out; they
 * would only ever produce empty matches.
 */
export function t9Words(name: string): string[] {
  const words: string[] = [];
  let current = "";
  for (const character of name.toLowerCase()) {
    const digit = T9_LETTERS[character];
    if (digit) {
      current += digit;
    } else if (character >= "0" && character <= "9") {
      // A digit inside a name ("A1 Plumbing") is already keypad-shaped.
      current += character;
    } else {
      if (current.length > 0) words.push(current);
      current = "";
    }
  }
  if (current.length > 0) words.push(current);
  return words;
}

/**
 * Score one candidate against the typed digits. Zero means no match.
 *
 * The scale is spread out rather than 1-2-3 so a number match and a name match
 * can be compared without either category swallowing the other: an exact number
 * always wins, a name that starts with what you typed beats a number that
 * merely contains it, and a mid-list surname beats nothing but noise.
 */
export function scoreDialerCandidate(typed: string, candidate: DialerCandidate): number {
  const typedDigits = nationalDigits(typed);
  if (typedDigits.length === 0) return 0;

  let best = 0;

  const candidateDigits = nationalDigits(candidate.number);
  if (candidateDigits.length > 0 && typedDigits.length >= MIN_NUMBER_DIGITS) {
    if (candidateDigits === typedDigits) best = 100;
    else if (candidateDigits.endsWith(typedDigits)) best = 80;
    else if (candidateDigits.includes(typedDigits)) best = 20;
  }

  const name = (candidate.name ?? "").trim();
  if (name.length > 0 && typedDigits.length >= MIN_NAME_DIGITS) {
    const words = t9Words(name);
    for (let index = 0; index < words.length; index += 1) {
      if (!words[index].startsWith(typedDigits)) continue;
      // The first word is the one people reach for, so it ranks above a match
      // on a surname or the second half of a business name.
      const nameScore = index === 0 ? 60 : 40;
      if (nameScore > best) best = nameScore;
    }
  }

  return best;
}

/**
 * The matches for what has been typed, best first, capped.
 *
 * Ties break toward our own book and then toward the order the caller passed —
 * callers pass app candidates first, so the crew's shared contacts win over a
 * personal phone entry for the same person. That precedence is the founder's:
 * a device contact SUPPLEMENTS the shared book rather than competing with it.
 *
 * Duplicates collapse by number, so a person who is in both books appears once.
 */
export function rankDialerCandidates(
  typed: string,
  candidates: DialerCandidate[],
  limit: number = MAX_DIALER_MATCHES,
): DialerMatch[] {
  const scored: { match: DialerMatch; order: number }[] = [];

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const score = scoreDialerCandidate(typed, candidate);
    if (score === 0) continue;
    // A candidate with no dialable digits is a dead row.
    if (nationalDigits(candidate.number).length === 0) continue;
    const name = (candidate.name ?? "").trim();
    scored.push({
      order: index,
      match: {
        label: name.length > 0 ? name : candidate.number,
        number: candidate.number,
        source: candidate.source,
        contactId: candidate.contactId ?? null,
        score,
      },
    });
  }

  scored.sort((a, b) => {
    if (b.match.score !== a.match.score) return b.match.score - a.match.score;
    if (a.match.source !== b.match.source) return a.match.source === "app" ? -1 : 1;
    return a.order - b.order;
  });

  // Collapse duplicates AFTER sorting, never before. Deduping on the way in
  // keeps whichever row arrived first, which quietly hands the tie to a device
  // contact whenever the caller happens to list it first — and the founder's
  // rule is that our own book wins the tie, not that it is passed first.
  const seen = new Set<string>();
  const unique: DialerMatch[] = [];
  for (const entry of scored) {
    const key = nationalDigits(entry.match.number);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(entry.match);
    if (unique.length >= limit) break;
  }
  return unique;
}

/**
 * The single best match, which is what the readout's name line shows.
 *
 * Kept as its own function rather than `rank(...)[0]` because that is what
 * every caller of the old per-platform correlators wanted, and because the
 * label a caller shows under the number should not change shape when the list
 * below it does.
 */
export function bestDialerMatch(
  typed: string,
  candidates: DialerCandidate[],
): DialerMatch | null {
  const ranked = rankDialerCandidates(typed, candidates, 1);
  return ranked.length > 0 ? ranked[0] : null;
}
