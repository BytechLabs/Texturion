import {
  CONTACT_IMPORT_IGNORE,
  VCARD_MAPPED_PROPERTIES,
  vcardParameterProperty,
  type VCardPropertyAction,
  type VCardPropertyDeclaration,
} from "@loonext/shared";

/**
 * #248 round 3 — the same rule at the vCard door, in the shape that format
 * allows.
 *
 * The .vcf door had no gate of any kind. `CATEGORIES:DNC` and a `NOTE` reading
 * "DO NOT CONTACT - asked us to stop" are the only two places the format lets a
 * card say do-not-text, they are what Apple and Google actually export, and the
 * importer dropped both without a word while the file's consent attestation was
 * written over the top.
 *
 * A .vcf has no columns to count, so what is enumerated is the PROPERTIES the
 * cards actually carry. Every one the importer does not read has to be answered
 * for, by somebody who can see what those properties SAY on these cards — which
 * is why this reads the values and not just the names.
 *
 * READ ON THIS SIDE, NOT LEARNED FROM A REFUSAL. The server names the
 * properties it is missing, so the shortest path to a 200 would be: post, read
 * the names out of the 422, post them back. That is two round trips and no
 * human, and it is exactly what round two shipped. The dialog already has the
 * file — it can read it, ask, and post a complete declaration first time.
 *
 * WHICH MAKES THIS A MIRROR OF `apps/api/src/routes/core/vcard.ts`, NOT AN
 * APPROXIMATION OF IT. It used to say it was "deliberately generous" — resolve
 * every ambiguity toward reporting MORE, since a declaration for a property no
 * card carries is ignored server-side while a missing one is refused. That is
 * still true of the refusal, and it is no longer a licence to be vague: the
 * server enumerates three things this parser did not, and each of them was a
 * door with a delivered message behind it —
 *
 *   A LINE WITH NO COLON (`DO-NOT-CALL` on its own). Not a content line by the
 *   RFC, which is a statement about the format rather than about what the file
 *   was trying to say. The whole line is the token.
 *
 *   A MALFORMED PARAMETER (`CATEGORIES;TYPE="a:DNC`), whose unbalanced quote
 *   leaves no unquoted colon. Same drop, different route, and the property is
 *   CATEGORIES: one of the two places a .vcf can say stop.
 *
 *   PARAMETERS, under `<PROPERTY>;<PARAM>` — `TEL;TYPE=CELL;X-ABLabel=DO NOT
 *   CALL:+1613…` is Apple's inline shape. TEL is mapped, so the line was read
 *   for its number and everything after the first `;` was thrown away, which is
 *   where the one sentence saying not to text this person was sitting. Apple's
 *   OTHER shape, the grouped `item1.X-ABLabel:` line, was always caught — which
 *   is exactly what made this one look covered.
 *
 * The cost is real and is accepted upstream (see the shared docblock): an
 * ordinary phone export now asks about `TEL;TYPE`, whose values are HOME and
 * CELL and decide nothing. Auto-answering that one would be a vocabulary, and a
 * vocabulary is the thing two rounds of this issue lost to.
 *
 * A TOKEN THIS SIDE INVENTS IS A 422 NOBODY CAN CLEAR: the server refuses until
 * every property IT found is declared, and a client declaring `TEL;TYPE=CELL`
 * where the server said `TEL;TYPE` has answered a different question. That is
 * why the token is built by the shared {@link vcardParameterProperty} and the
 * name/group/upper-casing rules are copied line for line.
 */

/** Unfold RFC-folded lines: a line starting with SPACE or TAB continues prior. */
function unfold(text: string): string[] {
  const normalized = text.replace(/\r\n?/g, "\n");
  const lines: string[] = [];
  for (const line of normalized.split("\n")) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && lines.length > 0) {
      lines[lines.length - 1] += line.slice(1);
    } else {
      lines.push(line);
    }
  }
  return lines;
}

/** One parameter of a content line: `TYPE=CELL` → name TYPE, value CELL. */
interface ContentParameter {
  /** Upper-cased, as the server reports it. Half of the declared token. */
  name: string;
  /** Everything right of the `=`, unquoted. The free text nobody read. */
  value: string;
}

interface ContentLine {
  /** Upper-cased property name, group prefix dropped. */
  name: string;
  /** Parameters in document order. Not deduplicated: two values of one
   *  parameter are two things the file says, and both are worth showing. */
  params: ContentParameter[];
  /** Text after the first unquoted colon, or null when the line has none. */
  value: string | null;
}

