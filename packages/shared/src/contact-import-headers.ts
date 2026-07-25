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
 * claimed by phone's broad `number` pattern.
 */
const FIELD_PATTERNS: readonly [ContactImportField, RegExp[]][] = [
  [
    "opted_out",
    [
      /^optedout$/,
      /optout/,
      /unsubscribe/,
      /donottext|donotcontact/,
      /^dnc$/,
      /blocked/,
    ],
  ],
  ["phone", [/^phone$/, /phone/, /mobile/, /^cell/, /^tel/, /number/]],
  [
    "name",
    [
      /^name$/,
      /^fullname$/,
      /^contactname$|^customername$|^clientname$/,
      /^contact$|^customer$|^client$/,
      /name/,
    ],
  ],
  ["address", [/^address$/, /address/, /^addr/, /street/]],
  ["notes", [/^notes?$/, /comment/, /memo/, /description/]],
];

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

  for (const [field, patterns] of FIELD_PATTERNS) {
    outer: for (const pattern of patterns) {
      for (let i = 0; i < normalized.length; i += 1) {
        if (claimed.has(i)) continue;
        if (pattern.test(normalized[i])) {
          mapping[field] = i;
          claimed.add(i);
          break outer;
        }
      }
    }
  }
  return mapping;
}
