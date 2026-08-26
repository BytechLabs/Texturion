/**
 * The contract every contact importer has to satisfy — one copy, four surfaces.
 *
 * #248: a crew arriving from another tool meets the importer on their first
 * day, and it is the one path where a customer hands us unbounded input. Both
 * halves of that had already drifted:
 *
 *   The BOUNDS were written down three times (the API's own constants, a
 *   commented "mirror of the API's row limit" in the web wizard, and nothing at
 *   all on the phones), so a client could promise a file would import and the
 *   server refuse it.
 *
 *   The ATTESTATION field name was written down once, on the server. #226
 *   (edfa044) made `consent_attested` mandatory on CSV import and no client
 *   ever sent it, so every import on every client 422'd against a field name
 *   the UI had no control for. A form field the server demands and no shared
 *   contract names is a field the clients cannot be expected to send.
 *
 * These are the values a client may print and must post. The server stays the
 * authority — it re-checks all of them — but there is now only one place to
 * change any of them.
 */
import {
  contactImportColumnCount,
  detectContactColumns,
  type ContactImportField,
  type ContactImportMapping,
} from "./contact-import-headers";

/**
 * The multipart field carrying the importer's consent attestation. Only the
 * literal string `"true"` counts (#226): a checkbox that also accepts "false"
 * is not an attestation, it is a field.
 */
export const CONTACT_IMPORT_CONSENT_FIELD = "consent_attested";

/** The one value {@link CONTACT_IMPORT_CONSENT_FIELD} may carry to pass. */
export const CONTACT_IMPORT_CONSENT_VALUE = "true";

/**
 * What the server says when the attestation is missing. Shared so the clients
 * and the tests quote the shipped sentence rather than a paraphrase of it.
 */
export const CONTACT_IMPORT_CONSENT_REQUIRED =
  "consent_attested: confirm that everyone in this file agreed to be texted " +
  "by this business before importing them.";

/**
 * What the importer says about the rows its attestation could NOT be applied to.
 *
 * The file's attestation is one claim about everybody in it, and it can be
 * wrong about a particular person in exactly one way that matters: that person
 * has already told this business to stop. The carrier record is the truth there
 * — a competitor export has no column for it, and even a file that does have one
 * is a snapshot of what some other tool believed on the day it was written.
 *
 * So those rows are imported and their attestation is refused, which leaves the
 * uploader believing the file did what it said unless we say otherwise. A silent
 * refusal is its own defect: the whole reason the attestation exists is so a
 * workspace can point at a record months later, and a record with a hole in it
 * that nobody was told about is worse than no record.
 */
export const CONTACT_IMPORT_CONSENT_REFUSED_NOTE =
  "Some of these customers have already asked this business to stop texting " +
  "them. They were imported and their opt-out still stands — your consent " +
  "statement was not recorded against them.";

/**
 * Specific, localizable API refusals emitted by the contact importer.
 *
 * The legacy English `message` remains in the envelope for older builds and
 * diagnostics. Current clients prefer one of these keys, which preserves the
 * actionable detail for a French reader instead of reducing every validation
 * failure to the generic per-code sentence.
 */
export const CONTACT_IMPORT_ERROR_MESSAGE_KEYS = [
  "apiErrors.contactImportUndeclaredColumnsOne",
  "apiErrors.contactImportUndeclaredColumnsMany",
  "apiErrors.contactImportUndeclaredPropertiesOne",
  "apiErrors.contactImportUndeclaredPropertiesMany",
  "apiErrors.contactImportUndeclaredPropertiesCapped",
  "apiErrors.contactImportUnreadableFlag",
  "apiErrors.contactImportUnreadableFlagCapped",
] as const;

export type ContactImportErrorMessageKey =
  (typeof CONTACT_IMPORT_ERROR_MESSAGE_KEYS)[number];

export interface ContactImportErrorReference {
  key: ContactImportErrorMessageKey;
  vars: Record<string, string>;
}

/**
 * The per-row reason, in the same `<what happened>: <phone>` shape as the
 * importer's other row reasons, so a client can render it with the one list it
 * already has.
 *
 * A function rather than a constant because the phone is the useful half: the
 * workspace's next question is always "which of them?".
 */
export function contactImportConsentRefusedReason(phoneE164: string): string {
  return `already opted out, consent not recorded: ${phoneE164}`;
}