/**
 * Split a content line the way `apps/api/src/routes/core/vcard.ts` does: the
 * value begins after the first colon that is not inside a quoted parameter, the
 * property is the segment before the first `;`, each segment after it is a
 * parameter, a `group.` prefix is dropped, and names are upper-cased.
 *
 * A LINE WITH NO COLON IS STILL A LINE SOMEBODY WROTE. This used to return null
 * the moment it could not find one, which dropped `DO-NOT-CALL` and
 * `CATEGORIES;TYPE="a:DNC` before either could be asked about. `value: null`
 * now says there was nothing to read, only something to declare.
 *
 * Null is returned for one case only, and the server returns it for the same
 * one: a line whose property name is empty. There is no token to declare and
 * nothing a person could answer about it.
 */
function parseContentLine(line: string): ContentLine | null {
  let colon = -1;
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') inQuotes = !inQuotes;
    else if (char === ":" && !inQuotes) {
      colon = i;
      break;
    }
  }

  const namePart = colon === -1 ? line : line.slice(0, colon);
  const value = colon === -1 ? null : line.slice(colon + 1);

  const segments = namePart.split(";");
  let name = (segments[0] ?? "").trim();
  const dot = name.lastIndexOf(".");
  if (dot !== -1) name = name.slice(dot + 1);
  if (name === "") return null;

  const params: ContentParameter[] = [];
  for (const segment of segments.slice(1)) {
    // `TYPE=CELL` → TYPE; a valueless `PREF` is its own name. The server splits
    // on the first `=` and upper-cases the left half, so this does too: a token
    // spelled differently from the server's is a declaration that answers a
    // question nobody asked, and the upload is refused anyway.
    const equals = segment.indexOf("=");
    const paramName = (equals === -1 ? segment : segment.slice(0, equals))
      .trim()
      .toUpperCase();
    if (paramName === "") continue;
    const raw = equals === -1 ? "" : segment.slice(equals + 1).trim();
    params.push({ name: paramName, value: raw.replace(/^"|"$/g, "") });
  }

  return { name: name.toUpperCase(), params, value };
}

/** How many of a property's own values a person is shown. */
export const VCARD_SAMPLE_LIMIT = 3;

/** One property these cards carry that the importer does not read. */
export interface VCardProperty {
  /** Upper-cased property name, as the server's parser reports it. */
  property: string;
  /** Distinct non-blank values on these cards, at most VCARD_SAMPLE_LIMIT. */
  samples: string[];
  /** There are more distinct values than `samples` shows. */
  more: boolean;
  /** How many cards carry it — "3 of 40" is the difference between a
   *  house-keeping property and a decision somebody made about three people. */
  cards: number;
  /** What it means, or null while nobody has said. Never guessed at. */
  answer: VCardPropertyAction | null;
}

export interface VCardFile {
  /** BEGIN:VCARD blocks found — what the import button counts. */
  cards: number;
  /** Unread properties, most-carried first, needing an answer each. */
  properties: VCardProperty[];
}

/**
 * Read a .vcf into the question this dialog has to ask.
 *
 * NOTHING IS PRE-ANSWERED. Unlike the CSV wizard, where a header spelled
 * `Phone` is a guess worth making on somebody's behalf, there is no such thing
 * here: the two answers are "says nothing about who may be texted" and "a card
 * carrying this must not be texted", and this product may not pick either one
 * for a customer. `NOTE` is the property that proves it — house-keeping on most
 * cards, a revocation on the one that matters.
 */
