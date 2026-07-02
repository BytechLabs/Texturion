import { isUsCaDestination } from "@jobtext/shared";

/**
 * CSV import wizard logic (G6): column-mapping auto-detect, client-side
 * dry-run preview, and CSV (re)serialization. The wizard maps the user's
 * columns onto the API's canonical header (`phone,name,address,notes,
 * opted_out` — apps/api/src/routes/contacts.ts) and sends EVERY row: the
 * preview predicts row outcomes with the same rules the API applies, but the
 * server response stays authoritative for the final summary.
 */

export const IMPORT_FIELDS = [
  "phone",
  "name",
  "address",
  "notes",
  "opted_out",
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];

/** Column index in the uploaded file for each mapped target field. */
export type ImportMapping = Partial<Record<ImportField, number>>;

/** Mirror of the API's row limit (SPEC §7 import bounds). */
export const IMPORT_MAX_ROWS = 2000;
/** Mirror of the API's file-size limit (2 MB). */
export const IMPORT_MAX_BYTES = 2 * 1024 * 1024;

/** Mirror of the API's truthy set for the `opted_out` column. */
const TRUTHY_CSV = new Set(["true", "1", "yes", "y"]);

export function isTruthyCsv(value: string): boolean {
  return TRUTHY_CSV.has(value.trim().toLowerCase());
}

/**
 * Mirror of the API's `normalizeNanpPhone` (apps/api/src/routes/core/phone.ts):
 * free-form North American input → strict `+1NXXNXXXXXX` validated against
 * the shared NANP table; null when it is not a real US/CA number.
 */
export function normalizeNanpPhone(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed === "") return null;
  if (trimmed.startsWith("+") && !trimmed.startsWith("+1")) return null;

  const digits = trimmed.replace(/\D/g, "");
  let national: string;
  if (digits.length === 10) {
    national = digits;
  } else if (digits.length === 11 && digits.startsWith("1")) {
    national = digits.slice(1);
  } else {
    return null;
  }

  const e164 = `+1${national}`;
  return isUsCaDestination(e164) ? e164 : null;
}

/** Lowercase and strip everything but letters/digits: "Phone Number" → "phonenumber". */
function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Header patterns per target field, most specific first. Detection order
 * matters: `opted_out` is matched before `phone` so a "do not text" column is
 * never claimed by phone's broad `number` pattern.
 */
const FIELD_PATTERNS: readonly [ImportField, RegExp[]][] = [
  [
    "opted_out",
    [/^optedout$/, /optout/, /unsubscribe/, /donottext|donotcontact/, /^dnc$/, /blocked/],
  ],
  [
    "phone",
    [/^phone$/, /phone/, /mobile/, /^cell/, /^tel/, /number/],
  ],
  [
    "name",
    [/^name$/, /^fullname$/, /^contactname$|^customername$|^clientname$/, /^contact$|^customer$|^client$/, /name/],
  ],
  ["address", [/^address$/, /address/, /^addr/, /street/]],
  ["notes", [/^notes?$/, /comment/, /memo/, /description/]],
];

/**
 * Auto-detect a column mapping from the header row. Each column is claimed by
 * at most one field; per field the most specific pattern wins, scanning
 * columns left to right.
 */