/**
 * #248 ROUND 3 — THERE IS NO CLASSIFIER, AND THIS IS WHAT REPLACED IT.
 *
 * Two rounds tried to answer "does this dropped column mean do-not-contact".
 * Round one asked it of WORDS — `optout`, `unsubscribe`, `^dnc$` — and a file
 * headed "Do Not Call" imported attested and a text reached somebody who had
 * said stop. Round two asked it of SHAPE — few distinct values, short values,
 * repeated across rows — which is a vocabulary of numbers, and it lost the same
 * way: four distinct answers walked through, a value of 25 characters walked
 * through, the same answer on all sixty rows walked through, a four-row file
 * walked through, and a cell past the end of the header row was never looked at
 * at all. Each of those ended in a delivered message.
 *
 * The question has no reliable answer. So it is not asked.
 *
 * NOTHING IS EVER SILENTLY DROPPED. Every column of the uploaded file is either
 * MAPPED to a contact field or EXPLICITLY DISMISSED by somebody who could see
 * its values. There is no vocabulary and no threshold here, so there is nothing
 * left to be incomplete.
 *
 * WHAT THIS DOES NOT GUARANTEE, written out because a comment claiming a
 * guarantee the code does not enforce is worse than no comment at all — and
 * because the sentence that used to sit here ("no answer is supplied by us on
 * the caller's behalf") was one, twice over. Two things this does not close:
 *
 *   A DECLARATION IS A CLAIM, NOT EVIDENCE. A scripted caller can declare every
 *   column `ignore` without a human ever seeing a value, and this server cannot
 *   tell that apart from a person who looked. Nothing can. It is a claim like
 *   the consent attestation beside it, and it is recorded on the audit row for
 *   the same reason.
 *
 *   THE REFUSAL NAMES THE COLUMNS, so it hands a script the strings it would
 *   need to echo `ignore` back and try again. That loop is CONCEDED rather than
 *   defended against: the caller already holds the file and its header row, so
 *   naming them tells a script nothing it could not read for itself, while NOT
 *   naming them makes the refusal unactionable for the person it is written
 *   for. A naive all-`ignore` echo does now fail — it drops the phone column
 *   too, and an import with no phone column is refused — but that is a SIDE
 *   EFFECT of the contract, not a defence, and nothing here tests it as one.
 *
 * WHAT IS CLOSED is the SILENT case, and every real accident was in it: no
 * column reaches the importer unanswered, and neither this module nor the
 * server manufactures an answer. `defaultContactImportColumns` guesses a FIELD
 * or nothing — it cannot express a dismissal — so the only `ignore` that ever
 * reaches the server is one a caller sent.
 */
export const CONTACT_IMPORT_COLUMN_FIELD = "column";

/** The declaration for a column that says nothing about who may be texted. */
export const CONTACT_IMPORT_IGNORE = "ignore";

/**
 * What a caller may say about one column: which contact field it is, or that it
 * is not one.
 */
export type ContactImportColumnAction = ContactImportField | "ignore";

/** One column's answer: where it is, what it is, and what the file called it. */
export interface ContactImportColumnDeclaration {
  /** 0-based position in the row. THE identity — see the wire format below. */
  index: number;
  /** The field it fills, or `ignore`. */
  action: ContactImportColumnAction;
  /** The header exactly as the file spelled it, `""` for a nameless column. */
  header: string;
}

/** Every action a declaration may carry, for validating one off the wire. */
const COLUMN_ACTIONS = new Set<string>([
  CONTACT_IMPORT_IGNORE,
  "phone",
  "name",
  "first_name",
  "last_name",
  "address",
  "notes",
  "opted_out",
]);

/**
 * The wire form of one declaration: `<index>:<action>:<header>`.
 *
 * INDEX FIRST, AND INDEX IS THE IDENTITY. Round two matched its field on
 * `normalizeContactHeader`, which strips everything but `[a-z0-9]` — so every
 * header with no ASCII alphanumerics ("", "—", "#", "★") normalised to the SAME
 * EMPTY STRING and two of them could not be told apart. A position cannot
 * collide with another position.
 *
 * THE HEADER IS STILL CARRIED, and it is checked. It is what catches a caller
 * whose declaration describes a different file from the one it attached —
 * yesterday's export, or the wrong branch of an integration. Last in the string
 * because a header may contain anything at all, colons included; the two splits
 * before it are on fixed, safe tokens.
 */
