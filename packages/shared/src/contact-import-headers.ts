/**
 * Which column of a contacts CSV holds what.
 *
 * The web importer has always rewritten the user's file into the canonical
 * `phone,name,address,notes` header before uploading, so a file exported from
 * some other tool ("Phone Number", "Mobile", "Cell") imported fine there. Both
 * phone apps hand the file to the API as-is, and the API only ever looked for
 * an exact `phone` column, so the same file that worked on a laptop was
 * rejected on a phone.
 *
 * Detection lives here so all three clients and the server agree on it. The
 * server applying it is what actually fixes the class: any client, present or
 * future, can post a raw third-party file and get the same answer.
 */

export type ContactImportField =
  | "phone"
  | "name"
  | "first_name"
  | "last_name"
  | "address"
  | "notes"
  | "opted_out";

/** Case, spaces, and punctuation are noise: "Phone Number" → "phonenumber". */
export function normalizeContactHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Header patterns per target field, most specific first. Order matters:
 * `opted_out` is matched before `phone` so a "do not text" column is never
 * claimed by phone's broad `number` pattern, and the split-name fields are
 * matched before `name` so "First Name" is not read as the whole name.
 */
const FIELD_PATTERNS: readonly [ContactImportField, RegExp[]][] = [
  [
    "opted_out",
    [
      /^optedout$/,
      /optout/,
      /unsubscribe/,
      // #248 round 2: "Do Not Call" is the single most common spelling of this
      // column in a bought or exported list and NONE of the patterns above
      // matched it (it normalises to `donotcall`, which `donotcontact` misses).
      // Widening the list is worth doing — it is the right DEFAULT GUESS, which
      // is all this list has ever been allowed to be — but it is explicitly not
      // a gate, because the next export says "Marketing Status" or
      // "Contactable". Nothing may be dropped on the strength of this list
      // failing to match: see `defaultContactImportColumns`, where the guess is
      // handed to a person to confirm. Restrictive spellings ONLY: an "OK to
      // Text" column means the opposite, and a synonym list that cannot tell
      // direction apart would block exactly the people who agreed.
      /donottext|donotcontact|donotcall|donotmail/,
      /suppress/,
      /^dnc$|^dncflag$|^dnclist$/,
      /^stop$|^stopped$/,
      /blocked/,
    ],
  ],
  ["phone", [/^phone$/, /phone/, /mobile/, /^cell/, /^tel/, /number/]],
  // #248: split first/last columns, the dominant shape in every CRM and phone
  // export. Anchored forms first, then the loose ones ("Contact First Name"),
  // and never the bare `/name/` catch-all — that belongs to `name` alone.
  ["first_name", [/^firstname$/, /^givenname$/, /^first$/, /^fname$/, /firstname|givenname/]],
  ["last_name", [/^lastname$/, /^surname$/, /^familyname$/, /^last$/, /^lname$/, /lastname|surname|familyname/]],
  [
    "name",
    [
      /^name$/,
      /^fullname$/,
      /^contactname$|^customername$|^clientname$/,
      /^contact$|^customer$|^client$/,
    ],
  ],
  ["address", [/^address$/, /address/, /^addr/, /street/]],
  ["notes", [/^notes?$/, /comment/, /memo/, /description/]],
];

/**
 * `name`'s last resort — any header merely CONTAINING "name".
 *
 * Held back from FIELD_PATTERNS because it is only safe when the file has no
 * split-name columns. In a `First Name, Last Name, Company Name, Phone` export
 * it would claim "Company Name" as the person's name, and the business would
 * end up texting a book of company names. When first/last are present they ARE
 * the name, so the catch-all has nothing left to do.
 */
const NAME_LAST_RESORT = /name/;

/** Column index per detected field; a field with no match is absent. */
export type ContactImportMapping = Partial<
  Record<ContactImportField, number>
>;

/**
 * Detect a column mapping from the header row. Each column is claimed by at
 * most one field; per field the most specific pattern wins, scanning columns
 * left to right.
 */
