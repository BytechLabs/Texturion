import {
  contactImportAllColumnValues,
  contactImportColumnCount,
  CONTACT_IMPORT_COLUMN_SAMPLE_LIMIT,
  CONTACT_IMPORT_IGNORE,
  defaultContactImportColumns,
  isUsCaDestination,
  joinContactName,
  mappingFromDeclarations,
  readContactFlag,
  type ContactImportColumnAction,
  type ContactImportColumnDeclaration,
} from "@loonext/shared";

/**
 * The CSV import wizard's model (G6), rebuilt around #248 round 3's rule:
 * NOTHING IS SILENTLY DROPPED.
 *
 * The old model was the inverse of the file. It held one column index per
 * FIELD — "which column is Phone?" — over a fixed list of seven fields, which
 * meant every column the person did not map was not merely unanswered but
 * absent from the screen entirely. A "Do Not Call" column the detector missed
 * was invisible, dropped, and the file's consent attestation was written over
 * the top; a real text reached somebody that file said not to contact. Two
 * rounds then tried to catch such a column by classifying it — first by the
 * header WORD, then by the SHAPE of its values — and both lost, because both
 * are vocabularies and a vocabulary is never complete.
 *
 * So the model is now the FILE: one entry per column, each carrying its own
 * values, each needing an answer. The detector still runs, but only as the
 * guess a person confirms — `ImportColumn.answer` starts null for every column
 * it did not recognise, and null is what the wizard refuses to move past.
 *
 * The file the wizard posts is the file the person CHOSE, byte for byte. It
 * used to rewrite every header into our canonical spelling before uploading,
 * which is what made the server's gate unable to fire for this door at all —
 * the server only ever saw column names we had invented. Sending the original
 * means the declaration the person gave describes the bytes the server parses,
 * and the two cannot disagree about what column 3 is.
 */

/**
 * Order matters twice: the fields select lists them in this order, and the
 * skipped-rows download emits its columns in it.
 */
export const IMPORT_FIELDS = [
  "phone",
  "name",
  "first_name",
  "last_name",
  "address",
  "notes",
  "opted_out",
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];

/** Column index in the uploaded file for each mapped target field. */
export type ImportMapping = Partial<Record<ImportField, number>>;

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

/**
 * One row of the uploaded file, and the LINE of that file it came from.
 *
 * The line is carried rather than inferred from the row's position, because
 * the API carries it too (`parseCsvRows`) and its skip reasons are keyed by it.
 * The wizard used to number rows `position + 2`, which was only ever right
 * because the wizard rewrote the file before uploading and its rewrite had no
 * blank lines. Now that the person's own file is what goes up, a blank line
 * anywhere in it shifts every reason after it onto the wrong original row — and
 * the skipped-rows download is built by joining those numbers back.
 */
export interface CsvRow {
  line: number;
  cells: string[];
}

/**
 * Parsed CSV lines → the rows the SERVER will see, numbered as it numbers them.
 *
 * A byte-for-byte port of the tail of `parseCsvRows`: a row with nothing but
 * blank cells is dropped, and the survivors keep the 1-based line they came
 * from. Ported rather than approximated because the whole declaration contract
 * rests on both sides agreeing about what this file contains — including how
 * many columns it has, which is the widest row.
 */
export function csvRows(parsed: readonly (readonly string[])[]): CsvRow[] {
  return parsed
    .map((cells, index) => ({ line: index + 1, cells: [...cells] }))
    .filter((row) => row.cells.some((cell) => cell.trim() !== ""));
}

/** What one column may be answered with, or null when nobody has answered. */
export type ColumnAnswer = ContactImportColumnAction | null;

/**
 * How many of a column's own distinct values a person is shown unprompted.
 *
 * The shared figure, so this screen and both phone apps show the same amount.
 * It was 3 here and 5 on the phones, which meant a value at the fourth was on
 * screen for a crew's phone and behind a control on their laptop.
 */
export const SAMPLE_VALUE_LIMIT = CONTACT_IMPORT_COLUMN_SAMPLE_LIMIT;