export function formatContactImportColumn(
  declaration: ContactImportColumnDeclaration,
): string {
  return `${declaration.index}:${declaration.action}:${declaration.header}`;
}

/** Read one declaration off the wire, or null when it is not one. */
export function parseContactImportColumn(
  raw: string,
): ContactImportColumnDeclaration | null {
  const firstColon = raw.indexOf(":");
  if (firstColon === -1) return null;
  const secondColon = raw.indexOf(":", firstColon + 1);
  if (secondColon === -1) return null;
  const rawIndex = raw.slice(0, firstColon);
  // Digits only, and no leading `+`/whitespace/`0x`: `Number("")` is 0 and
  // `Number(" 1 ")` is 1, so a lenient parse would read a malformed field as
  // a confident answer about column zero.
  if (!/^\d+$/.test(rawIndex)) return null;
  const action = raw.slice(firstColon + 1, secondColon);
  if (!COLUMN_ACTIONS.has(action)) return null;
  return {
    index: Number(rawIndex),
    action: action as ContactImportColumnAction,
    header: raw.slice(secondColon + 1),
  };
}

/**
 * One column as the DEFAULT sees it, which is a guess and never an answer.
 *
 * `action` is a FIELD or null, and `ignore` is deliberately not in the union.
 * That is the type doing the arguing: a dismissal is an ANSWER — it says "I
 * looked at these values and they decide nothing" — and a detector has not
 * looked at a single value. A function that can only say "phone" or "I have
 * nothing" cannot manufacture one.
 */
export interface ContactImportColumnGuess {
  /** 0-based position in the row, matching the declaration's identity. */
  index: number;
  /** The header exactly as the file spelled it, `""` for a nameless column. */
  header: string;
  /** The field the detector recognised, or null — nobody has answered yet. */
  action: ContactImportField | null;
}

/**
 * The DEFAULT GUESS a client shows the person before they answer.
 *
 * `detectContactColumns` for the columns it recognises AND NOTHING FOR THE
 * REST, over the column count the DATA implies rather than the header row's
 * length. One entry per column either way, because the caller renders them by
 * position and a column missing from this list is a column missing from the
 * screen.
 *
 * IT USED TO ANSWER `ignore` FOR EVERY COLUMN IT DID NOT RECOGNISE, which was
 * the silent drop with extra steps: `Phone,Name,Notes` with a Notes column
 * reading "DO NOT CALL - asked us to stop" came back from here as a COMPLETE
 * declaration, every client posted it without asking anybody, the API accepted
 * it because it was complete, and the send went out. A function that
 * manufactures a complete declaration is a classifier wearing a different hat —
 * this one may guess a mapping, and may not dismiss anything.
 *
 * A starting position and never a gate: the API demands the declaration whether
 * or not it would have guessed the same thing, and no test may treat this
 * function's answer as permission.
 *
 * IT DOES NOT MAKE OUR OWN EXPORT IMPORT ITSELF, and it used to look as though
 * it did. `EXPORT_HEADER` carries `tags` and the three consent columns, which
 * are not contact fields, so they come back from here unanswered and a person
 * re-importing our export dismisses them like anybody else's columns. D20
 * §3.1's round trip is proved by running it (see the api route's export tests),
 * not by this function's answer — an export edited in a spreadsheet before
 * being re-imported is the normal way this feature is used, and "we wrote it"
 * is not evidence that nobody has since written "do not call" in it.
 */
export function defaultContactImportColumns(
  headers: readonly string[],
  dataRows: readonly (readonly string[])[] = [],
): ContactImportColumnGuess[] {
  const mapping = detectContactColumns(headers.map((header) => header.trim()));
  const byIndex = new Map<number, ContactImportField>();
  for (const [field, index] of Object.entries(mapping)) {
    if (index !== undefined) byIndex.set(index, field as ContactImportField);
  }
  const count = contactImportColumnCount(headers, dataRows);
  const guesses: ContactImportColumnGuess[] = [];
  for (let index = 0; index < count; index += 1) {
    guesses.push({
      index,
      action: byIndex.get(index) ?? null,
      header: (headers[index] ?? "").trim(),
    });
  }
  return guesses;
}