export function detectContactColumns(
  headers: readonly string[],
): ContactImportMapping {
  const normalized = headers.map(normalizeContactHeader);
  const claimed = new Set<number>();
  const mapping: ContactImportMapping = {};

  const claim = (field: ContactImportField, patterns: RegExp[]): void => {
    for (const pattern of patterns) {
      for (let i = 0; i < normalized.length; i += 1) {
        if (claimed.has(i)) continue;
        if (pattern.test(normalized[i])) {
          mapping[field] = i;
          claimed.add(i);
          return;
        }
      }
    }
  };

  for (const [field, patterns] of FIELD_PATTERNS) claim(field, patterns);
  if (
    mapping.name === undefined &&
    mapping.first_name === undefined &&
    mapping.last_name === undefined
  ) {
    claim("name", [NAME_LAST_RESORT]);
  }
  return mapping;
}

/**
 * The values a flag column may carry, in both directions.
 *
 * Shared so the server, the wizard's preview and both phone apps read a
 * do-not-text cell the same way. `x` is here because a hand-maintained
 * spreadsheet marks the blocked rows with one — the API's own truthy set left
 * it out, so an `x`-marked opt-out column imported as nobody opted out at all.
 */
const FLAG_TRUE = new Set(["true", "t", "yes", "y", "1", "x"]);
const FLAG_FALSE = new Set(["false", "f", "no", "n", "0"]);

/**
 * Read one flag cell: true, false, or NULL for "I do not know what this says".
 *
 * The third answer is the point. Anything-that-is-not-true-is-false is how a
 * column of `Subscribed`/`Unsubscribed` becomes a column of nobody opted out —
 * the importer would read the restriction as a blank and text them. A caller
 * that gets null must refuse rather than pick a direction, because the two
 * directions are "text somebody who said stop" and "block somebody who agreed",
 * and no default is right for both.
 *
 * An EMPTY cell is a genuine false: a flag column marks the rows it means.
 */
export function readContactFlag(value: string | null | undefined): boolean | null {
  const token = (value ?? "").trim().toLowerCase();
  if (token === "") return false;
  if (FLAG_TRUE.has(token)) return true;
  if (FLAG_FALSE.has(token)) return false;
  return null;
}

/**
 * HOW MANY COLUMNS THIS FILE HAS — which is not `headers.length`.
 *
 * #248 round 3. Every loop in the importer was bounded by the header row, so a
 * cell PAST the end of it was not merely misread — it was never looked at.
 * `Phone,Name` over a row reading `+1206…,Ann,DO NOT CALL` dropped the third
 * cell before any rule could see it, and hand-edited files do this constantly:
 * somebody adds a note to one row and does not touch the header.
 *
 * So the count comes from the DATA. A cell past the header is a column with a
 * blank name, and it is accounted for like any other.
 *
 * NO EXEMPTION FOR AN EMPTY COLUMN, and the temptation is real: a stray
 * trailing comma on one row adds a column nobody meant, with nothing in it, and
 * making the caller answer for it feels like noise. It is refused anyway,
 * because "a column with nothing in it decides nothing" is a rule, and a rule
 * about which columns may be skipped is exactly the thing two rounds of this
 * issue lost to. One click on a malformed file is the whole cost.
 */
export function contactImportColumnCount(
  headers: readonly string[],
  dataRows: readonly (readonly string[])[],
): number {
  let count = headers.length;
  for (const row of dataRows) {
    if (row.length > count) count = row.length;
  }
  return count;
}

/**
 * The distinct values one column carries, for showing a person what they are
 * being asked about.
 *
 * The whole design rests on somebody SEEING "DO NOT CALL" before they dismiss
 * the column that holds it, so the sample is part of the contract rather than a
 * detail of one client's wizard: a phone app that showed only header names
 * would be asking the question without showing the answer.
 *
 * Distinct and in file order, blanks dropped — a column of 400 `Subscribed`s
 * says one thing, and printing it 400 times says it worse.
 */
export function contactImportColumnSamples(
  dataRows: readonly (readonly string[])[],
  index: number,
  limit = 5,
): string[] {
  const seen = new Map<string, string>();
  for (const row of dataRows) {
    const value = (row[index] ?? "").trim();
    if (value === "") continue;
    const key = value.toLowerCase();
    if (!seen.has(key)) seen.set(key, value);
    if (seen.size >= limit) break;
  }
  return [...seen.values()];
}

/**
 * How many of a column's distinct values every client prints unprompted.
 *
 * One number for all three clients. The web wizard used to print three while
 * both phone apps printed five, for no reason either could state.
 */
export const CONTACT_IMPORT_COLUMN_SAMPLE_LIMIT = 5;

