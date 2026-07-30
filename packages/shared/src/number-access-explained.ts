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
export function numberAccessLevelLabel(level: NumberAccessLevel): string {
  switch (level) {
    case "text":
      return "Can text";
    case "note":
      return "Read and notes only";
    case "none":
      return "Hidden";
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
): string {
  switch (decidedBy) {
    case "user":
      return "A rule naming them";
    case "role":
      return principal ? `A rule for ${principal}s` : "A rule for their role";
    case "all":
      return "A rule for everyone";
    case "no-match":
      return "This number has rules, and none of them include them";
    case "unruled":
      return "Nobody has restricted this number";
    case "role-override":
      return principal === "owner"
        ? "Owners reach every number"
        : "Admins reach every number";
    case "not-a-member":
      return "No longer in this workspace";
  }
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