/** How one column is named in a refusal: its position, then what it was called. */
function namedColumn(column: { index: number; header: string }): string {
  const header = column.header.trim();
  return header === ""
    ? `column ${column.index + 1} (no header)`
    : `column ${column.index + 1} ("${header}")`;
}

/** A language-neutral column label for interpolation into catalogue copy. */
function referencedColumn(column: { index: number; header: string }): string {
  const header = column.header.trim();
  return header === ""
    ? `#${column.index + 1}`
    : `#${column.index + 1} (\u201c${header}\u201d)`;
}

/**
 * What the server says when the declaration does not cover the whole file.
 *
 * Names the columns, because "some column" is not something a person can act
 * on. Naming them does hand a script the strings it would need to reply
 * `ignore` — see the docblock on {@link CONTACT_IMPORT_COLUMN_FIELD} for why
 * that is conceded rather than defended against: it already has the file.
 */
export function contactImportUndeclaredColumnsMessage(
  undeclared: readonly { index: number; header: string }[],
  totalColumns: number,
): string {
  const one = undeclared.length === 1;
  return (
    `file: ${undeclared.map(namedColumn).join(", ")} ` +
    `${one ? "was" : "were"} not declared. This import does not guess what a ` +
    "column means — a do-not-contact column read as nothing texts somebody who " +
    "asked this business to stop — so every one of the " +
    `${totalColumns} column${totalColumns === 1 ? "" : "s"} in this file has to ` +
    "be either mapped to a contact field or explicitly ignored by somebody who " +
    `can see its values. Send one \`${CONTACT_IMPORT_COLUMN_FIELD}\` field per ` +
    `column, as \`<index>:<field or ${CONTACT_IMPORT_IGNORE}>:<header>\`. ` +
    "Nothing was imported."
  );
}

/** The catalogue key and values paired with the legacy English refusal. */
export function contactImportUndeclaredColumnsReference(
  undeclared: readonly { index: number; header: string }[],
  totalColumns: number,
): ContactImportErrorReference {
  return {
    key:
      undeclared.length === 1
        ? "apiErrors.contactImportUndeclaredColumnsOne"
        : "apiErrors.contactImportUndeclaredColumnsMany",
    vars: {
      columns: undeclared.map(referencedColumn).join(", "),
      total: String(totalColumns),
      field: CONTACT_IMPORT_COLUMN_FIELD,
      ignore: CONTACT_IMPORT_IGNORE,
    },
  };
}

/**
 * What the server says when the declaration describes some OTHER file.
 *
 * One sentence for every way that can happen — a bad index, a repeated index, a
 * header that is not the one at that position, a field claimed twice, a value
 * that is not a declaration at all — because each of them is a caller bug
 * rather than a choice a person made, and five sentences would suggest there
 * are five things to fix.
 */
export function contactImportColumnMismatchMessage(detail: string): string {
  return (
    `file: the column declaration does not describe this file — ${detail}. ` +
    "Nothing was imported. Read the header row of the file being uploaded and " +
    `send one \`${CONTACT_IMPORT_COLUMN_FIELD}\` per column, by index.`
  );
}

/**
 * The mapping a set of declarations describes — the ONE the importer uses.
 *
 * The detector's answer is not consulted here. That is the point: the person's
 * answer is load-bearing, so a `Description` column that says "DO NOT CONTACT"
 * can be declared `opted_out` and actually block those rows, rather than being
 * claimed by `notes` and filed as a note while the message went out. Round two's
 * gate only examined UNMAPPED columns, so a wrong mapping was invisible to it.
 *
 * Callers validate first (see `contactImportColumnMismatchMessage`): this
 * assumes one declaration per index and at most one column per field.
 */
export function mappingFromDeclarations(
  declarations: readonly ContactImportColumnDeclaration[],
): ContactImportMapping {
  const mapping: ContactImportMapping = {};
  for (const declaration of declarations) {
    if (declaration.action === CONTACT_IMPORT_IGNORE) continue;
    mapping[declaration.action] = declaration.index;
  }
  return mapping;
}