/**
 * One column of the uploaded file, as the mapping screen asks about it.
 *
 * `samples` is not decoration. The whole design rests on somebody SEEING "DO
 * NOT CALL" before dismissing the column that holds it — a person who cannot
 * see the values cannot dismiss them knowingly, and then the click is theatre.
 */
export interface ImportColumn {
  /** 0-based position in the row. The identity the API declares columns by. */
  index: number;
  /** Header as the file spelled it, trimmed. `""` for a nameless column. */
  header: string;
  /** Distinct non-blank values, in file order, at most SAMPLE_VALUE_LIMIT. */
  samples: string[];
  /**
   * Every distinct value held for this column, for the reader who asks to see
   * them. `samples` is its first few; this is bounded only by the shared ceiling.
   */
  values: string[];
  /** How many distinct values the column really has, counted past the ceiling. */
  total: number;
  /** The field it fills, `ignore`, or null while nobody has said. */
  answer: ColumnAnswer;
}

/**
 * Every column of this file, with the detector's guess and its own values.
 *
 * THE GUESS IS NOT AN ANSWER, and since #248 round 3 the TYPE is what says so:
 * `defaultContactImportColumns` returns a FIELD or null and cannot express a
 * dismissal at all, because `ignore` is not in its union. So there is no
 * conversion left here. It used to answer `ignore` for every column it did not
 * recognise and this function had to undo that on the way past — a correction
 * that works exactly until somebody adds a second caller who does not know to
 * make it, which is how `Phone,Name,Notes` over a Notes column reading "DO NOT
 * CALL - asked us to stop" came back a COMPLETE declaration, was posted with no
 * interaction, and ended in a delivered message.
 *
 * A recognised column keeps its guess: nobody should retype `Phone` → phone on
 * a clean export, and a gate that fires on every file is a gate people learn to
 * click through, which is worse than no gate. An unrecognised one starts null,
 * and null is what blocks the wizard.
 *
 * EITHER WAY IT REACHES THE SCREEN WITH ITS VALUES — see the wizard's column
 * step. A guess is only a guess a person confirmed if they were shown what they
 * were confirming, and the guessed columns are exactly where the shipped defect
 * lived: `notes` was a perfectly ordinary answer to a column whose values said
 * stop.
 *
 * The column COUNT comes from the data, via the shared counter: a cell past the
 * end of the header row is a column with a blank name, and it gets asked about
 * like any other. Hand-edited files do this constantly — somebody appends a
 * note to one row and never touches the header — and every loop in round two
 * was bounded by `headers.length`, so that cell was not misread, it was never
 * looked at.
 */
export function importColumns(
  headers: readonly string[],
  dataRows: readonly CsvRow[],
): ImportColumn[] {
  const cells = dataRows.map((row) => row.cells);
  const guesses = defaultContactImportColumns(headers, cells);
  const count = contactImportColumnCount(headers, cells);
  // Every column's values from ONE pass over the rows. This used to read one
  // value more than it showed, which made "there are others" a fact but left
  // "how many others" unanswerable — and unanswerable is what ", and more" was.
  const held = contactImportAllColumnValues(cells, count);
  const columns: ImportColumn[] = [];
  for (let index = 0; index < count; index += 1) {
    const column = held[index] ?? { values: [], total: 0 };
    columns.push({
      index,
      header: (headers[index] ?? "").trim(),
      samples: column.values.slice(0, SAMPLE_VALUE_LIMIT),
      values: column.values,
      total: column.total,
      // Carried through as it comes. `?? null` covers the column the guesser
      // did not reach at all rather than inventing one for it: both counts come
      // from the same shared function today, and a length that drifted should
      // leave a column unanswered, not dismissed.
      answer: guesses[index]?.action ?? null,
    });
  }
  return columns;
}

