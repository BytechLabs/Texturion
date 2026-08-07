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

/**
 * #528: a structurally malformed .vcf, refused rather than half-read.
 *
 * A THROW rather than a flag, and for the same reason
 * `CsvUnterminatedQuoteError` is one: the failure cannot be ignored by a caller
 * that did not think about it, and both callers of this parser are either a
 * route (which turns it into the shared 422) or a test.
 *
 * REFUSING IS THE SAFE DIRECTION HERE, which is worth stating because leniency
 * usually is. Both shapes below end with a contact being created from something
 * nobody read — one silently attaches a stranger's number to somebody else's
 * name, the other hides a line that may be the only place the file says not to
 * text this person. A rejected file is a person retrying an import; a merged
 * card is a message sent to the wrong human.
 */
export class VCardMalformedError extends Error {
  /** 1-based line in the FILE the operator can go and look at. */
  readonly line: number;
  readonly kind: "merged-card" | "nameless-property";

  constructor(kind: "merged-card" | "nameless-property", line: number) {
    super(`vCard: ${kind} at line ${line}`);
    this.name = "VCardMalformedError";
    this.kind = kind;
    this.line = line;
  }
}

/** One logical content line, and the file line it started on. */
interface LogicalLine {
  text: string;
  /** 1-based, for a message somebody can act on. */
  line: number;
}

/**
 * Unfold RFC-folded lines: a line starting with SPACE or TAB continues prior.
 *
 * #528: the line NUMBER travels with the text now. Unfolding collapses several
 * file lines into one logical line, so an index into the result is not a place
 * in the file — and a refusal that cannot say where to look is a refusal
 * somebody has to bisect a phone book to act on.
 */
function unfold(text: string): LogicalLine[] {
  // Normalize CRLF/CR → LF first so folding detection is uniform.
  const normalized = text.replace(/\r\n?/g, "\n");
  const rawLines = normalized.split("\n");
  const lines: LogicalLine[] = [];
  rawLines.forEach((line, index) => {
    if ((line.startsWith(" ") || line.startsWith("\t")) && lines.length > 0) {
      // #528: A LEADING SPACE BEFORE A DELIMITER MERGES TWO PEOPLE.
      //
      // The fold rule itself is correct — RFC 6350 says a line beginning with
      // whitespace continues the previous one — and that is exactly what makes
      // this dangerous. ` BEGIN:VCARD` after a card's `END:VCARD` joins to it as
      // `END:VCARDBEGIN:VCARD`, which matches neither delimiter, so the first
      // card never closes and swallows the second card's lines. One person
      // silently becomes another: their name, with somebody else's phone number.
      //
      // Detected HERE, on the continuation itself, rather than by looking for a
      // delimiter inside a joined line. That looser test would refuse a file
      // whose NOTE happens to quote the word BEGIN:VCARD — a legitimate import,
      // rejected for a substring. This one fires only on the shape that is
      // actually a swallowed delimiter.
      if (/^(BEGIN|END):VCARD$/i.test(line.trim())) {
        throw new VCardMalformedError("merged-card", index + 1);
      }
      lines[lines.length - 1].text += line.slice(1);
    } else {
      lines.push({ text: line, line: index + 1 });
    }
  });
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

  for (const logical of lines) {
    const line = logical.text;
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
    if (!parsed) {
      // #528: A LINE WITH NO PROPERTY NAME CANNOT BE DECLARED, SO IT IS REFUSED.
      //
      // `parseContentLine` returns null for exactly one reason — the property
      // name is empty (`:DO NOT CALL`, `;TYPE=DNC:do not call`) — and this used
      // to `continue`, which dropped the line before `properties.add` below could
      // enumerate it. Neither the property nor its parameters reached the gate,
      // so a file could say do-not-text on a line nobody was ever asked about.
      //
      // Round 3 settled the principle one concern up: a line with no VALUE is
      // still a line somebody wrote. A line with no NAME equally is — but it
      // cannot be answered the way that one can, because a declaration is keyed
      // on a property name and this line has none to ask about. Enumerating it
      // under an empty name would put an unanswerable question in the 422.
      //
      // So the file is refused. That is the same answer as the merged card
      // above, which makes one rule instead of two special cases: a .vcf whose
      // structure we cannot read is not partially imported.
      throw new VCardMalformedError("nameless-property", logical.line);
    }
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