/**
 * THE SAME RULE AT THE vCARD DOOR, in the shape that format allows.
 *
 * A .vcf has no columns, so there is nothing to count — but it has PROPERTIES,
 * and the two the format gives a do-not-text instruction to live in are
 * `CATEGORIES:DNC` and `NOTE:DO NOT CONTACT - asked us to stop`. Both are what
 * Apple and Google actually export, both were dropped by this parser without a
 * word, and both imported attested. That door had no gate of any kind.
 *
 * So the importer enumerates the properties the cards actually carry, and any
 * property it does not map has to be declared. `FN`, `N` and `TEL` are mapped
 * (see `VCARD_MAPPED_PROPERTIES`); `BEGIN`, `END` and `VERSION` are the
 * format's own furniture and carry nothing about a person.
 *
 * TWO ACTIONS, not the CSV's seven. A vCard property is not a column of values
 * to route into a field — it is present or it is not — so the answers that mean
 * anything are "this says nothing about who may be texted" and "a card carrying
 * this must not be texted". Declaring `opted_out` blocks EVERY card that
 * carries the property at all, which is deliberately coarse: a `CATEGORIES` of
 * "Friends" is blocked alongside one of "DNC". Coarse in the direction of not
 * texting somebody is the only direction this feature is allowed to be wrong
 * in, and the person declaring it can see which cards carry the property.
 *
 * WHAT COUNTS AS A PROPERTY IS WIDER THAN A PROPERTY NAME, and each of the
 * three widenings is a door somebody walked a delivered message through:
 *
 *   A LINE WITH NO COLON (`DO-NOT-CALL` on its own) is not a content line by
 *   the RFC, so the parser used to drop it before it was ever enumerated. The
 *   whole line is the token — a file that says this says it to a person, and
 *   the parser is not the one to decide it meant nothing.
 *
 *   A MALFORMED PARAMETER (`CATEGORIES;TYPE="a:DNC`) leaves no unquoted colon,
 *   which is the same drop by a different route: the property is CATEGORIES,
 *   one of the two the format lets a card say stop in, and it went unasked.
 *
 *   PARAMETERS, enumerated as `<PROPERTY>;<PARAM>` — see
 *   {@link vcardParameterProperty}. `TEL;TYPE=CELL;X-ABLabel=DO NOT
 *   CALL:+1613…` is Apple's inline shape, and everything after the first `;`
 *   was discarded: the property is TEL, TEL is mapped, and the instruction sat
 *   in a parameter nobody read. Apple's OTHER shape, the grouped
 *   `item1.X-ABLabel:` line, was always caught, which is what made this one so
 *   easy to believe was covered.
 *
 * That last one means an ordinary phone export asks about `TEL;TYPE`, whose
 * values are HOME and CELL and decide nothing. That is the cost, and it is
 * accepted: a parameter is free text, `TYPE=DNC` is a real export, and any rule
 * that exempted the ubiquitous ones would be a vocabulary — which is the thing
 * two rounds of this issue lost to.
 */
export const CONTACT_IMPORT_VCARD_PROPERTY_FIELD = "property";

/**
 * The token one PARAMETER is enumerated and declared under.
 *
 * Qualified by its property, because the parameter alone is not the fact: a
 * `TYPE` on `TEL` and a `TYPE` on `EMAIL` are different text on different lines,
 * and one answer covering both would dismiss a value nobody saw. Stated here
 * rather than spelled inline in four parsers — the server's enumeration and a
 * client's have to produce the same string or the client is refused forever.
 */
export function vcardParameterProperty(
  property: string,
  parameter: string,
): string {
  return `${property};${parameter}`;
}

/** What a caller may say about one vCard property. */
export type VCardPropertyAction = "ignore" | "opted_out";

/** One property's answer: the property name, and what it means. */
export interface VCardPropertyDeclaration {
  /** Upper-cased property name, as the parser reports it. */
  property: string;
  action: VCardPropertyAction;
}

/** The properties the importer reads. Everything else must be declared. */
export const VCARD_MAPPED_PROPERTIES: readonly string[] = [
  "FN",
  "N",
  "TEL",
  // Structural: the envelope of the format, never a fact about a person.
  "BEGIN",
  "END",
  "VERSION",
];

const VCARD_ACTIONS = new Set<string>([CONTACT_IMPORT_IGNORE, "opted_out"]);

/** The wire form of one property declaration: `<PROPERTY>:<action>`. */
export function formatVCardProperty(
  declaration: VCardPropertyDeclaration,
): string {
  return `${declaration.property}:${declaration.action}`;
}