/**
 * Answer one column — and ONLY that column.
 *
 * The old field-keyed model could not do this. Pointing a second field at a
 * column that another field already held used to DELETE the other field, so
 * choosing Notes for "Do Not Call" removed the opt-out mapping with nothing on
 * screen moving except the row being edited, and the file imported as though
 * nobody had opted out. There is nothing to delete here: a column has one
 * answer, and two columns claiming one field is a conflict the screen shows and
 * the person resolves — see {@link decideColumns}.
 *
 * Returns a new array; the caller is a `useState` setter.
 */
export function answerColumn(
  columns: readonly ImportColumn[],
  index: number,
  answer: ColumnAnswer,
): ImportColumn[] {
  return columns.map((column) =>
    column.index === index ? { ...column, answer } : column,
  );
}

/**
 * Answer every column nobody has answered yet, in one act.
 *
 * Allowed ONLY because the list of those columns and their values is on screen
 * when the button is pressed — that is what makes it an informed click, which
 * is the entire justification for the design. A bulk dismissal offered anywhere
 * else, or above the values, would be the silent drop with an extra step.
 */
export function answerRemaining(
  columns: readonly ImportColumn[],
  answer: ContactImportColumnAction,
): ImportColumn[] {
  return columns.map((column) =>
    column.answer === null ? { ...column, answer } : column,
  );
}

/** Two or more columns answered with the same field. A contact has one. */
export interface ColumnConflict {
  field: ImportField;
  columns: ImportColumn[];
}

export interface ColumnDecision {
  /** The complete declaration to post, or null when it is not complete. */
  declarations: ContactImportColumnDeclaration[] | null;
  /** The mapping the answers describe — what the preview must run on. */
  mapping: ImportMapping;
  /** Columns nobody has answered. The wizard will not move while any remain. */
  unanswered: ImportColumn[];
  /** Fields claimed twice. The API refuses these, so the screen must too. */
  conflicts: ColumnConflict[];
}

/**
 * What the answers add up to: the mapping to preview, and whether they may be
 * posted at all.
 *
 * The mapping comes from the shared `mappingFromDeclarations`, the same
 * function the API builds ITS mapping with, so the preview cannot promise one
 * thing and the import do another. It is computed even while columns are
 * unanswered, because the alert about an unreadable opt-out column should
 * appear the moment somebody points at that column rather than at the end.
 *
 * A CONFLICT IS SHOWN, NEVER RESOLVED FOR THEM. Two columns answered `phone` is
 * a question only the person can settle, and the losing half of any automatic
 * answer is a field silently emptied — the exact defect this model exists to
 * make impossible. The API refuses the pair by name for the same reason.
 */
export function decideColumns(
  columns: readonly ImportColumn[],
): ColumnDecision {
  const unanswered = columns.filter((column) => column.answer === null);
  const byField = new Map<ImportField, ImportColumn[]>();
  for (const column of columns) {
    if (column.answer === null || column.answer === CONTACT_IMPORT_IGNORE) {
      continue;
    }
    const field = column.answer as ImportField;
    byField.set(field, [...(byField.get(field) ?? []), column]);
  }
  const conflicts: ColumnConflict[] = [];
  for (const [field, claimants] of byField) {
    if (claimants.length > 1) conflicts.push({ field, columns: claimants });
  }
  const answered: ContactImportColumnDeclaration[] = columns
    .filter((column) => column.answer !== null)
    .map((column) => ({
      index: column.index,
      action: column.answer as ContactImportColumnAction,
      header: column.header,
    }));
  const mapping = mappingFromDeclarations(answered) as ImportMapping;
  return {
    declarations:
      unanswered.length === 0 && conflicts.length === 0 ? answered : null,
    mapping,
    unanswered,
    conflicts,
  };
}

export type PreviewStatus = "ready" | "invalid_phone" | "duplicate";

