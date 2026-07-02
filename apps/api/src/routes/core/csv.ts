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