/**
 * Read one property declaration off the wire, or null when it is not one.
 *
 * Split on the LAST colon, the mirror of the column format's first: a property
 * name may be grouped or parameterised in the file, and the action is the fixed
 * token, so the fixed end is the safe end to split from.
 */
export function parseVCardProperty(raw: string): VCardPropertyDeclaration | null {
  const colon = raw.lastIndexOf(":");
  if (colon === -1) return null;
  const action = raw.slice(colon + 1);
  if (!VCARD_ACTIONS.has(action)) return null;
  const property = raw.slice(0, colon).trim().toUpperCase();
  if (property === "") return null;
  return { property, action: action as VCardPropertyAction };
}

/**
 * How many property names one refusal prints, and how long each may be.
 *
 * A bound is needed now that a line with no colon is a property: a mangled file
 * can carry thousands of one-off tokens, each as long as the line, and a
 * refusal that repeats a megabyte back is a refusal nobody reads and a response
 * nothing should have to hold in memory.
 *
 * PRINTING FEWER NAMES NEVER LOOSENS THE REFUSAL — nothing is imported either
 * way, and the client enumerated these properties out of the file it is holding
 * rather than learning them here. It only shortens the sentence, so the overflow
 * is stated rather than trailing off (#248 round 2's B8: a truncated list under
 * a whole count is how a person reads "five" and acts on it).
 */
const VCARD_PROPERTIES_NAMED = 20;
const VCARD_PROPERTY_NAME_SHOWN = 60;

function displayedVCardProperties(properties: readonly string[]): string[] {
  return properties
    .slice(0, VCARD_PROPERTIES_NAMED)
    .map((property) =>
      property.length > VCARD_PROPERTY_NAME_SHOWN
        ? `${property.slice(0, VCARD_PROPERTY_NAME_SHOWN)}…`
        : property,
    );
}

/** What the server says when a card carries a property nobody answered for. */
export function contactImportUndeclaredPropertiesMessage(
  properties: readonly string[],
): string {
  const one = properties.length === 1;
  const shown = displayedVCardProperties(properties);
  const more = properties.length - shown.length;
  return (
    `file: ${shown.map((property) => `\`${property}\``).join(", ")}` +
    `${more > 0 ? `, and ${more} more` : ""} ` +
    `${one ? "is a property" : "are properties"} on these cards that this ` +
    "import does not read — a name with a `;` in it is a PARAMETER on that " +
    "property, which is free text of its own. A `CATEGORIES:DNC`, a `NOTE` " +
    "saying they asked us to stop, and a label like `X-ABLabel=DO NOT CALL` " +
    "are the places a .vcf says do-not-text, so a property read as nothing " +
    "texts somebody who asked this business to stop. " +
    `Send one \`${CONTACT_IMPORT_VCARD_PROPERTY_FIELD}\` field per property, ` +
    `as \`<PROPERTY>:<${CONTACT_IMPORT_IGNORE} or opted_out>\`, from somebody ` +
    "who can see what the cards carry. " +
    // #528: the question this list provokes, answered before it is asked.
    //
    // The name, phone and version properties are absent from the list above
    // because the import READS them — and somebody looking for a way to declare
    // `FN` needs to know that is deliberate rather than missing. A card whose
    // name is an instruction is the case worth naming out loud, because it is
    // how a phone's address book carries one: there is nowhere else to type it.
    "Name, phone and version are not in that list because this import does " +
    "read them. Whatever a card puts in its name arrives as the contact's " +
    "name — so `DO NOT CALL - asked us to stop` typed there is on screen " +
    "beside every message to them, before anybody sends one. " +
    "Nothing was imported."
  );
}

/** The catalogue key and values paired with the legacy vCard refusal. */
export function contactImportUndeclaredPropertiesReference(
  properties: readonly string[],
): ContactImportErrorReference {
  const shown = displayedVCardProperties(properties);
  const more = properties.length - shown.length;
  const key: ContactImportErrorMessageKey =
    more > 0
      ? "apiErrors.contactImportUndeclaredPropertiesCapped"
      : properties.length === 1
        ? "apiErrors.contactImportUndeclaredPropertiesOne"
        : "apiErrors.contactImportUndeclaredPropertiesMany";
  return {
    key,
    vars: {
      properties: shown.map((property) => `\`${property}\``).join(", "),
      more: String(more),
      field: CONTACT_IMPORT_VCARD_PROPERTY_FIELD,
      ignore: CONTACT_IMPORT_IGNORE,
    },
  };
}

