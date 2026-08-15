/**
 * #348 — the words for "what does this person reach, and why".
 *
 * The access model has three interacting principal kinds and a precedence
 * order, and #348's complaint is that all of it was invisible: *"A permission
 * model that cannot be inspected is one nobody trusts, and one where a
 * misconfiguration is found by a customer rather than by the person who made
 * it."*
 *
 * The server now answers with a level and a `decided_by` code. Turning those
 * two codes into a sentence is the same job on three clients, which is three
 * chances to describe one security rule three different ways — the #437 failure,
 * on the surface where it would matter most. So the wording lives here once;
 * web imports it, Android and iOS hand-port it with the same test cases.
 *
 * WHY THE REASON IS A SENTENCE AND NOT A CODE. PORTAL-UX §3.1 requires a card to
 * name the signal that placed it, and this screen is that principle in its purest
 * form — the whole screen IS the signal. "role" tells an owner nothing; "A rule
 * for members" tells them where to go and what to change.
 */

/** What the caller may do with the number. Mirrors `NumberAccessLevel`. */
import type { SayKey } from "./support";

export type NumberAccessLevel = "text" | "note" | "none";

/** Which rule produced that level. Mirrors the SQL `decided_by` vocabulary. */
export type NumberAccessDecidedBy =
  | "user"
  | "role"
  | "all"
  | "no-match"
  | "unruled"
  | "role-override"
  | "not-a-member";

export interface NumberAccessExplanation {
  phone_number_id: string;
  number_e164: string | null;
  level: NumberAccessLevel;
  decided_by: NumberAccessDecidedBy;
  /** The role a 'role' rule named. Null for every other kind. */
  principal: string | null;
}

/**
 * What they can do, in the crew's words rather than the schema's.
 *
 * "Can text" rather than "text" because the level is a capability, and an owner
 * scanning a list is asking a yes/no question about sending.
 */
export function numberAccessLevelLabel(level: NumberAccessLevel, say: SayKey): string {
  switch (level) {
    case "text":
      return say("domain.numberAccessCanText");
    case "note":
      return say("domain.numberAccessNoteOnly");
    case "none":
      return say("domain.numberAccessHidden");
  }
}

/**
 * Why, in one short clause naming the rule an owner would go and edit.
 *
 * The two that carry the most weight are the ones that look like each other and
 * are not: `unruled` means nobody has restricted this number, and `no-match`
 * means somebody restricted it and left this person out. Both end in the person
 * having or not having access "by default", and confusing them is how an owner
 * concludes the rules are broken.
 */
export function numberAccessReason(
  decidedBy: NumberAccessDecidedBy,
  principal: string | null,
  /**
   * #228 — resolves a catalogue key. REQUIRED, and placed before `viewer` so
   * it can be.
   *
   * It was briefly `say: SayKey = (key) => key` at the end of the list, which
   * compiles and is worth nothing: every existing call site kept type-checking
   * while now returning `domain.numberAccessRuleNamingYou` to the screen. A
   * default here silences the single error that makes the conversion safe.
   */
  say: SayKey,
  /**
   * #286: who is reading. An owner inspecting somebody else's access reads
   * "them"; a member asking about their own reads "you".
   *
   * A PARAMETER and not a second function, because these seven clauses are the
   * one place a security rule is put into words and a copy of them written for
   * the member-facing screen is a copy that drifts — which is the #437 failure
   * this file exists to prevent, arriving through the door it was guarding.
   */
  viewer: NumberAccessViewer = "other",
): string {
  const self = viewer === "self";
  switch (decidedBy) {
    case "user":
      return say(
        self ? "domain.numberAccessRuleNamingYou" : "domain.numberAccessRuleNamingThem",
      );
    case "role":
      /*
       * The named-role clause keeps its own shape rather than becoming a key
       * with a {role} hole. `principal` is a wire value — "admin", "member",
       * "bookkeeper" — and appending an "s" to it is English pluralisation of a
       * word this module did not write. It is the one clause here that a
       * translator cannot finish without the role names being translated too,
       * which is a separate roster and a separate decision.
       */
      if (principal) return `A rule for ${principal}s`;
      return say(
        self ? "domain.numberAccessRuleForYourRole" : "domain.numberAccessRuleForTheirRole",
      );
    case "all":
      return say("domain.numberAccessRuleForEveryone");
    case "no-match":
      return say(
        self ? "domain.numberAccessNoMatchYou" : "domain.numberAccessNoMatchThem",
      );
    case "unruled":
      return say("domain.numberAccessUnruled");
    case "role-override":
      return say(
        principal === "owner" ? "domain.numberAccessOwners" : "domain.numberAccessAdmins",
      );
    case "not-a-member":
      return say(
        self ? "domain.numberAccessNotMemberYou" : "domain.numberAccessNotMemberThem",
      );
  }
}

