/**
 * Minimal hand-rolled vCard parser for `POST /v1/contacts/import-vcard`
 * (D20 / APP-FEATURES-V2 §3.2). No dependency — vCard is a simple line format,
 * and the importer only needs `FN`/`N` (name) and `TEL` (phone).
 *
 * Handles vCard 3.0 AND 4.0 (the formats phones / Google / Apple export):
 *   - one or many `BEGIN:VCARD … END:VCARD` blocks per file;
 *   - RFC 6350 / 2426 line folding (a CRLF followed by a space/tab continues
 *     the previous line);
 *   - property parameters (`TEL;TYPE=CELL:…`, `TEL;VALUE=uri:tel:+1…`) — the
 *     part before the first unescaped `:` is name+params, the rest is the value;
 *   - grouped properties (`item1.TEL:…`) by stripping the leading `group.`;
 *   - a `tel:` URI scheme value (4.0) by stripping the scheme;
 *   - escaped `\,` `\;` `\\` `\n` in text values (for FN/N).
 *
 * E.164 normalization and per-row consent/upsert are the ROUTE's job — this
 * parser only extracts raw name + raw TEL strings, one entry per distinct TEL.
 */

/** One card's extracted data: a display name and its raw TEL strings. */
export interface ParsedVCard {
  /** Best display name (FN, else assembled from N), or null when absent. */
  name: string | null;
  /** Raw TEL values, de-duplicated within the card, in document order. */
  tels: string[];
}

/** Unfold RFC-folded lines: a line starting with SPACE or TAB continues prior. */
function unfold(text: string): string[] {
  // Normalize CRLF/CR → LF first so folding detection is uniform.
  const normalized = text.replace(/\r\n?/g, "\n");
  const rawLines = normalized.split("\n");
  const lines: string[] = [];
  for (const line of rawLines) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && lines.length > 0) {
      lines[lines.length - 1] += line.slice(1);
    } else {
      lines.push(line);
    }
  }
  return lines;
}

/**
 * Split a content line into `{ name, params, value }`. The value begins after
 * the first `:` that is not inside a quoted parameter. Parameter and property
 * names are upper-cased; a leading `group.` prefix is dropped.
 */
interface ContentLine {
  name: string;
  value: string;
}

function parseContentLine(line: string): ContentLine | null {
  // Find the first unquoted colon.
  let colon = -1;
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === ":" && !inQuotes) {
      colon = i;
      break;
    }
  }
  if (colon === -1) return null;

  const namePart = line.slice(0, colon);
  const value = line.slice(colon + 1);

  // name;PARAM=x;PARAM2=y → property name is the segment before the first ';'.
  const semi = namePart.indexOf(";");
  let propName = (semi === -1 ? namePart : namePart.slice(0, semi)).trim();
  // Strip a group prefix ("item1.TEL" / "GROUP.FN" → "TEL" / "FN").
  const dot = propName.lastIndexOf(".");
  if (dot !== -1) propName = propName.slice(dot + 1);

  return { name: propName.toUpperCase(), value };
}

/** Unescape RFC text-value escapes for FN/N (\\ \, \; \n). */
function unescapeText(value: string): string {
  return value
    .replace(/\\n/gi, " ")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\")
    .trim();
}

/** Assemble a name from a structured `N` value: Family;Given;… → "Given Family". */
function nameFromN(value: string): string | null {
  const parts = value.split(";").map((part) => unescapeText(part));
  const [family = "", given = "", additional = ""] = parts;
  const assembled = [given, additional, family]
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .join(" ");
  return assembled === "" ? null : assembled;
}

/** Normalize a raw TEL value: strip a `tel:` URI scheme and trim. */
function cleanTel(raw: string): string {
  let value = raw.trim();
  // 4.0 URI form: "tel:+14165550199" (params already stripped as the value
  // is everything after the property colon — but VALUE=uri keeps the scheme).
  if (/^tel:/i.test(value)) value = value.slice(4);
  return value.trim();
}

/**
 * Parse a whole .vcf into per-card extractions. Non-VCARD noise is ignored;
 * a card with no TEL yields `tels: []` (the route reports it as skipped).
 */
export function parseVCards(text: string): ParsedVCard[] {
  const lines = unfold(text);
  const cards: ParsedVCard[] = [];

  let inCard = false;
  let fn: string | null = null;
  let nName: string | null = null;
  let tels: string[] = [];

  const flush = () => {
    if (!inCard) return;
    cards.push({ name: fn ?? nName, tels });
    inCard = false;
    fn = null;
    nName = null;
    tels = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^BEGIN:VCARD$/i.test(trimmed)) {
      // A nested/duplicate BEGIN starts a fresh card (flush any open one).
      flush();
      inCard = true;
      continue;
    }
    if (/^END:VCARD$/i.test(trimmed)) {
      flush();
      continue;
    }
    if (!inCard) continue;

    const parsed = parseContentLine(line);
    if (!parsed) continue;
    if (parsed.name === "FN") {
      const name = unescapeText(parsed.value);
      if (name !== "") fn = name;
    } else if (parsed.name === "N" && nName === null) {
      nName = nameFromN(parsed.value);
    } else if (parsed.name === "TEL") {
      const tel = cleanTel(parsed.value);
      if (tel !== "" && !tels.includes(tel)) tels.push(tel);
    }
  }
  // Tolerate a missing final END:VCARD.
  flush();

  return cards;
}