/**
 * What the server says when the do-not-text column itself is unreadable.
 *
 * A different sentence from the ones above and deliberately not resolvable by a
 * declaration: we already know this column decides who may be texted — that is
 * what it was declared as — so the only honest fix is in the file.
 */
export function contactImportUnreadableFlagMessage(
  header: string,
  values: readonly string[],
): string {
  const shown = values
    .slice(0, 5)
    .map((value) => `"${value}"`)
    .join(", ");
  const more = values.length > 5 ? `, and ${values.length - 5} more` : "";
  return (
    `file: the column "${header.trim()}" is the one this import reads as do-not-text, and it ` +
    `carries values it cannot read as yes or no: ${shown}${more}. Reading them as blank would ` +
    "text somebody who asked this business to stop, so nothing was imported. Use true/false " +
    "(yes/no, 1/0, or x on the rows to block) and import again."
  );
}

/** The catalogue key and values paired with the legacy flag-value refusal. */
export function contactImportUnreadableFlagReference(
  header: string,
  values: readonly string[],
): ContactImportErrorReference {
  const shown = values.slice(0, 5).map((value) => `\u201c${value}\u201d`);
  const more = values.length - shown.length;
  return {
    key:
      more > 0
        ? "apiErrors.contactImportUnreadableFlagCapped"
        : "apiErrors.contactImportUnreadableFlag",
    vars: {
      header: header.trim(),
      values: shown.join(", "),
      more: String(more),
    },
  };
}

/**
 * Every catalogue key the value-list controls name.
 *
 * #228. The prefix is `contactsTasks` rather than `domain` because Android has
 * already said these four for months from exactly these keys — the phones keep
 * contacts and tasks in one section. Naming a second key for the same sentence
 * so the shared module could use its usual prefix would put the words in two
 * places, which is the drift this module was written to prevent.
 */
export type ContactImportValuesKey =
  | "contactsTasks.importHiddenValues"
  | "contactsTasks.importShowAllValues"
  | "contactsTasks.importShowFewerValues"
  | "contactsTasks.importValueCeiling";

/** The reader's resolver, taking one of the four keys above. */
export type SayValuesKey = (key: ContactImportValuesKey) => string;

/**
 * How the mapping screen names the values it has NOT printed.
 *
 * `", and more"` was what all three clients said, and it is the one phrase this
 * screen cannot afford: a person deciding whether to skip a column reads it and
 * learns nothing, because it stands equally for one more value and four hundred.
 * The count is the difference between "I have seen this column" and "I have seen
 * three of its nine answers".
 *
 * Paired with {@link contactImportShowAllValuesLabel} — a count with no way to
 * act on it is a better-worded dead end, not a fix.
 */
export function contactImportHiddenValuesLabel(
  hidden: number,
  say: SayValuesKey,
): string {
  return say("contactsTasks.importHiddenValues").replace(
    "{count}",
    String(hidden),
  );
}

/**
 * The control that puts every value a column holds on the screen.
 *
 * The whole design rests on a person dismissing a column KNOWING what it says,
 * and until this existed the answer to "what else is in there?" was to go and
 * open the file in another program. That is not an answer during an import.
 */
export function contactImportShowAllValuesLabel(
  total: number,
  say: SayValuesKey,
): string {
  return say("contactsTasks.importShowAllValues").replace(
    "{count}",
    String(total),
  );
}

/** The control that puts an expanded column back to its first few values. */
export const CONTACT_IMPORT_SHOW_FEWER_VALUES_KEY =
  "contactsTasks.importShowFewerValues";

/**
 * What an expanded column says when even the full list is cut.
 *
 * Said rather than left to be inferred, because a person believing a list is
 * complete when it is not is the same defect as `", and more"` wearing a longer
 * list. It states the two numbers and stops: how many answers this column has is
 * NOT a rule about what the column means, and a sentence here implying otherwise
 * would be a guess dressed as a fact.
 */
export function contactImportValueCeilingNote(
  shown: number,
  total: number,
  say: SayValuesKey,
): string {
  return say("contactsTasks.importValueCeiling")
    .replace("{shown}", String(shown))
    .replace("{total}", String(total));
}