export function autoDetectMapping(headers: readonly string[]): ImportMapping {
  const normalized = headers.map(normalizeHeader);
  const claimed = new Set<number>();
  const mapping: ImportMapping = {};

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

export type PreviewStatus = "ready" | "invalid_phone" | "duplicate";

export interface PreviewRow {
  /**
   * The row's line number in the file the API receives (1-based, +1 for the
   * header) — aligns with the `row` field in the API's error list.
   */
  rowNumber: number;
  /** Mapped raw cell values ("" for unmapped fields). */
  values: Record<ImportField, string>;
  /** Normalized E.164, or null when the phone is invalid. */
  phoneE164: string | null;
  /** The row marks this number opted out (API truthy rule). */
  optedOut: boolean;
  status: PreviewStatus;
  /** Skip reason, mirroring the API's wording; null when ready. */
  reason: string | null;
}

function mappedCell(
  row: readonly string[],
  mapping: ImportMapping,
  field: ImportField,
): string {
  const index = mapping[field];
  if (index === undefined) return "";
  return (row[index] ?? "").trim();
}

/**
 * Client-side dry run applying the API's exact row rules: phone normalized
 * against the NANP table, later duplicates of the same normalized phone
 * skipped, `opted_out` truthiness per the API's set.
 */
export function buildPreview(
  dataRows: readonly (readonly string[])[],
  mapping: ImportMapping,
): PreviewRow[] {
  const seen = new Set<string>();
  return dataRows.map((row, index) => {
    const rowNumber = index + 2; // 1-based data rows, +1 for the header row
    const values = {
      phone: mappedCell(row, mapping, "phone"),
      name: mappedCell(row, mapping, "name"),
      address: mappedCell(row, mapping, "address"),
      notes: mappedCell(row, mapping, "notes"),
      opted_out: mappedCell(row, mapping, "opted_out"),
    };
    const optedOut =
      mapping.opted_out !== undefined && isTruthyCsv(values.opted_out);

    const phone = normalizeNanpPhone(values.phone);
    if (phone === null) {
      return {
        rowNumber,
        values,
        phoneE164: null,
        optedOut,
        status: "invalid_phone" as const,
        reason: `invalid phone: ${values.phone === "" ? "(empty)" : values.phone}`,
      };
    }
    if (seen.has(phone)) {
      return {
        rowNumber,
        values,
        phoneE164: phone,
        optedOut,
        status: "duplicate" as const,
        reason: `duplicate phone in file: ${phone}`,
      };
    }
    seen.add(phone);
    return {
      rowNumber,
      values,
      phoneE164: phone,
      optedOut,
      status: "ready" as const,
      reason: null,
    };
  });
}

export interface PreviewSummary {
  ready: number;
  skipped: number;
  /** Ready rows that will be blocked from texting on import. */
  optedOut: number;
}

export function summarizePreview(rows: readonly PreviewRow[]): PreviewSummary {
  let ready = 0;
  let skipped = 0;
  let optedOut = 0;
  for (const row of rows) {
    if (row.status === "ready") {
      ready += 1;
      if (row.optedOut) optedOut += 1;
    } else {
      skipped += 1;
    }
  }
  return { ready, skipped, optedOut };
}

/** RFC 4180 escaping: quote cells containing commas, quotes, or newlines. */
export function csvEscape(cell: string): string {
  if (/[",\r\n]/.test(cell)) {
    return `"${cell.replace(/"/g, '""')}"`;
  }
  return cell;
}

function csvLine(cells: readonly string[]): string {
  return cells.map(csvEscape).join(",");
}

/**
 * Serialize the mapped rows into the canonical CSV the API expects. Only
 * mapped columns are included (an absent column never nulls existing contact
 * data server-side). ALL rows are sent — the preview predicts skips, but the
 * API's `{ imported, updated, skipped, errors }` is the truth, and its error
 * row numbers line up with `PreviewRow.rowNumber`.
 */
export function buildImportCsv(
  dataRows: readonly (readonly string[])[],
  mapping: ImportMapping,
): string {
  const fields = IMPORT_FIELDS.filter((field) => mapping[field] !== undefined);
  const lines = [csvLine(fields)];
  for (const row of dataRows) {
    lines.push(csvLine(fields.map((field) => mappedCell(row, mapping, field))));
  }
  return lines.join("\r\n");
}

/**
 * The downloadable skipped-rows CSV for the import summary: the original
 * mapped values of every row the API skipped, plus the reason.
 */
export function skippedRowsCsv(
  errors: readonly { row: number; reason: string }[],
  preview: readonly PreviewRow[],
): string {
  const byNumber = new Map(preview.map((row) => [row.rowNumber, row]));
  const lines = [csvLine([...IMPORT_FIELDS, "reason"])];
  for (const error of errors) {
    const row = byNumber.get(error.row);
    lines.push(
      csvLine([
        ...IMPORT_FIELDS.map((field) => row?.values[field] ?? ""),
        error.reason,
      ]),
    );
  }
  return lines.join("\r\n");
}