/** Whose access the reader is looking at. */
export type NumberAccessViewer = "self" | "other";

/**
 * #286 — what a MEMBER is owed when a number is missing from their app.
 *
 * The issue names the failure precisely: a new tech who can see one line and
 * not another reads the absence as the app being broken, and *"silent absence
 * is the worse failure"*. So the member-facing screen says what they cannot
 * reach as well as what they can — and this is the sentence under it, which is
 * the part that stops the reader concluding it is a bug and stops them asking
 * the owner one at a time.
 *
 * Null when there is nothing to explain: a member who reaches everything has
 * no absence to account for, and a paragraph reassuring them about a problem
 * they do not have is furniture.
 */
export function numberAccessSelfNote(
  rows: readonly NumberAccessExplanation[],
  say: SayKey,
): string | null {
  const hidden = rows.filter((row) => row.level === "none").length;
  const readOnly = rows.filter((row) => row.level === "note").length;
  if (hidden === 0 && readOnly === 0) return null;

  /*
   * #228: singular and plural are SEPARATE KEYS, and the joiner is a key too.
   *
   * This used to build the sentence out of `${n} ${n === 1 ? "number is" :
   * "numbers are"}`, which is English grammar hard-coded into a shared module.
   * French agrees the noun, its article and its verb together, so no amount of
   * swapping a fragment expresses it — and " and " is not "et" in every
   * position either. Same shape Android already uses.
   */
  const parts: string[] = [];
  if (hidden > 0) {
    parts.push(
      say(
        hidden === 1
          ? "domain.numberAccessSelfHiddenOne"
          : "domain.numberAccessSelfHiddenMany",
      ).replace("{count}", String(hidden)),
    );
  }
  if (readOnly > 0) {
    parts.push(
      say(
        readOnly === 1
          ? "domain.numberAccessSelfReadOnlyOne"
          : "domain.numberAccessSelfReadOnlyMany",
      ).replace("{count}", String(readOnly)),
    );
  }
  return say("domain.numberAccessSelfNote").replace(
    "{parts}",
    parts.join(` ${say("domain.and")} `),
  );
}

/**
 * Is this row worth an owner's attention?
 *
 * Used to order the list: the numbers somebody CANNOT fully use come first,
 * because an owner opening this screen is checking a suspicion, not reading a
 * report. A list that opens with six green rows buries the one red one.
 */
export function numberAccessIsRestricted(level: NumberAccessLevel): boolean {
  return level !== "text";
}

/**
 * The rows in the order they should be read: restricted first, then by number.
 *
 * Sorting by number within each group rather than leaving the server's order,
 * because the server returns `phone_numbers` order and an owner comparing two
 * members expects the same numbers in the same places on both screens.
 */
export function sortNumberAccessExplanations(
  rows: readonly NumberAccessExplanation[],
): NumberAccessExplanation[] {
  return [...rows].sort((a, b) => {
    const byRestriction =
      Number(numberAccessIsRestricted(b.level)) -
      Number(numberAccessIsRestricted(a.level));
    if (byRestriction !== 0) return byRestriction;
    return (a.number_e164 ?? "").localeCompare(b.number_e164 ?? "");
  });
}
