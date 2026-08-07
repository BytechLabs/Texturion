/** One parsed row, with the 1-based line it came from in the source file. */
export interface CsvRow {
  /** 1-based line number in the uploaded file, blank lines included. */
  line: number;
  cells: string[];
}

/**
 * #248: a quoted value that is never closed, which is a file we must not parse
 * "as far as it goes".
 *
 * One stray `"` makes every following line part of one enormous value, and the
 * importer's answer was 200 with ordinary counts and NOT ONE error row for the
 * forty contacts it had just eaten. Nobody is texted by that — but a person who
 * is silently missing from a crew's contact list is a person that crew stops
 * texting, for a reason nobody will ever find. A skipped row with a reason is a
 * defect; a swallowed row with no reason is not visible enough to be one.
 *
 * A THROW rather than a flag on the result, so the failure cannot be ignored by
 * a caller that did not think about it. Every caller of this parser is either a
 * route (which turns it into the shared 422) or a test.
 */
export class CsvUnterminatedQuoteError extends Error {
  /** 1-based line the quote opened on — the only part a person can act on. */
  readonly line: number;

  constructor(line: number) {
    super(`CSV: a quoted value opened on line ${line} and is never closed`);
    this.name = "CsvUnterminatedQuoteError";
    this.line = line;
  }
}

/**
 * Minimal RFC 4180 CSV parser for `POST /v1/contacts/import` (SPEC §7).
 * No dependencies: handles quoted fields, embedded commas/newlines, escaped
 * quotes (""), CRLF/LF line endings, and a UTF-8 BOM. Rows are returned as
 * raw string arrays; header mapping and validation are the route's job.
 */
export function parseCsv(text: string): string[][] {
  return parseCsvRows(text).map((row) => row.cells);
}

/**
 * The same parse, keeping each row's TRUE line number.
 *
 * Entirely blank rows are dropped, and numbering the survivors by position
 * shifted every row after one: the importer reported "row 4" for what the
 * person sees as row 5. The wizard joins those numbers back against its own
 * preview to build the skipped-rows file, so each reason was pinned to the
 * wrong original line, showing an empty phone against a name that had one.
 */
export function parseCsvRows(text: string): CsvRow[] {
  const input = text.startsWith("﻿") ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  /** Where the currently-open quote began — the line a person has to go fix. */
  let quoteOpenedOn = 0;
  let i = 0;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  while (i < input.length) {
    const char = input[i];
    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i += 1;
        }
      } else {
        field += char;
        i += 1;
      }
      continue;
    }
    if (char === '"' && field === "") {
      inQuotes = true;
      // Rows completed so far, plus this one. Counted here rather than at the
      // end because by then the position is EOF, which is the one place in the
      // file that looks fine.
      quoteOpenedOn = rows.length + 1;
      i += 1;
    } else if (char === ",") {
      endField();
      i += 1;
    } else if (char === "\n") {
      endRow();
      i += 1;
    } else if (char === "\r") {
      endRow();
      i += input[i + 1] === "\n" ? 2 : 1;
    } else {
      field += char;
      i += 1;
    }
  }
  // BEFORE the last row is flushed: everything from the open quote to EOF is
  // sitting in `field`, and flushing it would produce a plausible-looking row
  // to hand back. There is no honest partial answer here — the rows the quote
  // swallowed are gone, and the parser cannot tell which they were.
  if (inQuotes) throw new CsvUnterminatedQuoteError(quoteOpenedOn);
  if (field !== "" || row.length > 0) endRow();

  // Drop rows that are entirely empty (trailing newline, blank lines), keeping
  // the line each survivor actually came from.
  return rows
    .map((cells, index) => ({ line: index + 1, cells }))
    .filter((row) => row.cells.some((cell) => cell.trim() !== ""));
}

/**
 * Quote one CSV field per RFC 4180: wrap in double quotes and double any
 * embedded quote when the value contains a comma, quote, CR, or LF; otherwise
 * emit it bare. A null/undefined value is the empty string.
 */
export function csvField(value: string | null | undefined): string {
  const text = value ?? "";
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

/**
 * OWASP CSV/formula-injection guard for EXPORT cells that carry free text (a
 * contact name, a tag). When a cell begins with a formula-trigger character a
 * spreadsheet (Excel/Sheets/LibreOffice) would evaluate it as a formula on
 * open — `=cmd|'…'!A1`, `+`/`-`/`@` DDE payloads, etc. Prefixing a single
 * apostrophe forces the engine to treat the whole cell as literal text.
 *
 * Applied ONLY at the export-cell level for free-text columns (name, tags) —
 * NOT inside csvField — so the phone (E.164) column and csvField's lossless RFC
 * quoting stay intact. Includes \t/\r/\n alongside =+-@ because several engines
 * treat a leading whitespace-then-formula the same way. The importer strips one
 * leading guard apostrophe so the export→import round-trip stays lossless
 * (D20 §3.1).
 */
export function csvSafeText(value: string | null | undefined): string {
  const text = value ?? "";
  return /^[=+\-@\t\r\n]/.test(text) ? `'${text}` : text;
}

/**
 * Serialize rows (a header row + data rows, each a string array) into an
 * RFC-4180 CSV string with CRLF line endings. Used by `GET /v1/contacts/export`
 * (D20 §3.1). The caller prepends a UTF-8 BOM for Excel.
 */
export function serializeCsv(rows: (string | null | undefined)[][]): string {
  return rows.map((row) => row.map(csvField).join(",")).join("\r\n");
}