/**
 * What the server says when a quoted value is never closed.
 *
 * THE FILE IS REFUSED RATHER THAN PARSED AS FAR AS IT GOES, and that is the
 * whole fix. A single unclosed `"` makes every following line part of one
 * enormous value: the import returned 200, with ordinary counts and not one
 * error row, having eaten forty contacts. Nobody is texted by that — but
 * nobody is told either, and a person who is silently absent from a crew's
 * contact list is a person that crew stops texting for reasons they will never
 * find. A skipped row with a reason is a defect; a swallowed row with no reason
 * is not visible enough to be one.
 *
 * Names the LINE the quote opened on, because that is the only part a person
 * can act on — the mangling shows up hundreds of lines later, where the file
 * looks fine.
 */
export function contactImportUnterminatedQuoteMessage(line: number): string {
  return (
    `file: a quoted value opened on line ${line} and is never closed, so ` +
    "everything after it reads as part of that one value — the rows below it " +
    "would not be imported, and would not be reported as skipped either. Close " +
    'the quote (a literal quote inside a quoted value is doubled: "") and ' +
    "import again. Nothing was imported."
  );
}

/**
 * #528: a card boundary that a stray leading space turned into part of the
 * previous line.
 *
 * Says what it would have COST rather than naming the rule, because "a folded
 * BEGIN:VCARD" means nothing to the person holding the file and "two people
 * became one" means everything. The remedy is one keystroke and worth stating
 * exactly, since the character at fault is invisible.
 */
export function contactImportVCardMergedCardMessage(line: number): string {
  return (
    `file: line ${line} starts with a space, and in a .vcf a line beginning ` +
    "with a space continues the line above it — so this card's BEGIN or END " +
    "reads as part of the previous card instead of ending it. Two contacts " +
    "would be imported as one: the first card's name with the second card's " +
    "phone number. Delete the space at the start of that line and import " +
    "again. Nothing was imported."
  );
}

/**
 * #528: a content line with no property name, which cannot be declared.
 *
 * The 422 for an unread property asks the operator what it means. This one
 * cannot: a declaration is keyed on a property name and this line has none. So
 * it asks for the file to be corrected instead, and says why the usual question
 * is not available.
 */
export function contactImportVCardNamelessPropertyMessage(line: number): string {
  return (
    `file: line ${line} has no property name before its colon, so there is ` +
    "nothing to ask you about it — every other unread line in a .vcf can be " +
    "declared as ignored or as do-not-text, and this one cannot be named. It " +
    "is skipped by every reader, which means anything it says (including not " +
    "to text somebody) goes unread. Give the line a property name or remove " +
    "it, then import again. Nothing was imported."
  );
}

/**
 * What the server says when the upload is not UTF-8 text.
 *
 * Excel's "Unicode Text" save is UTF-16, and its zero bytes survive being
 * decoded as UTF-8: they travelled the whole way down and Postgres refused the
 * insert with `unsupported Unicode escape sequence`, which reached the customer
 * as a 500. Refusing the file is a fine answer; crashing on it is not, and a
 * 500 also tells the workspace nothing about what to do next.
 *
 * Checked on the DECODED text rather than sniffed from a byte-order mark: a
 * BOM-less UTF-16 export, and a spreadsheet uploaded as `.csv` by mistake, land
 * here the same way, and what they have in common is exactly what breaks.
 */
export const CONTACT_IMPORT_UNREADABLE_ENCODING =
  "file: this is not a UTF-8 text file — it still carries the zero bytes a " +
  'UTF-16 save leaves behind (Excel\'s "Unicode Text", or a spreadsheet saved ' +
  "under a .csv name). Re-save it as CSV UTF-8 and import again. Nothing was " +
  "imported.";

/** Rows one CSV import may carry — bounds URL sizes and Worker CPU. */
export const CONTACT_IMPORT_MAX_ROWS = 2000;

/** Bytes of CSV text one import may carry (the multipart body may be larger). */
export const CONTACT_IMPORT_MAX_BYTES = 2 * 1024 * 1024;

/** Cards one .vcf may carry — the same CPU bound as the CSV row cap. */
export const VCARD_IMPORT_MAX_CARDS = CONTACT_IMPORT_MAX_ROWS;

/** Bytes of vCard text one import may carry. Bigger: a card is verbose. */
export const VCARD_IMPORT_MAX_BYTES = 5 * 1024 * 1024;