export interface PreviewRow {
  /**
   * The row's line number in the file the API receives — the SAME number its
   * error list reports, because both come from the file's own lines.
   */
  rowNumber: number;
  /** Mapped raw cell values ("" for unmapped fields). */
  values: Record<ImportField, string>;
  /**
   * The single name this row will actually store, joined from whichever of the
   * three name columns the file carried.
   *
   * Held beside the raw cells rather than replacing them, because the two are
   * used for different things: this is what the preview promises and what the
   * server writes, while `values` keeps the original cells so the skipped-rows
   * download hands back the file the person uploaded, not our version of it.
   */
  resolvedName: string | null;
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
 * skipped, and the `opted_out` cell read by the API's own reader.
 *
 * The flag is read with the SHARED `readContactFlag`, not a local truthy set.
 * This file carried its own copy under a comment calling it a mirror, and by
 * #248 round 2 it had stopped being one: the server learned to read `x` — how a
 * hand-kept sheet marks the blocked rows — and this preview still called it
 * nothing, so a file of x's promised "Imports" on every row and imported them
 * blocked. A preview is a promise about what the server will do; the only way
 * to keep it is to ask the server's function.
 */
export function buildPreview(
  dataRows: readonly CsvRow[],
  mapping: ImportMapping,
): PreviewRow[] {
  // The kept row per phone, not merely the set of phones seen: a later
  // duplicate can still carry a restriction that belongs to the row we keep.
  const kept = new Map<string, PreviewRow>();
  return dataRows.map(({ line, cells }) => {
    const values = Object.fromEntries(
      IMPORT_FIELDS.map((field) => [field, mappedCell(cells, mapping, field)]),
    ) as Record<ImportField, string>;
    const optedOut =
      mapping.opted_out !== undefined &&
      readContactFlag(values.opted_out) === true;
    // joinContactName is the API's own function (@loonext/shared), not a
    // re-implementation of it. A preview that promised a different name from
    // the one that landed would be its own kind of broken, and this is exactly
    // the pair that drifts: the server prefers first+last over a `full` column,
    // which is not the answer anyone would guess.
    const resolvedName = joinContactName({
      first: values.first_name,
      last: values.last_name,
      full: values.name,
    });

    const phone = normalizeNanpPhone(values.phone);
    if (phone === null) {
      return {
        rowNumber: line,
        values,
        resolvedName,
        phoneE164: null,
        optedOut,
        status: "invalid_phone" as const,
        reason: `invalid phone: ${values.phone === "" ? "(empty)" : values.phone}`,
      };
    }
    const first = kept.get(phone);
    if (first) {
      // D2, the API's rule, and the preview did not have it: the extra ROW is
      // discarded, but the RESTRICTION it carried is not the row's — it is the
      // person's, and it is true of them whichever row happened to hold it. A
      // merge of two exports lists the same person twice, once plain and once
      // flagged, and this screen used to show the kept row as a clean "Imports"
      // while the server blocked them. Never the reverse: a later plain row
      // cannot clear a flag an earlier one set.
      if (optedOut) first.optedOut = true;
      return {
        rowNumber: line,
        values,
        resolvedName,
        phoneE164: phone,
        optedOut,
        status: "duplicate" as const,
        reason: `duplicate phone in file: ${phone}`,
      };
    }
    const readyRow: PreviewRow = {
      rowNumber: line,
      values,
      resolvedName,
      phoneE164: phone,
      optedOut,
      status: "ready" as const,
      reason: null,
    };
    kept.set(phone, readyRow);
    return readyRow;
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

/**
 * The downloadable skipped-rows CSV for the import summary: the original
 * mapped values of every row the API skipped, plus the reason.
 */
export function skippedRowsCsv(
  errors: readonly { row: number; reason: string }[],
  preview: readonly PreviewRow[],
): string {
  const byNumber = new Map(preview.map((row) => [row.rowNumber, row]));
  const lines = [[...IMPORT_FIELDS, "reason"].map(csvEscape).join(",")];
  for (const error of errors) {
    const row = byNumber.get(error.row);
    lines.push(
      [
        ...IMPORT_FIELDS.map((field) => row?.values[field] ?? ""),
        error.reason,
      ]
        .map(csvEscape)
        .join(","),
    );
  }
  return lines.join("\r\n");
}