export function readVCardProperties(text: string): VCardFile {
  const lines = unfold(text);
  const mapped = new Set(VCARD_MAPPED_PROPERTIES);
  // Distinct values per property, and the cards each was seen on. Insertion
  // order is document order, which is the order a person reading the file in a
  // text editor would meet them.
  const values = new Map<string, Map<string, string>>();
  const cardsWith = new Map<string, number>();
  let seenOnThisCard = new Set<string>();
  let cards = 0;
  let inCard = false;

  const closeCard = (): void => {
    for (const property of seenOnThisCard) {
      cardsWith.set(property, (cardsWith.get(property) ?? 0) + 1);
    }
    seenOnThisCard = new Set<string>();
    inCard = false;
  };

  /**
   * Record one thing this card carries, under the token it will be DECLARED by.
   *
   * A blank value is recorded as the token with no sample: `NOTE:` with nothing
   * after it, and a whole line like `DO-NOT-CALL` that has no value at all, both
   * still have to be answered for. Dropping the sample rather than the token is
   * the difference between "we could not show you what it says" and "we did not
   * mention it".
   */
  const record = (token: string, value: string | null): void => {
    seenOnThisCard.add(token);
    const seen = values.get(token) ?? new Map<string, string>();
    const text = (value ?? "").trim();
    // Blank values are dropped for the same reason the CSV sampler drops empty
    // cells: printing them would fill the answer's evidence with silence.
    if (text !== "" && !seen.has(text.toLowerCase())) {
      seen.set(text.toLowerCase(), text);
    }
    values.set(token, seen);
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^BEGIN:VCARD$/i.test(trimmed)) {
      // A nested or duplicate BEGIN starts a fresh card, exactly as the
      // server's parser treats it — otherwise the two disagree about how many
      // cards a malformed file holds.
      if (inCard) closeCard();
      inCard = true;
      cards += 1;
      continue;
    }
    if (/^END:VCARD$/i.test(trimmed)) {
      if (inCard) closeCard();
      continue;
    }
    if (!inCard) continue;

    const parsed = parseContentLine(line);
    if (!parsed) continue;
    // The property itself, unless the importer reads it — `TEL` is a number we
    // store, and asking about it would be the gate firing on every file.
    if (!mapped.has(parsed.name)) record(parsed.name, parsed.value);
    // AND EVERY PARAMETER, on a mapped property as much as an unmapped one.
    // That is the whole of the third door: TEL is read, so the line was taken
    // for its number and `X-ABLabel=DO NOT CALL` went past with it. The sample
    // is the PARAMETER's own text, never the line's value — the phone number is
    // not evidence about the label sitting beside it.
    for (const param of parsed.params) {
      record(vcardParameterProperty(parsed.name, param.name), param.value);
    }
  }
  // Tolerate a missing final END:VCARD, as the server's parser does.
  if (inCard) closeCard();

  const properties: VCardProperty[] = [...values.entries()].map(
    ([property, distinct]) => {
      const all = [...distinct.values()];
      return {
        property,
        samples: all.slice(0, VCARD_SAMPLE_LIMIT),
        more: all.length > VCARD_SAMPLE_LIMIT,
        cards: cardsWith.get(property) ?? 0,
        answer: null,
      };
    },
  );
  // RAREST FIRST, and the order flipped with the parameter enumeration above.
  //
  // A property on every card is the file's furniture; one on a single card is
  // somebody having said something about one person, and that is the row this
  // screen exists for. Sorting the furniture to the top was survivable while
  // `ORG` led the list — now every Apple export opens with `TEL;TYPE` on 40 of
  // 40 cards, which would push the `X-ABLABEL` on one card to the bottom of a
  // scroll. The exception belongs where the eye lands.
  //
  // Ties keep document order, so the list is stable between renders.
  properties.sort((a, b) => a.cards - b.cards);
  return { cards, properties };
}

/** Answer one property, and only that one. */
export function answerProperty(
  properties: readonly VCardProperty[],
  property: string,
  answer: VCardPropertyAction | null,
): VCardProperty[] {
  return properties.map((row) =>
    row.property === property ? { ...row, answer } : row,
  );
}

/**
 * Dismiss every property nobody has answered yet.
 *
 * Allowed only because the properties and their values are on screen when it is
 * pressed — the same rule, and the same reason, as the CSV wizard's bulk
 * answer. `ignore` only: a bulk "none of these may be texted" would block every
 * card in the file with one click, which is a thing to do on purpose, one
 * property at a time.
 */
export function ignoreRemainingProperties(
  properties: readonly VCardProperty[],
): VCardProperty[] {
  return properties.map((row) =>
    row.answer === null ? { ...row, answer: CONTACT_IMPORT_IGNORE } : row,
  );
}

/**
 * The complete declaration to post, or null while any property is unanswered.
 *
 * Null rather than a partial list, because a partial list is precisely what the
 * server would refuse — and a client that posts one is a client betting that
 * the refusal will be read by somebody.
 */
export function propertyDeclarations(
  properties: readonly VCardProperty[],
): VCardPropertyDeclaration[] | null {
  const answered: VCardPropertyDeclaration[] = [];
  for (const row of properties) {
    if (row.answer === null) return null;
    answered.push({ property: row.property, action: row.answer });
  }
  return answered;
}
