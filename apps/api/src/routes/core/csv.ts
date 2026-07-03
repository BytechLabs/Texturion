/**
 * Minimal RFC 4180 CSV parser for `POST /v1/contacts/import` (SPEC §7).
 * No dependencies: handles quoted fields, embedded commas/newlines, escaped
 * quotes (""), CRLF/LF line endings, and a UTF-8 BOM. Rows are returned as
 * raw string arrays; header mapping and validation are the route's job.
 */
export function parseCsv(text: string): string[][] {
  const input = text.startsWith("﻿") ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
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
  if (field !== "" || row.length > 0) endRow();

  // Drop rows that are entirely empty (trailing newline, blank lines).
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
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
