/**
 * #291 — the fields a workspace defines for itself.
 *
 * "The equipment fields an HVAC company needs are not the ones a plumber
 * needs, and we should not guess for either."
 *
 * THE PRIVACY LINE IS PRODUCT COPY, NOT A DISCLAIMER. Custom fields let a
 * workspace store data classes we have not declared to the stores (#254) and
 * could not honour under our retention policy (#284). We cannot enforce that
 * in a text column, so the product says it at the ONE moment somebody is
 * thinking about what goes in a field: when they are defining it. Buried in a
 * help page it would never be read.
 */

/** How many fields a workspace may define. */
export const CONTACT_FIELDS_CAP = 10;

/**
 * The types, deliberately few.
 *
 * Every one is something a crew can fill in from a van without thinking. A
 * "formula" or a "lookup" is a spreadsheet feature that arrives with its own
 * support burden and its own way of being wrong.
 */
export const CONTACT_FIELD_KINDS = [
  "text",
  "number",
  "date",
  "select",
  "checkbox",
] as const;

export type ContactFieldKind = (typeof CONTACT_FIELD_KINDS)[number];

export interface ContactFieldDef {
  /**
   * The stable identity. Values are keyed on THIS, so relabelling a field
   * keeps every value attached — which is the difference between a cosmetic
   * edit and silently emptying a workspace's operational knowledge.
   */
  key: string;
  label: string;
  kind: ContactFieldKind;
  /** Only for `select`. */
  options?: string[] | null;
  position?: number;
}

/** How many choices a dropdown may hold before it is a list nobody reads. */
export const CONTACT_FIELD_OPTIONS_CAP = 40;

/** The longest a stored value may be. */
export const CONTACT_FIELD_VALUE_MAX = 200;

/**
 * A label, turned into the key it will be stored under.
 *
 * The same string becomes a JSON key AND a CSV header for import mapping
 * (#248) and export (#227), so it has to survive both: lower case, no spaces,
 * no punctuation. Returns null when nothing usable is left — "???" is not a
 * field name, and inventing one would produce a column nobody can map.
 */
export function contactFieldKey(label: string): string | null {
  const key = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40)
    .replace(/_+$/g, "");
  // Must start with a letter: a key beginning with a digit is legal JSON and
  // an awkward column head, and the database refuses it anyway.
  if (!/^[a-z][a-z0-9_]*$/.test(key)) return null;
  return key;
}

/**
 * Is this value acceptable for this kind?
 *
 * Returns the reason it is not, or null when it is. A REASON rather than a
 * boolean because the caller shows it to somebody who typed the value, and
 * "invalid" tells them nothing they did not already suspect.
 */
export function contactFieldValueError(
  def: Pick<ContactFieldDef, "kind" | "options" | "label">,
  value: string,
): string | null {
  // Empty is always allowed, and it is not the same as absent: "we asked and
  // there is no gate code" is a fact worth recording.
  if (value === "") return null;
  if (value.length > CONTACT_FIELD_VALUE_MAX) {
    return `${def.label} is too long`;
  }

  switch (def.kind) {
    case "number":
      return Number.isFinite(Number(value))
        ? null
        : `${def.label} should be a number`;
    case "date":
      // ISO date only. A crew typing "next Tuesday" into a date field is a
      // value nothing downstream can sort, filter or remind on.
      return /^\d{4}-\d{2}-\d{2}$/.test(value)
        ? null
        : `${def.label} should be a date`;
    case "select":
      return (def.options ?? []).includes(value)
        ? null
        : `${def.label} is not one of the choices`;
    case "checkbox":
      return value === "yes" || value === "no"
        ? null
        : `${def.label} should be yes or no`;
    default:
      return null;
  }
}

/** What the settings screen says, in one place. */
export const CONTACT_FIELDS_COPY = {
  heading: "Your own contact fields",
  intro:
    "Boiler model, gate code, warranty date — the things your crew needs " +
    "before the truck leaves. They show on every customer and come back in " +
    "search and exports.",
  /**
   * THE LINE THAT MATTERS. Said where fields are defined, because that is the
   * only moment somebody is deciding what goes in one.
   */
  privacy:
    "Do not put card numbers, government IDs or health information here. " +
    "These fields are stored and exported like a customer's name, which is " +
    "not the handling those need.",
  cap_reached: `That is all ${CONTACT_FIELDS_CAP} fields. Remove one to add another.`,
  /** Deleting a definition does not delete what people typed into it. */
  delete_warning:
    "Removing a field hides it everywhere. What your crew typed into it stays " +
    "on each customer until you edit them.",
} as const;