/**
 * The most distinct values kept per column for showing on request.
 *
 * A do-not-text column holds a handful. A name column holds one per row, and
 * asking any of the three clients to lay out 50,000 of them is how a mapping
 * screen stops opening. Past this, {@link ContactImportColumnValues.total} still
 * reports the truth, so the count on screen is right even when the list is cut.
 *
 * This bounds what is RENDERED, which is the cost that hurts. Counting distinct
 * values means remembering every one that has been seen, so the memory a column
 * takes is set by the file and not by this number — no ceiling can change that.
 */
export const CONTACT_IMPORT_COLUMN_VALUE_CEILING = 200;

/** What one column holds, and how much of it is being shown. */
export interface ContactImportColumnValues {
  /**
   * Distinct non-blank values in file order, at most
   * {@link CONTACT_IMPORT_COLUMN_VALUE_CEILING}.
   */
  values: string[];
  /**
   * How many distinct values the column really has.
   *
   * Counted past the ceiling on purpose. "and 12 more" tells a reader they have
   * not seen everything; "and more" tells them nothing, and could as easily
   * stand for one value as four hundred.
   */
  total: number;
}

/**
 * What every column of a file holds, from one pass over the rows.
 *
 * Per column rather than per client because the question is the same on all
 * three, and one pass rather than one per column because knowing how many
 * distinct values a column REALLY has means reading every row of it — there is
 * no early exit from a count. Walking the rows once and answering for all
 * columns costs what the old per-column loop cost, and answers honestly.
 */
export function contactImportAllColumnValues(
  dataRows: readonly (readonly string[])[],
  columnCount: number,
): ContactImportColumnValues[] {
  const seen: Set<string>[] = [];
  const kept: string[][] = [];
  for (let index = 0; index < columnCount; index += 1) {
    seen.push(new Set());
    kept.push([]);
  }
  for (const row of dataRows) {
    for (let index = 0; index < columnCount; index += 1) {
      const value = (row[index] ?? "").trim();
      if (value === "") continue;
      const distinct = seen[index]!;
      const before = distinct.size;
      distinct.add(value.toLowerCase());
      if (distinct.size === before) continue;
      // The set counts, the array shows. Only the second one is bounded, and the
      // value kept is the file's own spelling rather than the lowercased key.
      const shown = kept[index]!;
      if (shown.length < CONTACT_IMPORT_COLUMN_VALUE_CEILING) shown.push(value);
    }
  }
  return kept.map((values, index) => ({
    values,
    total: seen[index]!.size,
  }));
}

/**
 * The distinct values in a flag column that {@link readContactFlag} cannot read.
 *
 * The other half of the same defect, one level down: a column CORRECTLY
 * identified as the do-not-text column is still a silent drop if its cells say
 * `Subscribed` and the reader only knows `yes`. Empty, because every value was
 * readable, is the only answer that lets an import proceed.
 */
export function unreadableFlagValues(
  dataRows: readonly (readonly string[])[],
  index: number,
): string[] {
  const unreadable = new Map<string, string>();
  for (const row of dataRows) {
    const raw = (row[index] ?? "").trim();
    if (readContactFlag(raw) !== null) continue;
    const key = raw.toLowerCase();
    if (!unreadable.has(key)) unreadable.set(key, raw);
  }
  return [...unreadable.values()];
}

/**
 * The one name to store, from whichever of the three columns a file carried.
 *
 * Split first/last is the shape most exports use, and it failed SILENTLY: the
 * detector claimed the first-name column as the whole name, every row reported
 * "ready", and the crew ended up with a book of first names and no way to tell
 * which Dave was which. Joining is decided here rather than in each importer so
 * the API, the web wizard's preview and both phone apps agree on the answer —
 * a preview that promises a different name from the one that lands is its own
 * kind of broken.
 *
 * First + last wins over a `full` column when both are present: a file that
 * carries both usually got `full` from a company field ("Bob's Plumbing"),
 * while first/last is the person. Blank cells collapse, so a row with only a
 * surname is "Chen", not " Chen".
 */
export function joinContactName(parts: {
  first?: string | null;
  last?: string | null;
  full?: string | null;
}): string | null {
  const clean = (value: string | null | undefined): string =>
    (value ?? "").trim();
  const joined = [clean(parts.first), clean(parts.last)]
    .filter((part) => part !== "")
    .join(" ");
  return joined !== "" ? joined : clean(parts.full) || null;
}
