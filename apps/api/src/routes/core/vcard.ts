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
 *
 * #248 round 3: it also enumerates everything it did NOT read, because the
 * route can only demand a declaration for what the parser told it about. See
 * `properties` below.
 */
import { vcardParameterProperty } from "@loonext/shared";

/** One card's extracted data: a display name and its raw TEL strings. */
export interface ParsedVCard {
  /** Best display name (FN, else assembled from N), or null when absent. */
  name: string | null;
  /** Raw TEL values, de-duplicated within the card, in document order. */
  tels: string[];
  /**
   * #248 round 3: every property this card carried, upper-cased, once each —
   * INCLUDING the ones below that this parser reads, and including each
   * PARAMETER as `<PROPERTY>;<PARAM>` (see `vcardParameterProperty`) and each
   * line that carries no value at all.
   *
   * The vCard door had no gate of any kind: `CATEGORIES:DNC` and a `NOTE`
   * saying they asked us to stop are the only two places the format lets a
   * card say do-not-text, they are what Apple and Google actually export, and
   * both were dropped here without a word while the file's consent attestation
   * was written over the top.
   *
   * Reported by the PARSER rather than guessed at by the route, because the
   * route cannot see what it was never told about — which is the whole shape of
   * the defect. A property nobody has thought of yet is in this list on the day
   * it first appears.
   */
  properties: string[];
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
  /** Parameter names, upper-cased, once each, in document order. */
  params: string[];
  /** Text after the first unquoted colon — null when the line has none. */
  value: string | null;
}

/**
 * #248 round 3: A LINE WITH NO VALUE IS STILL A LINE SOMEBODY WROTE.
 *
 * This used to return null the moment it could not find an unquoted colon, and
 * `properties.add` ran after it — so two shapes were dropped before the gate
 * could ask about them, and a message was delivered through each:
 *
 *   `DO-NOT-CALL` on its own line. Not a content line by the RFC, which is a
 *   statement about the format and not about what the file was trying to say.
 *
 *   `CATEGORIES;TYPE="a:DNC` — an unbalanced quote in a parameter, so the only
 *   colon on the line reads as quoted and there is no value. The property is
 *   CATEGORIES, one of the two places a .vcf can say do-not-text, and it went
 *   unasked because of a typo in a parameter.
 *
 * So the name is parsed whether or not a value follows, and `value: null` says
 * there was nothing to read — only something to declare.
 */
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

  const namePart = colon === -1 ? line : line.slice(0, colon);
  const value = colon === -1 ? null : line.slice(colon + 1);

  // name;PARAM=x;PARAM2=y → the property is the segment before the first ';',
  // and each segment after it is a PARAMETER this parser does not read.
  const segments = namePart.split(";");
  let propName = (segments[0] ?? "").trim();
  // Strip a group prefix ("item1.TEL" / "GROUP.FN" → "TEL" / "FN").
  const dot = propName.lastIndexOf(".");
  if (dot !== -1) propName = propName.slice(dot + 1);
  if (propName === "") return null;

  const params: string[] = [];
  for (const segment of segments.slice(1)) {
    // `TYPE=CELL` → TYPE; a valueless `PREF` is its own name. Everything to the
    // RIGHT of the `=` is the free text nobody read, and it is the reason the
    // parameter has to be declared at all.
    const equals = segment.indexOf("=");
    const param = (equals === -1 ? segment : segment.slice(0, equals))
      .trim()
      .toUpperCase();
    if (param !== "" && !params.includes(param)) params.push(param);
  }

  return { name: propName.toUpperCase(), params, value };
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
  let properties = new Set<string>();

  const flush = () => {
    if (!inCard) return;
    cards.push({ name: fn ?? nName, tels, properties: [...properties] });
    inCard = false;
    fn = null;
    nName = null;
    tels = [];
    properties = new Set<string>();
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
    // #248: recorded BEFORE the three branches below, so a property is in the
    // list whether or not this parser has an opinion about it. Recording it
    // inside the branches would report exactly the properties we already read,
    // which is the one thing that tells the route nothing.
    properties.add(parsed.name);
    // #248 round 3: AND ITS PARAMETERS. `TEL;TYPE=CELL;X-ABLabel=DO NOT
    // CALL:+1613…` is Apple's inline shape — the property is TEL, TEL is
    // mapped, and everything after the first `;` was discarded, so the one
    // sentence on the line saying not to text this person was the one part
    // nobody looked at. The grouped `item1.X-ABLabel:` form was always caught,
    // which is precisely what made this one look covered.
    for (const param of parsed.params) {
      properties.add(vcardParameterProperty(parsed.name, param));
    }
    // Nothing to read, only to declare: the name and its parameters are on the
    // list above, and the branches below all want a value.
    if (parsed.value === null) continue;
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
