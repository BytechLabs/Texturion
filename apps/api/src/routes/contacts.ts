/**
 * Contact routes (SPEC §5, §7, §10 matrix):
 *
 *   GET    /v1/contacts             M   — cursor list (created_at, id) DESC,
 *          trgm-backed `q` over name/phone, soft-deleted hidden; every row
 *          carries the app-side `opted_out` state (DESIGN G6: the contacts
 *          table shows an opted-out badge) and `last_activity_at` — the
 *          newest conversations.last_message_at for the contact, null when
 *          they have no conversation (the G6 "last activity" column; never
 *          the record's updated_at, which any edit or CSV re-import touches).
 *   POST   /v1/contacts             M   — upsert on (company_id, phone_e164);
 *          existing rows (soft-deleted included) are updated and deleted_at
 *          cleared.
 *   GET    /v1/contacts/:id         M   — read (soft delete hides from lists
 *          only), with the app-side opt-out state.
 *   PATCH  /v1/contacts/:id         M   — name/address/notes + consent
 *          attestation (§5 D4: consent_source='attested', consent_at,
 *          consent_attested_by + consent_attested event), refused whole over a
 *          standing opt-out or an existing basis (#248 — the same rule the
 *          importers follow, at the third door that writes these columns).
 *   DELETE /v1/contacts/:id         M   — soft delete (deleted_at).
 *   POST   /v1/contacts/import     O/A  — CSV multipart (phone, name or
 *          first/last, address, notes, opted_out?): E.164-normalize, per-row
 *          upsert clearing deleted_at, opted_out=true → opt_outs
 *          source='import' + events; returns
 *          { imported, updated, skipped, errors, consent_refused,
 *            consent_refusals, consent_refused_note }. Requires the #226
 *          consent attestation, which is written ONLY to contacts that have no
 *          basis yet AND no standing opt-out (#248) — an import may lower a
 *          contact's standing, never raise it. EVERY column of the file must be
 *          declared up front, mapped or ignored, by index (#248 round 3,
 *          `declaredColumns`): nothing is silently dropped, because a dropped
 *          column may be the one saying who not to text.
 *   POST   /v1/contacts/import-vcard O/A — the same upsert behind a second
 *          parser, same attestation, same rule; every vCard property the parser
 *          does not read must be declared too (`declaredVCardProperties`), so
 *          `CATEGORIES:DNC` and a do-not-contact `NOTE` cannot pass unread.
 *   POST   /v1/contacts/:id/opt-out         M — manual opt-out
 *          (source='manual') + event; enforced app-side at send time (§5).
 *   POST   /v1/contacts/:id/opt-out/revoke  M — revoke + event.
 *   DELETE /v1/contacts/:id/opt-out         M — alias of revoke.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { Hono, type Context } from "hono";
import { z } from "zod";

import { recordAuditFromRequest } from "../audit/log";
import { alarmOnBulkContactAccess } from "../audit/bulk-contact-alarm";
import { resolveDestinationClock } from "../messaging/destination-clock";
import { requireCapability } from "../auth/company";
import { resolveNumberAccess } from "../auth/number-access";
import type { AppEnv } from "../context";
import { answerersByCall } from "../calls/answerers";
import { getDb } from "../db";
import { getEnv, type Env } from "../env";
import { ApiError, errorResponse } from "../http/errors";
import { buildPage, encodeCursor } from "../http/pagination";
import {
  CsvUnterminatedQuoteError,
  csvSafeText,
  parseCsvRows,
  serializeCsv,
  type CsvRow,
} from "./core/csv";
import {
  insertConversationEvents,
  latestConversationId,
  type ConversationEventRow,
} from "./core/events";
import {
  assertBodyWithinLimit,
  keysetFilter,
  orIlikeValue,
  parseCursor,
  parseJsonBody,
  parseLimit,
  pathUuid,
  unwrap,
} from "./core/http";
import { resolveActorNames } from "./core/attribution";
import {
  CONTACT_FIELDS_CAP,
  CONTACT_FIELD_KINDS,
  CONTACT_FIELD_OPTIONS_CAP,
  CONTACT_FIELD_VALUE_MAX,
  CONTACT_IMPORT_COLUMN_FIELD,
  CONTACT_IMPORT_CONSENT_FIELD,
  CONTACT_IMPORT_CONSENT_REFUSED_NOTE,
  CONTACT_IMPORT_CONSENT_REQUIRED,
  CONTACT_IMPORT_CONSENT_VALUE,
  CONTACT_IMPORT_IGNORE,
  CONTACT_IMPORT_MAX_BYTES,
  CONTACT_IMPORT_MAX_ROWS,
  CONTACT_IMPORT_UNREADABLE_ENCODING,
  CONTACT_IMPORT_VCARD_PROPERTY_FIELD,
  type ContactFieldKind,
  type ContactImportColumnDeclaration,
  type ContactImportMapping,
  contactFieldValueError,
  contactImportColumnCount,
  contactImportColumnMismatchMessage,
  contactImportConsentRefusedReason,
  contactImportUndeclaredColumnsMessage,
  contactImportUndeclaredPropertiesMessage,
  contactImportUnreadableFlagMessage,
  contactImportUnterminatedQuoteMessage,
  formatContactImportColumn,
  formatVCardProperty,
  joinContactName,
  LOCALES,
  mappingFromDeclarations,
  parseContactImportColumn,
  parseVCardProperty,
  readContactFlag,
  unreadableFlagValues,
  VCARD_IMPORT_MAX_BYTES,
  VCARD_IMPORT_MAX_CARDS,
  VCARD_MAPPED_PROPERTIES,
  type VCardPropertyDeclaration,
} from "@loonext/shared";

import { capture } from "../analytics/posthog";

import { normalizeNanpPhone } from "./core/phone";
import { isValidIanaTimezone } from "./core/timezone";
import { parseVCards } from "./core/vcard";

const CONTACT_COLUMNS =
  "id,phone_e164,name,address,notes,consent_source,consent_at," +
  // #291: the two fields whose absence forecloses other features outright —
  // an email for quote delivery and receipts, and the business a customer
  // represents, which for a property manager IS the relationship.
  "email,business_name," +
  // #291: the workspace's own fields — on the DETAIL projection only, for the
  // same reason `notes` is: up to 4 KB a row that only the detail panel
  // renders. It has to be on THIS one, though, because PATCH answers with this
  // shape, and a client writing that answer into its cache would blank a gate
  // code on an unrelated edit.
  "custom_fields," +
  "consent_attested_by,created_by_user_id,updated_by_user_id," +
  // #292: the human's correction to the area-code inference. NULL means infer.
  "timezone," +
  // #228: this customer's own language, or NULL to follow the company's. On the
  // detail projection only - the list has no control for it, and PATCH answers
  // with this shape, so a client writing the answer into its cache needs the
  // field present or the override it just set reads back as absent.
  "locale," +
  // #393: null means a first outbound to this contact would carry the
  // identification suffix. The composer needs it to fold the suffix into its
  // segment count — a meter that shows one segment while the send bills two is
  // the dishonest metering the append order was arranged to avoid. Exposed
  // because an imported contact who has never been texted is common (#248).
  "first_identification_sent_at," +
  "deleted_at,created_at,updated_at";

/**
 * The LIST projection — CONTACT_COLUMNS minus `notes`. Notes run up to 5000
 * chars/row and are only ever rendered in the contact detail panel (GET
 * /contacts/:id), never in the list table, so shipping them for a 100-row page
 * was up to ~500 KB of payload the client throws away.
 */
const CONTACT_LIST_COLUMNS =
  "id,phone_e164,name,address,consent_source,consent_at," +
  // #291: on the LIST too, unlike notes. Both are short, and the business name
  // is how somebody recognises which "Dave" a row is — which is exactly the
  // job a list does.
  "email,business_name," +
  "consent_attested_by,created_by_user_id,updated_by_user_id," +
  // #393: one timestamp per row, and the composer's recipient picker reads the
  // LIST rather than fetching each contact.
  "first_identification_sent_at," +
  "deleted_at,created_at,updated_at";

/**
 * #291: an email, checked for shape rather than validated.
 *
 * Deliverability is not knowable here and a strict RFC pattern rejects real
 * addresses — what this stops is a phone number or a sentence landing in the
 * field that quote delivery (#287) will later trust.
 */
const emailField = z
  .string()
  .trim()
  .min(3)
  .max(254)
  .refine((value) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value), {
    message: "That does not look like an email address",
  });

const createSchema = z.object({
  phone_e164: z.string().trim().min(1).max(32),
  name: z.string().trim().min(1).max(200).optional(),
  address: z.string().trim().min(1).max(500).optional(),
  notes: z.string().max(5000).optional(),
  /** #291: one of the two ways to reach a customer, finally stored. */
  email: emailField.optional(),
  /** #291: who they work for, when that is the relationship. */
  business_name: z.string().trim().min(1).max(200).optional(),
});

const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(200).nullable().optional(),
    address: z.string().trim().min(1).max(500).nullable().optional(),
    notes: z.string().max(5000).nullable().optional(),
    // #291. Nullable so a mistyped email can be cleared — a field somebody
    // cannot empty is a field they stop trusting.
    email: emailField.nullable().optional(),
    business_name: z.string().trim().min(1).max(200).nullable().optional(),
    // #228: the language THIS customer reads. NULLABLE, and the null is the
    // point: it means "follow the company", not English. Without it an override
    // would be permanent once set, and "actually, treat them like everyone
    // else" would be unsayable.
    locale: z.enum(LOCALES).nullable().optional(),
    // #292/D49: the correction to the area-code inference. NULL clears it and
    // goes back to inferring — which is a real thing to want, so it is
    // nullable rather than write-once.
    timezone: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .refine(isValidIanaTimezone, {
        message: "Must be an IANA timezone name, e.g. America/Edmonton.",
      })
      .nullable()
      .optional(),
    // #291: the workspace's own fields, as a whole object. A PARTIAL merge
    // would leave no way to clear one value — the omitted key and the cleared
    // key would look identical — so the client sends the set it wants stored.
    custom_fields: z
      .record(z.string(), z.string().max(CONTACT_FIELD_VALUE_MAX))
      .nullable()
      .optional(),
    // §5 consent attestation: only literal true has meaning.
    consent_attested: z.literal(true).optional(),
  })
  .refine(
    (body) =>
      "name" in body ||
      "address" in body ||
      "notes" in body ||
      "timezone" in body ||
      // #291. Easy to forget, and the failure is a 422 on a PATCH that looks
      // perfectly well formed — the field validates, the write path handles
      // it, and the request is refused before either runs.
      "email" in body ||
      "business_name" in body ||
      "locale" in body ||
      "custom_fields" in body ||
      body.consent_attested === true,
    { message: "Provide at least one field to update." },
  );

/**
 * Rows a single import may carry — bounds URL sizes and Worker CPU. Shared
 * (#248) so the wizard's dry run, both phone apps and this route quote one
 * number: a client that promised a 3000-row file would import and a server that
 * refused it was a broken promise made at the worst possible moment.
 */
const IMPORT_MAX_ROWS = CONTACT_IMPORT_MAX_ROWS;
/** Chunk size for batched PostgREST calls during import. */
const IMPORT_CHUNK = 200;
/**
 * #36 whole-request ceilings, checked from Content-Length BEFORE formData()
 * buffers the body into Worker memory (SPEC §10 DoS posture — the
 * attachments-route pattern). Each is the route's per-file text cap plus
 * generous multipart overhead; the post-parse text-length checks remain the
 * exact backstop for chunked requests that carry no Content-Length.
 */
const MAX_CSV_IMPORT_BODY_BYTES = CONTACT_IMPORT_MAX_BYTES + 1024 * 1024;
const MAX_VCARD_IMPORT_BODY_BYTES = VCARD_IMPORT_MAX_BYTES + 1024 * 1024;

/**
 * #248: the attestation gate both bulk doors stand behind.
 *
 * #226 put it on the CSV route and the vCard route never grew one, so the only
 * bulk-contact door with no consent question at all was the one a phone's
 * address book goes through — the exact inverse of what #226 was for. It is one
 * `form.get` and one throw, and it belongs to both or to neither.
 *
 * Checked BEFORE the file is parsed so a caller cannot spend the upload and
 * only then be told. Only the literal `"true"` passes: a field that also
 * accepts "false" is not an attestation.
 */
function assertConsentAttested(form: FormData): void {
  if (form.get(CONTACT_IMPORT_CONSENT_FIELD) !== CONTACT_IMPORT_CONSENT_VALUE) {
    throw new ApiError("validation_failed", CONTACT_IMPORT_CONSENT_REQUIRED);
  }
}

/**
 * #248: refuse a file that is not UTF-8 text, rather than mangling it.
 *
 * Excel's "Unicode Text" save is UTF-16, and `File.text()` decodes it as UTF-8,
 * which leaves the zero byte between every ASCII character intact. Those NULs
 * travelled the entire route — through the parser, the declaration gate and the
 * consent decision — and died at Postgres with `unsupported Unicode escape
 * sequence`, which reached the customer as a 500. Refusing the file is a fine
 * answer. Crashing on it is not, and a 500 tells the workspace nothing about
 * what to do next.
 *
 * ON THE DECODED TEXT, not sniffed from a byte-order mark: a BOM-less UTF-16
 * export and a binary spreadsheet renamed `.csv` both land here, and what they
 * have in common is the thing that actually breaks. A NUL is never legitimate
 * in either format — CSV is text and vCard is line-oriented text — so this
 * cannot refuse a file somebody meant to send.
 *
 * BOTH DOORS, for the same reason `assertConsentAttested` is at both: the
 * defect is in how the bytes were decoded, and a .vcf saved as UTF-16 decodes
 * exactly as badly.
 */
function assertDecodableText(text: string): void {
  if (text.includes("\u0000")) {
    throw new ApiError("validation_failed", CONTACT_IMPORT_UNREADABLE_ENCODING);
  }
}

/**
 * #248 round 3 — THE HEADLINE. The API door takes a COMPLETE declaration, or
 * the request is refused.
 *
 * Two rounds tried to classify the columns this importer drops. Round one asked
 * about the header WORD and a file headed "Do Not Call" imported attested, with
 * a real text delivered. Round two asked about the SHAPE of the values, which is
 * a vocabulary of numbers, and three independent verifiers got messages
 * delivered through it: four distinct answers, a 25-character value, the same
 * answer on all sixty rows, a four-row file, a cell past the end of the header
 * row, a column mapped somewhere inert, and — the worst of them — a 422 whose
 * own sentence named the columns, re-posted with them echoed back, 200.
 *
 * So the question is not asked. NOTHING IS SILENTLY DROPPED: every column is
 * either mapped to a field or explicitly dismissed, by index, up front. See
 * CONTACT_IMPORT_COLUMN_FIELD for the contract and for what it does NOT
 * guarantee — a scripted caller can declare everything ignorable and we cannot
 * tell. What is closed is the silent case, which is every real accident.
 *
 * REFUSING THE WHOLE FILE, not the flagged rows, and not just the attestation.
 *
 *   Refusing rows requires knowing which way a column points, and that is the
 *   vocabulary problem wearing a hat: `y` under "Do Not Call" and `y` under
 *   "OK to Text" are opposite instructions.
 *
 *   Refusing only the ATTESTATION would not protect anybody: `runPreSendGates`
 *   asks `opt_outs` whether a number may be texted and never asks whether a
 *   contact has a consent basis. An import that withholds the attestation and
 *   creates the contacts anyway still ends with a message reaching them.
 *
 * Returns the declarations rather than just validating them, because the
 * MAPPING comes from here too: the person's answer is the mapping, so a
 * `Description` column reading "DO NOT CONTACT" can be declared `opted_out`
 * instead of being claimed by `notes` and filed as a note while the text went
 * out. Checked before the first write, and it throws, so the answer is the same
 * whichever client posted the file.
 */
function declaredColumns(
  form: FormData,
  headers: readonly string[],
  dataRows: readonly (readonly string[])[],
): ContactImportColumnDeclaration[] {
  const refuse = (detail: string): never => {
    throw new ApiError(
      "validation_failed",
      contactImportColumnMismatchMessage(detail),
    );
  };
  // The column count comes from the DATA. A cell past the end of the header row
  // is a column with a blank name and it is answered for like any other — every
  // loop in round two was bounded by `headers.length`, so that cell was never
  // looked at by any rule at all.
  const total = contactImportColumnCount(headers, dataRows);
  const byIndex = new Map<number, ContactImportColumnDeclaration>();
  const byField = new Map<string, ContactImportColumnDeclaration>();
  for (const raw of form.getAll(CONTACT_IMPORT_COLUMN_FIELD)) {
    if (typeof raw !== "string") {
      refuse(`a \`${CONTACT_IMPORT_COLUMN_FIELD}\` field was not text`);
      continue;
    }
    const declaration = parseContactImportColumn(raw);
    if (!declaration) {
      refuse(`\`${raw}\` is not \`<index>:<field or ignore>:<header>\``);
      continue;
    }
    if (declaration.index >= total) {
      refuse(
        `column ${declaration.index + 1} was declared and this file has ` +
          `${total} column${total === 1 ? "" : "s"}`,
      );
    }
    if (byIndex.has(declaration.index)) {
      refuse(`column ${declaration.index + 1} is declared twice`);
    }
    // The header is what catches a declaration built from some OTHER file —
    // yesterday's export, the wrong branch of an integration. The index is the
    // identity; this is the confirmation that the identity refers to the file
    // actually attached.
    const expected = (headers[declaration.index] ?? "").trim();
    if (declaration.header.trim() !== expected) {
      refuse(
        `column ${declaration.index + 1} was declared as ` +
          `"${declaration.header.trim()}" and this file calls it ` +
          `"${expected}"`,
      );
    }
    if (declaration.action !== CONTACT_IMPORT_IGNORE) {
      const claimed = byField.get(declaration.action);
      if (claimed) {
        refuse(
          `columns ${claimed.index + 1} and ${declaration.index + 1} were ` +
            `both declared \`${declaration.action}\`, and a contact has one`,
        );
      }
      byField.set(declaration.action, declaration);
    }
    byIndex.set(declaration.index, declaration);
  }

  const undeclared: { index: number; header: string }[] = [];
  for (let index = 0; index < total; index += 1) {
    if (!byIndex.has(index)) {
      undeclared.push({ index, header: (headers[index] ?? "").trim() });
    }
  }
  if (undeclared.length > 0) {
    throw new ApiError(
      "validation_failed",
      contactImportUndeclaredColumnsMessage(undeclared, total),
    );
  }
  return [...byIndex.values()].sort((a, b) => a.index - b.index);
}

/**
 * The other half, one level down: the column declared as do-not-text has to be
 * READABLE.
 *
 * A "Do Not Contact" column of `Subscribed`/`Unsubscribed` was identified
 * correctly and then read as nobody opted out, because anything that was not
 * `yes` was silently false. Not resolvable by a declaration — this column was
 * declared the thing that decides who may be texted, so the only honest fix is
 * in the file.
 */
function assertFlagColumnReadable(
  headers: readonly string[],
  dataRows: readonly (readonly string[])[],
  mapping: ContactImportMapping,
): void {
  const flagCol = mapping.opted_out;
  if (flagCol === undefined) return;
  const unreadable = unreadableFlagValues(dataRows, flagCol);
  if (unreadable.length > 0) {
    throw new ApiError(
      "validation_failed",
      contactImportUnreadableFlagMessage(headers[flagCol] ?? "", unreadable),
    );
  }
}

/**
 * #248 round 3 — the same rule at the vCard door, which had no gate at all.
 *
 * `CATEGORIES:DNC` and `NOTE:DO NOT CONTACT - asked us to stop` are the only two
 * places the format allows a do-not-text instruction, they are what Apple and
 * Google actually export, and this parser dropped both without a word while the
 * file's attestation was written over the top.
 *
 * A .vcf has no columns to count, so the enumeration is of the PROPERTIES the
 * cards actually carry. Every one the importer does not read has to be declared
 * `ignore` or `opted_out`; see CONTACT_IMPORT_VCARD_PROPERTY_FIELD for why
 * those are the only two answers worth having here.
 *
 * Returns the declarations that answered a property these cards actually
 * carried — so the caller can block the cards somebody marked (the only
 * direction an import is allowed to move a standing) and record what this
 * workspace claimed on the audit row.
 */
function declaredVCardProperties(
  form: FormData,
  cards: readonly { properties: string[] }[],
): VCardPropertyDeclaration[] {
  const present = new Set<string>();
  for (const card of cards) {
    for (const property of card.properties) present.add(property);
  }
  for (const mapped of VCARD_MAPPED_PROPERTIES) present.delete(mapped);

  const answered: VCardPropertyDeclaration[] = [];
  for (const raw of form.getAll(CONTACT_IMPORT_VCARD_PROPERTY_FIELD)) {
    if (typeof raw !== "string") continue;
    const declaration = parseVCardProperty(raw);
    // A declaration for a property no card carries is ignored rather than
    // refused: an integration that always sends its full vocabulary is not
    // making a claim about a file, and there is nothing here for it to hide.
    if (!declaration || !present.delete(declaration.property)) continue;
    answered.push(declaration);
  }
  if (present.size > 0) {
    throw new ApiError(
      "validation_failed",
      contactImportUndeclaredPropertiesMessage([...present].sort()),
    );
  }
  return answered;
}

/**
 * #248: bound the one door a customer hands us unbounded input through.
 *
 * Rows and bytes are capped per request, and nothing capped the requests. Two
 * thousand rows is ten pre-check reads plus ten upserts plus the opt-out
 * passes, all inside one Worker request, and a script (or a retry loop in a
 * client somebody wrote) could run that as fast as the network allowed, on an
 * account that pays us nothing for it.
 *
 * SIX A MINUTE (wrangler.jsonc), because three contradicted our own
 * instructions: a file over the row cap is met with "split the file and import
 * in parts", and an 8000-row book is four parts — the fourth of which the
 * limiter refused, on somebody's first day, with a message about scripts. The
 * number has to leave room for the behaviour the product asked for, and six
 * still makes a fan-out of hundreds of thousands take hours.
 *
 * Keyed on the COMPANY, not the user: the cost is the workspace's, and keying
 * on the member would let one crew run seats-many imports at once.
 *
 * Binding absent in dev/tests → skipped, exactly like every other limiter here.
 */
export async function assertImportWithinRateLimit(
  env: Env,
  companyId: string,
): Promise<void> {
  const limiter = env.CONTACT_IMPORT_RATE_LIMITER;
  if (!limiter) return;
  const { success } = await limiter.limit({ key: `contact-import:${companyId}` });
  if (!success) {
    throw new ApiError(
      "rate_limited",
      "Too many imports in a row. Wait a minute and upload the file again — " +
        "an import that was interrupted picks up where it left off.",
    );
  }
}

/**
 * The three consent-refusal fields, built once from ONE list.
 *
 * #248 round 2 (B8): the count and the list were assembled independently at
 * each of the two import routes, and web deliberately renders the NUMBER. So a
 * list that was ever truncated — for a response-size limit, say — would print
 * "40 refused" above five rows with nothing saying the rest existed, and no
 * test on either side would have noticed. Deriving the count from the list it
 * ships with makes them one fact.
 *
 * THE LIST IS NEVER TRUNCATED. It is bounded by the row cap, and every refusal
 * names a person this workspace must not text. If that ever has to change, the
 * count must stay whole and the clients need an overflow line before it does —
 * which is exactly what the guard on this will fail and ask for.
 */
function refusalReport(refusals: { row: number; reason: string }[]): {
  consent_refused: number;
  consent_refusals: { row: number; reason: string }[];
  consent_refused_note: string | null;
} {
  return {
    consent_refused: refusals.length,
    consent_refusals: refusals,
    consent_refused_note:
      refusals.length > 0 ? CONTACT_IMPORT_CONSENT_REFUSED_NOTE : null,
  };
}

/** What an import decided about ONE contact's consent columns. */
interface ImportConsent {
  /** The columns to write — usually none. */
  columns: Record<string, unknown>;
  /**
   * True when a standing opt-out this FILE did not know about refused an
   * attestation the import would otherwise have written. Reported back to the
   * workspace; see CONTACT_IMPORT_CONSENT_REFUSED_NOTE for why.
   */
  refused: boolean;
}

/**
 * The consent columns an import may write on ONE contact — and the whole point
 * is that it is usually none of them.
 *
 * TWO rules, and they refuse for different reasons.
 *
 * AN EXISTING BASIS IS NEVER REPLACED. An import used to stamp
 * `attested / now / whoever ran it` on every row it touched, and the upsert
 * merges on conflict, so re-importing a file rewrote the recorded basis of
 * contacts that already had one. A customer who texted this business first on
 * 12 March — implied consent, with the inbound message as evidence — became
 * "consent recorded by Sam, today" because Sam re-uploaded last year's
 * spreadsheet. That is worse than losing the record: it replaces strong
 * evidence (they contacted us) with weak evidence (someone says so), and the
 * ledger cannot even record the change, because `contacts_record_consent` only
 * fires on the null → value transition. The contact panel would then show an
 * attestation the ledger has no row for. So a row that already says anything
 * about why this business may text this person keeps what it says — `coalesce`
 * semantics, matching what `thread_inbound_message` has always done on the same
 * three columns.
 *
 * A STANDING OPT-OUT REFUSES OUTRIGHT, whether or not there is a basis to keep.
 * This is the one that decides whether the importer may ship. A competitor
 * export has NO `opted_out` column — that is the ordinary shape of the file
 * this feature exists to accept — so a customer who texted STOP last month
 * arrives in it looking exactly like everyone else, and the file's attestation
 * says they agreed. Writing it would put "the workspace states this person
 * consented, today" into an append-only ledger that already holds their
 * revocation, over a carrier block only they can lift. The carrier record is
 * the truth; a spreadsheet is a claim about the past. `opted_out=true` in the
 * file blocks it for the same reason from the other direction: a file that
 * attests everyone agreed and then marks one row opted out has contradicted
 * itself, and the restriction is the half to believe.
 *
 * A row with NO basis and no opt-out — brand new, or one of the contacts a
 * vCard import created before this route asked the question — takes the
 * attestation, which is a genuine first record and does fire the ledger.
 */
function importConsent(
  existing: { consent_at: string | null; consent_source: string | null } | undefined,
  optedOut: { standing: boolean; inFile: boolean },
  importedAt: string,
  userId: string,
): ImportConsent {
  // THE OPT-OUT IS ASKED FIRST, and the order is the whole answer to "why did
  // it say 0 refused?". Asking about the existing basis first made the refusal
  // silent for the exact case this feature was proved on: a carrier STOP always
  // leaves a basis behind, because `thread_inbound_message` stamps
  // `consent_source='inbound_sms'` on the STOP message itself. So a workspace
  // uploading a competitor export containing forty people who had texted STOP
  // was told 0 refused, and every client dutifully showed nothing, because the
  // number they were given was zero.
  //
  // `columns` is `{}` down either branch, so nothing about what gets WRITTEN
  // moves with this order — an existing basis is still never replaced. Only
  // whether the workspace is told changes.
  if (optedOut.standing || optedOut.inFile) {
    // Reported only where the file and the record DISAGREE. A row the uploader
    // themselves marked opted out is not news to them, and a count inflated by
    // rows they already know about is a count they learn to ignore.
    return { columns: {}, refused: optedOut.standing && !optedOut.inFile };
  }
  if (existing && (existing.consent_at !== null || existing.consent_source !== null)) {
    // Nothing was going to be written, so nothing was refused — reporting a
    // refusal here would name rows the import never intended to touch.
    return { columns: {}, refused: false };
  }
  return {
    columns: {
      // The same source a by-hand add writes (§5 D4), because it is the same
      // claim: a member vouching for consent obtained off-platform.
      consent_source: "attested",
      consent_at: importedAt,
      consent_attested_by: userId,
    },
    refused: false,
  };
}

/**
 * The consent basis every one of these phones already has, keyed by phone.
 *
 * Absent from the map = no such contact (a brand-new row). Present = the row
 * exists, and its two consent columns decide whether an import may write its
 * own. Soft-deleted rows are included on purpose: an import resurrects them
 * (`deleted_at: null`), and a contact coming back is not a reason to forget why
 * they agreed in the first place.
 */
async function existingConsentBasis(
  db: Db,
  companyId: string,
  phones: string[],
): Promise<Map<string, { consent_at: string | null; consent_source: string | null }>> {
  const basis = new Map<
    string,
    { consent_at: string | null; consent_source: string | null }
  >();
  for (let i = 0; i < phones.length; i += IMPORT_CHUNK) {
    const chunk = phones.slice(i, i + IMPORT_CHUNK);
    const found = unwrap<
      { phone_e164: string; consent_at: string | null; consent_source: string | null }[]
    >(
      await db
        .from("contacts")
        .select("phone_e164,consent_at,consent_source")
        .eq("company_id", companyId)
        .in("phone_e164", chunk),
      "import pre-check",
    );
    for (const row of found) {
      basis.set(row.phone_e164, {
        consent_at: row.consent_at ?? null,
        consent_source: row.consent_source ?? null,
      });
    }
  }
  return basis;
}

/**
 * Which of these phones this workspace is currently forbidden to text.
 *
 * The question `importConsent` cannot answer on its own, and the reason the
 * importer could manufacture consent over a live STOP: the decision was made by
 * reading `contacts.consent_at` alone, and an opt-out is not written there. It
 * lives in `opt_outs`, keyed on the PHONE rather than the contact, because a
 * STOP can arrive from a number this workspace has no contact for at all — so
 * "does this contact have a consent basis" and "may we text this number" are
 * genuinely two reads.
 *
 * A SET, not a map of sources: every active opt-out refuses the attestation the
 * same way, whoever recorded it. The distinction that does matter — that only
 * the customer can lift a `stop_keyword` — belongs to `revokeOptOut`, and it is
 * unreachable from here because an import never revokes anything.
 *
 * BATCHED in the same IMPORT_CHUNK shape as everything else here. A per-row
 * query would be 2000 round trips inside one Worker request, which is not a
 * check that ships — it is a check that times out and gets removed.
 *
 * Answers the import's OTHER opt-out question too (which phones are already
 * actively opted out, so the file does not re-emit a timeline event for them),
 * which is why this replaces the narrower pre-check rather than joining it: two
 * reads of the same table in one request that could disagree is a bug waiting
 * to be written.
 */
async function standingOptOuts(
  db: Db,
  companyId: string,
  phones: string[],
): Promise<Set<string>> {
  const standing = new Set<string>();
  for (let i = 0; i < phones.length; i += IMPORT_CHUNK) {
    const chunk = phones.slice(i, i + IMPORT_CHUNK);
    const found = unwrap<{ phone_e164: string }[]>(
      await db
        .from("opt_outs")
        .select("phone_e164")
        .eq("company_id", companyId)
        // Active only. A revoked row is a customer who texted START, and
        // holding that against them forever would make the import the one path
        // that never lets anybody back in.
        .is("revoked_at", null)
        .in("phone_e164", chunk),
      "import opt-out pre-check",
    );
    for (const row of found) standing.add(row.phone_e164);
  }
  return standing;
}

/**
 * Which of these phones this workspace has ALREADY been told about — i.e. which
 * ones already carry an `opted_out` timeline event.
 *
 * #248 round 2 (B3). The import decided which events to emit by comparing the
 * file against the opt-out state read BEFORE its own writes, so the announcement
 * could be lost permanently: an import that wrote 250 opt-outs and then died at
 * the contacts upsert left those numbers standing, and the re-run — the recovery
 * procedure this route tells people to use — saw them as already opted out and
 * emitted nothing. The data recovered. The audit trail could not, ever, because
 * the state change it keyed on had already happened.
 *
 * Asking what has been ANNOUNCED instead of what has CHANGED is what makes the
 * re-run repair it: the question is answered from durable state rather than from
 * a diff that only existed during the first attempt.
 *
 * Only asked about phones the pre-write read already found standing — the ones
 * this import is genuinely turning on are new by definition, and on the ordinary
 * import that set is empty and this costs nothing. Backed by a partial index on
 * (company_id, payload->>'phone_e164') where type = 'opted_out'.
 */
async function announcedOptOuts(
  db: Db,
  companyId: string,
  phones: string[],
): Promise<Set<string>> {
  const announced = new Set<string>();
  for (let i = 0; i < phones.length; i += IMPORT_CHUNK) {
    const chunk = phones.slice(i, i + IMPORT_CHUNK);
    const found = unwrap<{ payload: { phone_e164?: string } | null }[]>(
      await db
        .from("conversation_events")
        .select("payload")
        .eq("company_id", companyId)
        .eq("type", "opted_out")
        .in("payload->>phone_e164", chunk),
      "import opt-out event pre-check",
    );
    for (const row of found) {
      const phone = row.payload?.phone_e164;
      if (phone) announced.add(phone);
    }
  }
  return announced;
}

/**
 * The opt-outs an import writes BEFORE it writes any contact.
 *
 * Extracted (#248 round 3) because the vCard door needs it too. That door used
 * to have no way of lowering anybody's standing at all — a `CATEGORIES:DNC`
 * card had nowhere to go even once somebody read it — and a second hand-written
 * copy of this transition is how one of them would eventually stop matching the
 * other on the detail that matters.
 *
 * AN IMPORT MAY ADD AN OPT-OUT; IT MAY NEVER REWRITE ONE THAT IS STANDING.
 * There is a single opt_outs row per (company, phone), so a plain upsert
 * overwrote `source` on an ACTIVE row: a carrier STOP became source='import',
 * and the revoke guard that makes a STOP unrevokable stopped firing. The app
 * would then let someone "opt them back in" while the carrier block stood, so
 * every send failed 40300 against a contact the UI showed as textable. Only the
 * customer can lift a STOP.
 *
 * Same two-step transition the manual opt-out route uses: revive a REVOKED row,
 * otherwise insert and let an existing active row win. Both steps are
 * idempotent, which is what makes re-uploading the file the whole recovery
 * procedure.
 */
async function writeImportOptOuts(
  db: Db,
  companyId: string,
  userId: string,
  phones: readonly string[],
): Promise<void> {
  if (phones.length === 0) return;
  for (let i = 0; i < phones.length; i += IMPORT_CHUNK) {
    const chunk = phones.slice(i, i + IMPORT_CHUNK);
    unwrap(
      await db
        .from("opt_outs")
        .update({ source: "import", created_by: userId, revoked_at: null })
        .eq("company_id", companyId)
        .in("phone_e164", chunk)
        .not("revoked_at", "is", null)
        .select("id"),
      "import opt-out revive",
    );
  }
  for (let i = 0; i < phones.length; i += IMPORT_CHUNK) {
    const rows = phones.slice(i, i + IMPORT_CHUNK).map((phone) => ({
      company_id: companyId,
      phone_e164: phone,
      source: "import",
      created_by: userId,
      revoked_at: null,
    }));
    unwrap(
      await db
        .from("opt_outs")
        .upsert(rows, {
          onConflict: "company_id,phone_e164",
          // An active row is left exactly as it is, whatever its source.
          ignoreDuplicates: true,
        })
        .select("id"),
      "import opt-out insert",
    );
  }
}

/**
 * The timeline half of the same act, which needs the contact ids and so comes
 * after the contacts exist — a record of the block, after the block itself.
 *
 * Extracted alongside `writeImportOptOuts` and for the same reason: whichever
 * door wrote the restriction owes the workspace the announcement.
 */
async function announceImportOptOuts(
  db: Db,
  companyId: string,
  userId: string,
  phones: readonly string[],
  contactIdByPhone: Map<string, string>,
): Promise<void> {
  if (phones.length === 0) return;
  // Attach each event to the contact's most recent conversation when one
  // exists (SPEC §6 conversation_events rule), else null.
  const contactIds = phones
    .map((phone) => contactIdByPhone.get(phone))
    .filter((id): id is string => id !== undefined);
  const latestByContact = new Map<string, string>();
  for (let i = 0; i < contactIds.length; i += IMPORT_CHUNK) {
    const chunk = contactIds.slice(i, i + IMPORT_CHUNK);
    const conversations = unwrap<{ id: string; contact_id: string }[]>(
      await db
        .from("conversations")
        .select("id,contact_id")
        .eq("company_id", companyId)
        .in("contact_id", chunk)
        .order("last_message_at", { ascending: false })
        .order("id", { ascending: false }),
      "import conversations lookup",
    );
    for (const row of conversations) {
      if (!latestByContact.has(row.contact_id)) {
        latestByContact.set(row.contact_id, row.id);
      }
    }
  }
  const events: ConversationEventRow[] = phones.map((phone) => {
    const contactId = contactIdByPhone.get(phone);
    return {
      company_id: companyId,
      conversation_id: (contactId && latestByContact.get(contactId)) || null,
      actor_user_id: userId,
      type: "opted_out",
      payload: { phone_e164: phone, source: "import" },
    };
  });
  await insertConversationEvents(db, events);
}

/**
 * Group upsert rows so every row in one PostgREST request carries identical
 * keys.
 *
 * PostgREST derives the column list from the FIRST row of a batch, so a batch
 * of mixed shapes silently drops whatever the first row happened not to have.
 * The importer used to hand-split on the one key that varied (`name`); it now
 * varies on four (`name`, and the three consent columns, which are written only
 * for contacts with no basis yet), and a hand-written split of every
 * combination is a bug waiting for the next optional column. Grouping by the
 * key set itself cannot go stale.
 */
function groupByKeySet(
  rows: Record<string, unknown>[],
): Record<string, unknown>[][] {
  const groups = new Map<string, Record<string, unknown>[]>();
  for (const row of rows) {
    const signature = Object.keys(row).sort().join(",");
    const group = groups.get(signature);
    if (group) group.push(row);
    else groups.set(signature, [row]);
  }
  return [...groups.values()];
}

/**
 * Reset the geocode cache (D25) when a contact's address is written, so the
 * geocode-contacts cron re-geocodes the row (the cron never diffs addresses —
 * it re-picks up any row with geocode_status='pending'). Uses the committed
 * geocode_status vocabulary (migration 20260702060000): an address present →
 * 'pending' (queue for geocoding); an address cleared to null → 'no_address'
 * (terminal, no map pin). lat/lng/geocoded_at are cleared either way.
 */
function geocodeReset(address: string | null): Record<string, unknown> {
  return {
    lat: null,
    lng: null,
    geocoded_at: null,
    geocode_status: address === null ? "no_address" : "pending",
  };
}

/**
 * #291 — clear the primary flag on a contact's other addresses.
 *
 * Two statements rather than one because the partial unique index refuses two
 * primaries at any instant: promoting before demoting would collide with the
 * row being replaced. Demote first, then set, and the window between them has
 * NO primary rather than two — which the readers already handle, since every
 * contact predating this feature has none.
 */
async function demoteOtherPrimaries(
  db: Db,
  companyId: string,
  contactId: string,
  exceptId?: string,
): Promise<void> {
  let query = db
    .from("contact_addresses")
    .update({ is_primary: false })
    .eq("company_id", companyId)
    .eq("contact_id", contactId)
    .eq("is_primary", true);
  if (exceptId) query = query.neq("id", exceptId);
  unwrap(await query.select("id"), "demote primary addresses");
}

type Db = ReturnType<typeof getDb>;

async function findContact(
  db: Db,
  companyId: string,
  id: string,
): Promise<Record<string, unknown> | null> {
  const rows = unwrap<Record<string, unknown>[]>(
    await db
      .from("contacts")
      .select(CONTACT_COLUMNS)
      .eq("company_id", companyId)
      .eq("id", id)
      .limit(1),
    "contact lookup",
  );
  return rows[0] ?? null;
}

/**
 * #248 round 2 (B4) — what the THIRD attestation door says when it refuses.
 *
 * `PATCH /v1/contacts/:id { consent_attested: true }` wrote
 * `attested / now / this member` with no opt-out check of any kind, over a live
 * `stop_keyword` row, and then read `opt_outs` twelve lines later purely to
 * decorate the response — the fact was already in hand and unused. Both bulk
 * doors were fixed in round one and this one was not, which is how a rule that
 * lives at a call site rather than in one place fails: it gets applied wherever
 * somebody was looking.
 *
 * The whole request is refused rather than the attestation being dropped
 * quietly. This door is a person pressing a button about one customer, and a
 * response that looks like success while the one thing they asked for did not
 * happen is how the record ends up with a hole nobody was told about — the same
 * defect the import's refusal note exists to prevent. A saved name alongside a
 * refused attestation would also make the failure invisible in the UI, so the
 * edit stands or falls whole.
 */
export const CONSENT_ATTEST_REFUSED_OPTED_OUT =
  "This customer has asked this business to stop texting them, so consent " +
  "cannot be recorded against them — only they can lift that, by texting " +
  "START from their own phone. Nothing in this edit was saved.";

/**
 * And the other rule the importer already follows: an existing basis is never
 * replaced. "They texted us first on 12 March" is strong evidence; overwriting
 * it with "Sam says so, today" is weaker evidence AND an unrecordable change —
 * `contacts_record_consent` only fires on the null → value transition, so the
 * ledger cannot even hold the rewrite. `importConsent`'s docblock calls that
 * outcome worse than losing the record. The importer coalesces; this door used
 * to overwrite, on the same three columns, from the same product.
 */
export const CONSENT_ATTEST_ALREADY_RECORDED =
  "This customer's consent is already on record and it stands — recording it " +
  "again would replace what actually happened with today's date. Nothing in " +
  "this edit was saved.";

/** #246: which contact survives the merge. */
const mergeSchema = z.object({ into_contact_id: z.uuid() });

/**
 * #291 — one of a contact's addresses.
 *
 * The label is free text on purpose. A fixed vocabulary ("Home", "Work") is
 * wrong for the second trade that uses it: a property manager labels by unit,
 * a builder by lot, an HVAC company by which rooftop the plant is on.
 */
const addressSchema = z.object({
  label: z.string().trim().min(1).max(80).nullable().optional(),
  address: z.string().trim().min(1).max(500),
  is_primary: z.boolean().optional(),
});

const ADDRESS_CAP = 50;

/**
 * #291 — how many OTHER numbers one contact may hold.
 *
 * Lower than the address cap on purpose. A property manager plausibly has
 * forty buildings; nobody has forty phone numbers, and a contact that did
 * would be a merge that went wrong (#246) rather than a customer.
 */
const CONTACT_PHONE_CAP = 8;

export const contactsRoutes = new Hono<AppEnv>();

/**
 * The `or` filter for a contact text search: name, the query as typed, and the
 * query's digits on their own.
 *
 * A number is stored E.164 (+16478923862) but READ, spoken, texted and
 * DISPLAYED with punctuation, so matching only the raw string misses every
 * human spelling of it. This product's own screens show "(647) 892-3862", and
 * pasting that back used to find nothing. Matching digits works as a plain
 * substring because the stored value carries no punctuation of its own.
 *
 * Three digits is the floor: a shorter fragment matches most of a contact list.
 */
export function contactSearchOr(rawQ: string, t9 = false): string {
  const q = orIlikeValue(rawQ);
  // #291: business name and email join the arm, because the whole complaint
  // is that this knowledge is unfindable. "Maple" should find Dave at Maple
  // Property Group, and a half-remembered email is often the only thing
  // somebody has to go on.
  const terms = [
    `name.ilike.*${q}*`,
    `phone_e164.ilike.*${q}*`,
    `business_name.ilike.*${q}*`,
    `email.ilike.*${q}*`,
    // #291: what is IN the workspace's own fields — the boiler serial, the
    // gate code, the lot number. `custom_values` is a derived column holding
    // the VALUES only; searching the raw JSON would match every contact that
    // merely HAS a field, blank ones included.
    `custom_values.ilike.*${q}*`,
  ];
  const digits = rawQ.replace(/\D/g, "");
  if (digits.length >= 3 && digits !== q) {
    terms.push(`phone_e164.ilike.*${digits}*`);
  }
  // #459: the dialer asks for this explicitly and the contacts search box never
  // does. Typing "416" in a search box means an area code, and quietly also
  // returning every name whose keypad letters spell 416 would make a text
  // search answer a question nobody asked. On a keypad it is the whole point.
  //
  // Two patterns, because the match rule is per-word: the first word, and any
  // later one. Matching mid-word would find "Alaska" for L-A-S, and a list that
  // returns names nobody typed is one people stop reading.
  if (t9 && digits.length >= T9_MIN_DIGITS && digits === rawQ) {
    terms.push(`name_t9.ilike.${digits}*`, `name_t9.ilike.* ${digits}*`);
  }
  return terms.join(",");
}

/**
 * Fewest digits that will run a name search. Two, because two letters is a
 * normal way to reach for somebody and the dialer caps what it shows anyway.
 * Mirrors MIN_NAME_DIGITS in `@loonext/shared`'s dialer matcher, which ranks
 * the same rows once the clients merge in the phone's own address book.
 */
export const T9_MIN_DIGITS = 2;

contactsRoutes.get("/contacts", requireCapability("conversations.read"), async (c) => {
  const limit = parseLimit(c, 25, 100);
  const cursor = parseCursor(c);
  const rawQ = c.req.query("q")?.trim();
  const db = getDb(getEnv(c.env));

  /**
   * #291 — narrow the list to one answer in one of the workspace's own fields.
   *
   * "Everyone on a Combi system", before a parts order. One field at a time
   * rather than a query builder: two conditions combined is a report, and a
   * report is a different screen with different expectations about accuracy.
   *
   * The KEY IS CHECKED against the workspace's definitions. An unknown key
   * filtered to nothing would look like a workspace with no matching
   * customers, and an unknown key IGNORED would look like a filter that does
   * not work — both are worse than a refusal that says which field is missing.
   */
  const filterField = c.req.query("field")?.trim();
  const filterValue = c.req.query("value");
  if (filterField !== undefined && filterField !== "") {
    if (filterValue === undefined) {
      throw new ApiError(
        "validation_failed",
        "field: needs a value to filter on.",
      );
    }
    const defs = unwrap<{ key: string }[]>(
      await db
        .from("contact_field_defs")
        .select("key")
        .eq("company_id", c.get("companyId"))
        .eq("key", filterField)
        .limit(1),
      "contact field definition",
    );
    if (defs.length === 0) {
      throw new ApiError(
        "validation_failed",
        `There is no "${filterField}" field on your contacts.`,
      );
    }
  }

  let query = db
    .from("contacts")
    .select(CONTACT_LIST_COLUMNS)
    .eq("company_id", c.get("companyId"))
    .is("deleted_at", null);
  if (filterField !== undefined && filterField !== "" && filterValue !== undefined) {
    // `->>` so the comparison is against the TEXT of the value. Comparing the
    // jsonb would make "Combi" and "Combi" different answers, and only one of
    // them is what the picker sends.
    query = query.eq(`custom_fields->>${filterField}`, filterValue);
  }
  if (rawQ !== undefined && rawQ !== "") {
    if (rawQ.length > 200) {
      throw new ApiError("validation_failed", "q: too long (max 200).");
    }
    // #459: `t9=1` is the dialer saying "these digits may be a name". Opt-in so
    // the contacts search box keeps meaning exactly what it meant.
    query = query.or(contactSearchOr(rawQ, c.req.query("t9") === "1"));
  }
  if (cursor) {
    query = query.or(keysetFilter("created_at", cursor));
  }
  type ContactListRow = {
    id: string;
    created_at: string;
    phone_e164: string;
    created_by_user_id: string | null;
    updated_by_user_id: string | null;
  };
  const rows = unwrap<ContactListRow[]>(
    await query
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(limit + 1),
    "contacts list",
  );

  /**
   * #291 — and the same search, run through a customer's OTHER numbers.
   *
   * A SECOND QUERY rather than another arm on the `or` above, because
   * PostgREST cannot OR a root column against an embedded one: the arm would
   * have to become an inner join, and an inner join would drop every contact
   * without a second number — which is nearly all of them.
   *
   * Merged rather than truncated. Collecting matching ids and adding
   * `id.in.(…)` to the `or` was the shorter version, and it silently loses
   * whatever falls past the length of a URL: a workspace searching "416" would
   * get an arbitrary subset with no way to tell. Both queries carry the SAME
   * filters, cursor and ordering, so the union's top page is the page.
   *
   * Only for searches with enough digits to be a number. "Dave" costs no extra
   * round trip.
   */
  let merged = rows;
  const searchDigits = rawQ?.replace(/\D/g, "") ?? "";
  if (rawQ && searchDigits.length >= 3) {
    let byOtherNumber = db
      .from("contacts")
      .select(`${CONTACT_LIST_COLUMNS},contact_phones!inner(id)`)
      .eq("company_id", c.get("companyId"))
      .is("deleted_at", null)
      .ilike("contact_phones.phone_e164", `*${searchDigits}*`);
    // The SAME field filter. Without it, filtering to "Combi" and then
    // searching a number would quietly return non-Combi customers through
    // this arm — a filter that holds on one query and not the other is worse
    // than no filter, because the list looks filtered.
    if (filterField !== undefined && filterField !== "" && filterValue !== undefined) {
      byOtherNumber = byOtherNumber.eq(
        `custom_fields->>${filterField}`,
        filterValue,
      );
    }
    if (cursor) {
      byOtherNumber = byOtherNumber.or(keysetFilter("created_at", cursor));
    }
    const alsoRows = unwrap<(ContactListRow & { contact_phones?: unknown })[]>(
      await byOtherNumber
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(limit + 1),
      "contacts list by other number",
    );

    const seen = new Set(rows.map((row) => row.id));
    const extra = alsoRows
      .filter((row) => !seen.has(row.id))
      .map(({ contact_phones: _join, ...row }) => row);
    if (extra.length > 0) {
      merged = [...rows, ...extra].sort((a, b) =>
        a.created_at === b.created_at
          ? b.id.localeCompare(a.id)
          : b.created_at.localeCompare(a.created_at),
      );
      // Back to one page's worth. Both sides were already limited to
      // `limit + 1`, so the union holds at least that many when either did,
      // and `buildPage` still sees the extra row it uses to decide "more".
      merged = merged.slice(0, limit + 1);
    }
  }

  const page = buildPage(merged, limit, "created_at");

  // Three independent per-page decorations — the opted-out badge (G6), last
  // activity (G6), and #191 created/updated actor names — none depends on
  // another, so resolve them in ONE parallel round-trip instead of three
  // serial awaits.
  const listCompanyId = c.get("companyId");
  const optedOutPhones = new Set<string>();
  const lastActivityByContact = new Map<string, string>();
  let actorNames = new Map<string, string>();
  if (page.data.length > 0) {
    const [optOut, activity, resolvedActorNames] = await Promise.all([
      // Opted-out badge: same app-side state as GET /v1/contacts/:id.
      db
        .from("opt_outs")
        .select("phone_e164")
        .eq("company_id", listCompanyId)
        .is("revoked_at", null)
        .in("phone_e164", [
          ...new Set(page.data.map((row) => row.phone_e164)),
        ]),
      // "Last activity" = newest conversations.last_message_at per contact
      // (messages + notes both move it); DESC so first-seen per contact wins.
      db
        .from("conversations")
        .select("contact_id,last_message_at")
        .eq("company_id", listCompanyId)
        .in(
          "contact_id",
          page.data.map((row) => row.id),
        )
        .order("last_message_at", { ascending: false }),
      // #191 attribution: created/updated actor display names for the page.
      resolveActorNames(
        db,
        page.data.flatMap((row) => [
          row.created_by_user_id,
          row.updated_by_user_id,
        ]),
      ),
    ]);
    for (const row of unwrap<{ phone_e164: string }[]>(
      optOut,
      "opt-out lookup",
    )) {
      optedOutPhones.add(row.phone_e164);
    }
    for (const row of unwrap<
      { contact_id: string; last_message_at: string }[]
    >(activity, "contact activity lookup")) {
      if (!lastActivityByContact.has(row.contact_id)) {
        lastActivityByContact.set(row.contact_id, row.last_message_at);
      }
    }
    actorNames = resolvedActorNames;
  }

  return c.json({
    ...page,
    data: page.data.map((row) => ({
      ...row,
      opted_out: optedOutPhones.has(row.phone_e164),
      last_activity_at: lastActivityByContact.get(row.id) ?? null,
      created_by_name: row.created_by_user_id
        ? actorNames.get(row.created_by_user_id) ?? null
        : null,
      updated_by_name: row.updated_by_user_id
        ? actorNames.get(row.updated_by_user_id) ?? null
        : null,
    })),
  });
});

/** Max contacts a single export streams (bounds Worker memory/CPU). */
const EXPORT_MAX_ROWS = 50_000;

/**
 * Export column order — round-trips with the CSV importer (D20 §3.1).
 *
 * Exported (#248 round 3) so the round-trip guard exports, re-imports and
 * compares against the ONE list rather than a copy of it retyped into a test.
 */
export const EXPORT_HEADER = [
  "name",
  "phone",
  "tags",
  "consent_source",
  "consent_at",
  "created_at",
] as const;

/**
 * GET /v1/contacts/export (D20 §3.1) — stream a UTF-8 CSV (BOM for Excel) of
 * the company's contacts respecting the current `q` filter ("export what I'm
 * looking at"), excluding soft-deleted. Any member (read-only visibility). The
 * `tags` column carries the contact's conversation tags, ';'-joined, so the
 * export round-trips with the importer's columns.
 *
 * Registered before `/contacts/:id` so the literal path is never captured by
 * the param route.
 */
contactsRoutes.get("/contacts/export", requireCapability("conversations.read"), async (c) => {
  const companyId = c.get("companyId");
  const rawQ = c.req.query("q")?.trim();
  const db = getDb(getEnv(c.env));

  let query = db
    .from("contacts")
    .select("id,name,phone_e164,consent_source,consent_at,created_at")
    .eq("company_id", companyId)
    .is("deleted_at", null);
  if (rawQ !== undefined && rawQ !== "") {
    if (rawQ.length > 200) {
      throw new ApiError("validation_failed", "q: too long (max 200).");
    }
    query = query.or(contactSearchOr(rawQ));
  }
  interface ExportRow {
    id: string;
    name: string | null;
    phone_e164: string;
    consent_source: string | null;
    consent_at: string | null;
    created_at: string;
  }
  const rows = unwrap<ExportRow[]>(
    await query
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(EXPORT_MAX_ROWS),
    "contacts export",
  );

  // Tags live per-CONVERSATION (there is no contact_tags table); a contact's
  // tags = the union of tags across its conversations. Chunk the lookup: a
  // single .in() over up to EXPORT_MAX_ROWS (50k) contact UUIDs would build a
  // multi-megabyte URL that PostgREST / the Worker rejects, breaking the export
  // outright for exactly the largest customers. IMPORT_CHUNK (200) keeps each
  // request's URL small — the same bound the CSV importer already uses.
  const tagsByContact = new Map<string, Set<string>>();
  interface TagJoinRow {
    contact_id: string;
    conversation_tags: { tags: { name: string } | null }[];
  }
  const exportContactIds = rows.map((row) => row.id);
  for (let i = 0; i < exportContactIds.length; i += IMPORT_CHUNK) {
    const chunk = exportContactIds.slice(i, i + IMPORT_CHUNK);
    const joins = unwrap<TagJoinRow[]>(
      await db
        .from("conversations")
        .select("contact_id,conversation_tags(tags(name))")
        .eq("company_id", companyId)
        .in("contact_id", chunk),
      "contacts export tags",
    );
    for (const join of joins) {
      const set = tagsByContact.get(join.contact_id) ?? new Set<string>();
      for (const entry of join.conversation_tags ?? []) {
        if (entry.tags?.name) set.add(entry.tags.name);
      }
      tagsByContact.set(join.contact_id, set);
    }
  }

  const table: (string | null)[][] = [
    [...EXPORT_HEADER],
    ...rows.map((row) => [
      // Guarded against CSV/formula injection: a value beginning with =+-@ is
      // apostrophe-prefixed so a spreadsheet treats it as text.
      //
      // The phone needs this MORE than the free text does, not less. Every
      // stored number is E.164, so every one of them starts with "+", which
      // Excel and Sheets evaluate as arithmetic: +16478923862 opened as a
      // number reads 1.6478E+10, and the country code is gone from what the
      // user sees and from anything they copy out to dial. Exporting for a
      // spreadsheet is the whole point of the BOM below.
      //
      // The round trip still holds: our own importer normalizes by stripping
      // every non-digit, so the guard character is discarded on the way back in.
      csvSafeText(row.name),
      csvSafeText(row.phone_e164),
      csvSafeText([...(tagsByContact.get(row.id) ?? [])].join(";")),
      row.consent_source,
      row.consent_at,
      row.created_at,
    ]),
  ];
  // UTF-8 BOM (D20 §3.1) so Excel reads the encoding correctly. Emit the body
  // as bytes with a literal EF BB BF prefix: `new Response(string)` would strip
  // a leading U+FEFF, so the BOM must be raw bytes, not a string char.
  // #345/#231: "a contact export is the departing-employee signature." The
  // audit row is the record; the alarm below is the only proactive thing in the
  // audit system, because nobody reads a history screen on an ordinary Tuesday.
  //
  // The COUNT and whether a filter was applied — never the rows. This is the
  // one audit entry describing an action whose whole subject is customer data,
  // so it says how much moved and nothing about who.
  const exportedCount = Math.max(table.length - 1, 0);
  await recordAuditFromRequest(db, c, {
    companyId,
    action: "contacts.exported",
    targetType: "contact",
    after: { count: exportedCount, filtered: Boolean(rawQ) },
  });
  alarmOnBulkContactAccess(c, getEnv(c.env), db, {
    companyId,
    actorUserId: c.get("userId"),
    event: "exported",
    count: exportedCount,
  });
  const csvBytes = new TextEncoder().encode(serializeCsv(table));
  const body = new Uint8Array(csvBytes.length + 3);
  body.set([0xef, 0xbb, 0xbf], 0);
  body.set(csvBytes, 3);
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="contacts.csv"',
    },
  });
});

contactsRoutes.post("/contacts", requireCapability("conversations.note"), async (c) => {
  const body = await parseJsonBody(c, createSchema);
  const phone = normalizeNanpPhone(body.phone_e164);
  if (!phone) {
    throw new ApiError(
      "validation_failed",
      "phone_e164: must be a US or Canada number (E.164, assigned area code).",
    );
  }

  const db = getDb(getEnv(c.env));
  const companyId = c.get("companyId");
  const userId = c.get("userId");

  // Shared column writes (both the insert and the update path set these).
  const fields: Record<string, unknown> = {};
  if (body.name !== undefined) fields.name = body.name;
  if (body.notes !== undefined) fields.notes = body.notes;
  // #291. Explicit rather than spread, like every field above it: this object
  // becomes a database write, and spreading a request body into one is how a
  // column nobody meant to expose becomes writable.
  if (body.email !== undefined) fields.email = body.email;
  if (body.business_name !== undefined) {
    fields.business_name = body.business_name;
  }
  if (body.address !== undefined) {
    fields.address = body.address;
    // A new/resurrected/edited address needs geocoding (D25).
    Object.assign(fields, geocodeReset(body.address));
  }

  // Re-adding an EXISTING live contact is an UPDATE, not a create: preserve
  // created_by_user_id (who first added them) and record updated_by_user_id,
  // instead of the upsert overwriting created_by with the current caller and
  // never stamping updated_by (#191 attribution). A soft-deleted or brand-new
  // number still takes the upsert (resurrect / insert) with a fresh created_by.
  const existing = unwrap<{ id: string; deleted_at: string | null }[]>(
    await db
      .from("contacts")
      .select("id,deleted_at")
      .eq("company_id", companyId)
      .eq("phone_e164", phone)
      .limit(1),
    "contact lookup",
  );
  const live = existing[0]?.deleted_at === null ? existing[0] : null;

  const rows = live
    ? unwrap<Record<string, unknown>[]>(
        await db
          .from("contacts")
          .update({ ...fields, updated_by_user_id: userId })
          .eq("id", live.id)
          .select(CONTACT_COLUMNS),
        "contact update",
      )
    : unwrap<Record<string, unknown>[]>(
        await db
          .from("contacts")
          .upsert(
            {
              company_id: companyId,
              phone_e164: phone,
              deleted_at: null,
              created_by_user_id: userId,
              ...fields,
            },
            { onConflict: "company_id,phone_e164" },
          )
          .select(CONTACT_COLUMNS),
        "contact upsert",
      );
  return c.json(rows[0], 201);
});

/**
 * #324 — one chronology of everything done for this customer.
 *
 * D7's threading rule means a long relationship is MANY conversations: a
 * customer returning after 31 days starts a new one, so a homeowner serviced
 * once a year for six years is six threads. The prior-conversations list (G6)
 * and the per-contact call history (#205) both already existed, as separate
 * blocks with tasks nowhere — so "what have we done for this customer?", the
 * question asked before every visit, still meant opening threads one at a time.
 *
 * Paginated with the shared opaque cursor (SPEC §7/D10), like every other list.
 *
 * The first cut took a raw `before` timestamp, which was wrong twice over. The
 * ordering is `(occurred_at, id)` but a timestamp-only predicate SKIPS the
 * second of any two entries sharing a timestamp — which a call threading a
 * message produces. And a Postgres timestamptz carries a literal `+`, which
 * `URLComponents` does not escape and Hono decodes as a space, so every iOS
 * "Show earlier" came back 422. base64url exists to avoid exactly that.
 */
/**
 * #246 — GET /v1/contacts/duplicates: the likely duplicates, without anybody
 * having to know they exist.
 *
 * Two signals, both explainable to the person reading the result: the same
 * name, or the same ten digits reached by different prefix habits. Anything
 * cleverer produces pairs a crew cannot judge, and a suggestion somebody cannot
 * verify is one they learn to dismiss.
 *
 * Member-readable, matching the contact list itself: seeing that two records
 * are one customer is not a privileged fact, and the crew member who notices is
 * usually the one who caused it.
 */
contactsRoutes.get(
  "/contacts/duplicates",
  requireCapability("conversations.read"),
  async (c) => {
    const db = getDb(getEnv(c.env));
    const rows = unwrap<unknown[]>(
      await db.rpc("api_duplicate_contacts", {
        p_company_id: c.get("companyId"),
      }),
      "duplicate contacts",
    );
    return c.json({ data: rows, next_cursor: null });
  },
);

contactsRoutes.get("/contacts/:id/timeline", requireCapability("conversations.read"), async (c) => {
  const id = pathUuid(c, "id");
  const companyId = c.get("companyId");
  const db = getDb(getEnv(c.env));

  // 404 before the timeline: a caller must not be able to probe which contact
  // ids exist in another workspace by the shape of an empty result.
  const contact = await findContact(db, companyId, id);
  if (!contact) {
    return errorResponse(c, "not_found", "No such contact.");
  }

  const limit = parseLimit(c, 50, 200);
  const cursor = parseCursor(c);

  const { data, error } = await db.rpc("api_contact_timeline", {
    p_company_id: companyId,
    p_contact_id: id,
    p_limit: limit,
    p_before_ts: cursor?.ts ?? null,
    p_before_id: cursor?.id ?? null,
  });
  if (error) throw new Error(`contact timeline failed: ${error.message}`);

  const entries = await withCallAnswerers(
    db,
    companyId,
    (data ?? []) as { occurred_at: string; id: string; kind?: string }[],
  );
  const last = entries[entries.length - 1];
  return c.json({
    entries,
    // Null at the end of the history, which is how a client knows to stop.
    next_cursor:
      entries.length === limit && last
        ? encodeCursor({ ts: last.occurred_at, id: last.id })
        : null,
  });
});

/**
 * #517 — name the answerer on this chronology's call rows too.
 *
 * The thread and the contact page render the same call, and a product that
 * says "Call answered by Sam" in one and "Call answered" in the other has only
 * half-answered the question. A `call` entry's own `id` IS the call id (the
 * read-model's call arm selects `k.id`), so the same read-time join works here
 * with no change to `api_contact_timeline` — which is a fixed-arity union and
 * would otherwise need every arm widened to carry one nullable column.
 */
async function withCallAnswerers<
  T extends { id: string; kind?: string },
>(
  db: ReturnType<typeof getDb>,
  companyId: string,
  entries: T[],
): Promise<T[]> {
  const callIds = entries
    .filter((entry) => entry.kind === "call")
    .map((entry) => entry.id);
  if (callIds.length === 0) return entries;

  const answerers = await answerersByCall(db, companyId, "id", callIds);
  if (answerers.size === 0) return entries;

  return entries.map((entry) => {
    const answeredBy =
      entry.kind === "call" ? answerers.get(entry.id) : undefined;
    return answeredBy ? { ...entry, answered_by_user_id: answeredBy } : entry;
  });
}

/**
 * #410 — two facts about the relationship, derived rather than stored.
 *
 * A count and a first date, and deliberately nothing else. The issue is
 * explicit that scores, segments and lifetime value are judgements the product
 * refuses to make, while "how long have they been a customer" is an
 * observation the data already contains.
 *
 * CONVERSATIONS, NOT MESSAGES. A chatty customer is not a loyal one, and a
 * message count would mislead in exactly the situation this exists to inform.
 *
 * Derived server-side so all three clients agree. Four surfaces each counting
 * for themselves is four counts that will eventually disagree (#392, #376).
 *
 * Number access applies: a member who cannot see a number must not learn the
 * customer's history through a count that includes it (#106/D88). The deny
 * list is the same one the conversation list filters on.
 */
async function contactRelationship(
  db: SupabaseClient,
  args: { companyId: string; contactId: string; hiddenNumberIds: string[] | null },
): Promise<{ conversation_count: number; first_conversation_at: string | null }> {
  // The deny list, as a PostgREST filter value. Empty means unrestricted, and
  // the filter is simply not applied.
  const hidden = args.hiddenNumberIds ?? [];
  const denied = hidden.length > 0 ? `(${hidden.join(",")})` : null;

  try {
    // Both scopes are written out at each call site rather than shared through
    // a helper, deliberately: #347's scope checker reads the statement text,
    // and a query whose company_id arrives via a closure is one it cannot see
    // and would exempt silently.
    //
    // A head count and one row, rather than reading every conversation to
    // length an array — a long-standing customer is exactly the case that
    // would make that expensive, and they are the case this exists for.
    let countQuery = db
      .from("conversations")
      .select("id", { count: "exact", head: true })
      .eq("company_id", args.companyId)
      .eq("contact_id", args.contactId);
    if (denied) countQuery = countQuery.not("phone_number_id", "in", denied);

    let firstQuery = db
      .from("conversations")
      .select("created_at")
      .eq("company_id", args.companyId)
      .eq("contact_id", args.contactId)
      .order("created_at", { ascending: true })
      .limit(1);
    if (denied) firstQuery = firstQuery.not("phone_number_id", "in", denied);

    const [counted, earliest] = await Promise.all([countQuery, firstQuery]);
    if (counted.error) {
      throw new Error(`contact conversation count failed: ${counted.error.message}`);
    }
    const firstRows = unwrap<{ created_at: string }[]>(
      earliest,
      "contact first conversation",
    );

    return {
      conversation_count: counted.count ?? 0,
      first_conversation_at: firstRows[0]?.created_at ?? null,
    };
  } catch (cause) {
    // A summary is decoration. The contact panel failing to open because a
    // count query failed would be a bad trade, and "no history" reads as a
    // first-time caller — which is the safe direction to be wrong in.
    //
    // Number access is resolved OUTSIDE this, on purpose: if that fails the
    // request must fail loudly, because the alternative is a count that
    // silently includes numbers the member is kept off.
    console.error(
      `contact relationship for ${args.contactId} failed:`,
      cause instanceof Error ? cause.message : String(cause),
    );
    return { conversation_count: 0, first_conversation_at: null };
  }
}

contactsRoutes.get("/contacts/:id", requireCapability("conversations.read"), async (c) => {
  const id = pathUuid(c, "id");
  const companyId = c.get("companyId");
  const db = getDb(getEnv(c.env));

  const contact = await findContact(db, companyId, id);
  if (!contact) {
    return errorResponse(c, "not_found", "No such contact.");
  }

  // #291: the addresses ride the detail rather than a second endpoint. A
  // contact panel that had to ask twice would paint the record and then the
  // addresses a moment later, and "where is this job" is not a detail somebody
  // should watch arrive.
  const addresses = unwrap<Record<string, unknown>[]>(
    await db
      .from("contact_addresses")
      .select("id,label,address,is_primary,created_at")
      .eq("company_id", companyId)
      .eq("contact_id", id)
      .order("is_primary", { ascending: false })
      .order("created_at", { ascending: true })
      .limit(ADDRESS_CAP),
    "contact addresses",
  );

  // #291: and the other numbers, on the same read and for the same reason.
  // Oldest first — the order they were recorded is the order the crew thinks
  // of them in, and there is no primary among them: the contact's own
  // `phone_e164` is the primary, and it is on the record above.
  const phones = unwrap<Record<string, unknown>[]>(
    await db
      .from("contact_phones")
      .select("id,phone_e164,label,created_at")
      .eq("company_id", companyId)
      .eq("contact_id", id)
      .order("created_at", { ascending: true })
      .limit(CONTACT_PHONE_CAP),
    "contact phones",
  );

  const optOuts = unwrap<{ id: string; source: string }[]>(
    await db
      .from("opt_outs")
      .select("id,source")
      .eq("company_id", companyId)
      .eq("phone_e164", contact.phone_e164 as string)
      .is("revoked_at", null)
      .limit(1),
    "opt-out lookup",
  );
  // #191 attribution: resolve the created/updated actor names (null for older,
  // actor-less rows — the UI shows the attribution line only when it resolves).
  const createdBy = contact.created_by_user_id as string | null;
  const updatedBy = contact.updated_by_user_id as string | null;
  const access = await resolveNumberAccess(db, {
    companyId,
    userId: c.get("userId"),
    role: c.get("role"),
  });
  const [actorNames, clock, relationship] = await Promise.all([
    resolveActorNames(db, [createdBy, updatedBy]),
    // #292/D49: what time it is where they are, resolved the same way a send
    // resolves it. The screen showing "9:00 AM their time" and the gate that
    // decides whether a send needs confirming must not be able to disagree.
    resolveDestinationClock(db, {
      companyId,
      phoneE164: contact.phone_e164 as string,
      contactTimezone: (contact.timezone as string | null) ?? null,
    }),
    // #410: how long they have been a customer, and how often. Two facts,
    // not a profile.
    contactRelationship(db, {
      companyId,
      contactId: id,
      hiddenNumberIds: access.hiddenNumberIds,
    }),
  ]);
  return c.json({
    ...contact,
    // The resolved clock, and which rung of the ladder answered — so the UI
    // can say "from their area code" or "using your timezone" rather than
    // presenting a guess as a fact.
    timezone_resolved: clock.timezone,
    timezone_source: clock.source,
    local_hour: clock.localHour,
    opted_out: optOuts.length > 0,
    // Which kind of opt-out it is, because only one of them can be undone from
    // in here: 'stop_keyword' is a carrier-level block the customer created and
    // only the customer can clear. Null when they are not opted out.
    opt_out_source: (optOuts[0]?.source as string | undefined) ?? null,
    // #410: the relationship, summarised. Absent history reads as a
    // first-time caller, which is what it is.
    conversation_count: relationship.conversation_count,
    first_conversation_at: relationship.first_conversation_at,
    created_by_name: createdBy ? actorNames.get(createdBy) ?? null : null,
    updated_by_name: updatedBy ? actorNames.get(updatedBy) ?? null : null,
    // #291: primary first, then oldest. An empty list is the honest answer for
    // every contact that predates this — `contacts.address` still holds their
    // one address and still works.
    addresses,
    // #291: the OTHER numbers. Empty for nearly every contact, and that is the
    // honest answer rather than a gap: most customers have one line.
    phones,
  });
});

/**
 * #291 — values checked against the definitions that exist RIGHT NOW.
 *
 * The check is against the live definitions rather than a snapshot on the
 * client, because a field deleted five minutes ago would otherwise keep
 * accepting values from a screen nobody had reloaded — and those values would
 * be invisible the moment they landed.
 *
 * Unknown keys are REJECTED rather than dropped. Dropping them silently is the
 * failure mode where somebody types the gate code into a stale form, sees it
 * save, and comes back tomorrow to an empty field.
 */
async function validateCustomFields(
  db: ReturnType<typeof getDb>,
  companyId: string,
  values: Record<string, string>,
): Promise<Record<string, string>> {
  const keys = Object.keys(values);
  if (keys.length === 0) return {};

  const defs = unwrap<Record<string, unknown>[]>(
    await db
      .from("contact_field_defs")
      .select("key,label,kind,options")
      .eq("company_id", companyId),
    "contact field definitions",
  );
  const byKey = new Map(defs.map((def) => [def.key as string, def]));

  for (const key of keys) {
    const def = byKey.get(key);
    if (!def) {
      throw new ApiError(
        "validation_failed",
        `There is no "${key}" field on your contacts.`,
      );
    }
    const reason = contactFieldValueError(
      {
        kind: def.kind as ContactFieldKind,
        options: (def.options as string[] | null) ?? null,
        label: def.label as string,
      },
      values[key],
    );
    if (reason) throw new ApiError("validation_failed", `${reason}.`);
  }
  return values;
}

contactsRoutes.patch("/contacts/:id", requireCapability("conversations.note"), async (c) => {
  const id = pathUuid(c, "id");
  const body = await parseJsonBody(c, patchSchema);
  const companyId = c.get("companyId");
  const userId = c.get("userId");
  const db = getDb(getEnv(c.env));

  const contact = await findContact(db, companyId, id);
  if (!contact) {
    return errorResponse(c, "not_found", "No such contact.");
  }

  const patch: Record<string, unknown> = {};
  if ("name" in body) patch.name = body.name ?? null;
  if ("address" in body) {
    const nextAddress = body.address ?? null;
    patch.address = nextAddress;
    // Address write → re-geocode (a null address becomes 'no_address') (D25).
    Object.assign(patch, geocodeReset(nextAddress));
  }
  if ("notes" in body) patch.notes = body.notes ?? null;
  // #291: `in` rather than `!== undefined`, matching its neighbours — an
  // explicit null is how a field gets CLEARED, and a check that could not tell
  // "absent" from "null" would make the wrong email permanent.
  if ("email" in body) patch.email = body.email ?? null;
  if ("business_name" in body) {
    patch.business_name = body.business_name ?? null;
  }
  // #228: `in` rather than `!== undefined`, for the reason above. An explicit
  // null hands this contact back to the company default, which is a different
  // instruction from "leave the override alone" and has to stay sayable.
  if ("locale" in body) patch.locale = body.locale ?? null;
  if ("custom_fields" in body) {
    patch.custom_fields = await validateCustomFields(
      db,
      companyId,
      body.custom_fields ?? {},
    );
  }
  // #292/D49: null is meaningful here — it clears the correction and goes back
  // to inferring from the area code, which is what you want after fixing a
  // number rather than a person.
  if ("timezone" in body) patch.timezone = body.timezone ?? null;
  if (body.consent_attested === true) {
    patch.consent_source = "attested";
    patch.consent_at = new Date().toISOString();
    patch.consent_attested_by = userId;
  }
  // #191 attribution: any field change (patchSchema guarantees at least one)
  // records who last edited the contact.
  patch.updated_by_user_id = userId;

  // Read ONCE, and used twice: to decide whether an attestation may be recorded
  // at all (#248 B4) and to decorate the response below. It was already being
  // read for the response — the fact this door needed was in the same query all
  // along, one write too late. AFTER the patch is built, so a request that was
  // never going to be valid is still answered without asking the database
  // anything about opt-outs.
  const optOuts = unwrap<{ id: string; source: string }[]>(
    await db
      .from("opt_outs")
      .select("id,source")
      .eq("company_id", companyId)
      .eq("phone_e164", contact.phone_e164 as string)
      .is("revoked_at", null)
      .limit(1),
    "opt-out lookup",
  );

  if (body.consent_attested === true) {
    // An import may lower a contact's standing, never raise it — and neither
    // may anything else. Same rule as `importConsent`, same two reasons, in the
    // same order: the restriction first, because a carrier STOP always leaves a
    // basis behind (`thread_inbound_message` stamps `inbound_sms` on the STOP
    // message itself), so asking about the basis first would answer the wrong
    // question with the wrong sentence.
    if (optOuts.length > 0) {
      throw new ApiError("validation_failed", CONSENT_ATTEST_REFUSED_OPTED_OUT);
    }
    if (contact.consent_at !== null || contact.consent_source !== null) {
      throw new ApiError("validation_failed", CONSENT_ATTEST_ALREADY_RECORDED);
    }
  }

  const rows = unwrap<Record<string, unknown>[]>(
    await db
      .from("contacts")
      .update(patch)
      .eq("company_id", companyId)
      .eq("id", id)
      .select(CONTACT_COLUMNS),
    "contact update",
  );

  if (body.consent_attested === true) {
    await insertConversationEvents(db, [
      {
        company_id: companyId,
        conversation_id: await latestConversationId(db, companyId, id),
        actor_user_id: userId,
        type: "consent_attested",
        payload: { contact_id: id },
      },
    ]);
  }

  // The SAME shape GET /v1/contacts/:id returns, opt-out state included.
  // A client that writes this response into the cache its detail screen renders
  // from would otherwise lose `opted_out` on an ordinary edit, and start
  // offering to opt out someone who already had. Editing a note must not change
  // consent state, even in appearance. Read above, before the write — a PATCH
  // cannot change a contact's phone, so the answer is the same one, and one
  // read that two decisions share cannot disagree with itself.
  return c.json({
    ...rows[0],
    opted_out: optOuts.length > 0,
    opt_out_source: (optOuts[0]?.source as string | undefined) ?? null,
  });
});

contactsRoutes.delete("/contacts/:id", requireCapability("conversations.note"), async (c) => {
  const id = pathUuid(c, "id");
  const db = getDb(getEnv(c.env));
  const rows = unwrap<{ id: string }[]>(
    await db
      .from("contacts")
      // #191 attribution: record who soft-deleted the contact.
      .update({
        deleted_at: new Date().toISOString(),
        deleted_by_user_id: c.get("userId"),
      })
      .eq("company_id", c.get("companyId"))
      .eq("id", id)
      .select("id"),
    "contact soft delete",
  );
  if (rows.length === 0) {
    return errorResponse(c, "not_found", "No such contact.");
  }
  return c.body(null, 204);
});

/** CSV import (SPEC §7) — owner/admin per the §10 matrix. */
contactsRoutes.post(
  "/contacts/import",
  requireCapability("contacts.bulk"),
  async (c) => {
    // #36: declared-size gate BEFORE formData() buffers the whole body (§10).
    assertBodyWithinLimit(c, MAX_CSV_IMPORT_BODY_BYTES);
    // #248: and before we buffer it, whether this workspace may import at all
    // right now. A limiter checked after the read is a limiter that still paid
    // for the read.
    await assertImportWithinRateLimit(getEnv(c.env), c.get("companyId"));
    let form: FormData;
    try {
      form = await c.req.raw.formData();
    } catch {
      throw new ApiError(
        "validation_failed",
        "Request must be multipart/form-data with a `file` field.",
      );
    }
    const file = form.get("file") as unknown as
      | string
      | { text(): Promise<string> }
      | null;
    if (file === null) {
      throw new ApiError("validation_failed", "file: missing CSV file field.");
    }

    // #226: an import cannot complete without a stated consent basis.
    //
    // Every other way a contact enters this product records WHY we may text
    // them — an inbound text stamps `inbound_sms` automatically, and adding
    // one by hand requires the §5 attestation checkbox. Import was the one
    // door with no question at all, and it is the highest-volume door: a
    // thousand numbers arriving with no recorded basis is exactly the file a
    // plaintiff's lawyer or a carrier audit asks about.
    assertConsentAttested(form);
    const text = typeof file === "string" ? file : await file.text();
    if (text.length > CONTACT_IMPORT_MAX_BYTES) {
      throw new ApiError(
        "validation_failed",
        `file: too large (max ${CONTACT_IMPORT_MAX_BYTES / (1024 * 1024)} MB).`,
      );
    }
    // Before the parser touches it: a UTF-16 save decodes into text full of NUL
    // bytes, which parsed into plausible-looking rows and died at Postgres as a
    // 500 (#248 H5).
    assertDecodableText(text);

    let parsed: CsvRow[];
    try {
      parsed = parseCsvRows(text);
    } catch (cause) {
      // An unterminated quote swallows every following row to EOF, and the
      // import used to answer 200 with ordinary counts and no error row for the
      // contacts it ate. Refused whole, naming the line, because the parser
      // cannot say which rows it lost — see CsvUnterminatedQuoteError.
      if (cause instanceof CsvUnterminatedQuoteError) {
        throw new ApiError(
          "validation_failed",
          contactImportUnterminatedQuoteMessage(cause.line),
        );
      }
      throw cause;
    }
    const rows = parsed.map((row) => row.cells);
    if (rows.length < 2) {
      throw new ApiError(
        "validation_failed",
        "file: CSV must have a header row and at least one data row.",
      );
    }
    const headers = rows[0].map((cell) => cell.trim());
    const dataRows = parsed.slice(1);
    // THE ROW CAP RUNS FIRST, and the ordering is a guarantee rather than a
    // preference: everything below walks every cell of every row, and this is
    // what bounds that walk. Moving it down turns a refused file into work we
    // did anyway.
    if (dataRows.length > IMPORT_MAX_ROWS) {
      throw new ApiError(
        "validation_failed",
        `file: too many rows (max ${IMPORT_MAX_ROWS}).`,
      );
    }
    // #248 round 3: every column of this file is now answered for, by index,
    // before anything else happens — and the answer is where the MAPPING comes
    // from. Header detection is still shared with the clients
    // (@loonext/shared), but only as the default guess the person confirmed:
    // the server takes their answer, so a column this importer would have
    // claimed for `notes` can be declared the do-not-text column and actually
    // block those rows.
    const declarations = declaredColumns(
      form,
      headers,
      dataRows.map((row) => row.cells),
    );
    const mapping = mappingFromDeclarations(declarations);
    const phoneCol = mapping.phone ?? -1;
    if (phoneCol === -1) {
      throw new ApiError("validation_failed", "file: missing `phone` column.");
    }
    assertFlagColumnReadable(
      headers,
      dataRows.map((row) => row.cells),
      mapping,
    );
    const nameCol = mapping.name ?? -1;
    // #248: split first/last columns are the shape most CRM and phone exports
    // use, and the detector used to read the first-name column as the whole
    // name — silently, with every row reported "ready". A crew that switched
    // ended up with a book of first names.
    const firstNameCol = mapping.first_name ?? -1;
    const lastNameCol = mapping.last_name ?? -1;
    const hasNameColumn =
      nameCol !== -1 || firstNameCol !== -1 || lastNameCol !== -1;
    const addressCol = mapping.address ?? -1;
    const notesCol = mapping.notes ?? -1;
    const optedOutCol = mapping.opted_out ?? -1;

    const companyId = c.get("companyId");
    const userId = c.get("userId");
    const db = getDb(getEnv(c.env));

    const errors: { row: number; reason: string }[] = [];
    interface ImportRow {
      /** The line in the uploaded file this contact's kept row came from. */
      row: number;
      phone: string;
      cells: string[];
      optedOut: boolean;
    }
    const byPhone = new Map<string, ImportRow>();

    dataRows.forEach(({ line, cells }) => {
      // The row's TRUE line in the uploaded file. Numbering by position instead
      // shifted every row after a blank one, and the wizard joins these numbers
      // back against its own preview to build the skipped-rows file, so each
      // reason was pinned to the wrong original line.
      const rowNumber = line;
      const rawPhone = cells[phoneCol]?.trim() ?? "";
      const phone = normalizeNanpPhone(rawPhone);
      if (!phone) {
        errors.push({
          row: rowNumber,
          reason: `invalid phone: ${rawPhone === "" ? "(empty)" : rawPhone}`,
        });
        return;
      }
      // Read BEFORE the duplicate check, because the duplicate check used to
      // `return` above this line and take the restriction with it. A file that
      // listed the same person twice — once plain, once flagged opted out, which
      // is what a merge of two exports looks like — kept the first row and threw
      // the second away, and the row it threw away was the one saying "do not
      // text this person".
      //
      // `readContactFlag` is shared, so the wizard's preview, both phone apps
      // and this route read the cell the same way — and it cannot return the
      // permissive answer for a value it does not understand, because
      // `assertFlagColumnReadable` above has already refused the file if any
      // cell in this column is unreadable.
      const optedOut =
        optedOutCol !== -1 && readContactFlag(cells[optedOutCol]) === true;
      const seen = byPhone.get(phone);
      if (seen) {
        // The extra ROW is still discarded, and still reported: which of two
        // spellings of a name to keep is a judgement we should not make
        // silently. The RESTRICTION is not the row's, though — it is the
        // person's, and an opt-out anywhere in the file is true of them
        // whichever row happened to carry it. Never the reverse: a later plain
        // row cannot clear a flag an earlier one set.
        if (optedOut) seen.optedOut = true;
        errors.push({
          row: rowNumber,
          reason: `duplicate phone in file: ${phone}`,
        });
        return;
      }
      byPhone.set(phone, { row: rowNumber, phone, cells, optedOut });
    });

    const entries = [...byPhone.values()];
    const phones = entries.map((entry) => entry.phone);

    // Two reads, in parallel, before anything is written.
    //
    // Pre-existing contacts, for imported-vs-updated counting — and, since
    // #248, for the consent basis each one already carries. The same read
    // answers both questions, so honouring an existing basis costs no round
    // trip: see importConsent for why it must be honoured.
    //
    // And every standing opt-out among these phones, which is the fact that
    // decides whether the file's attestation may be applied to a row at all.
    // Parallel rather than sequential because neither informs the other and
    // this is the request's whole latency budget: 2000 rows is ten chunks of
    // each.
    const [existingBasis, standing] = await Promise.all([
      existingConsentBasis(db, companyId, phones),
      standingOptOuts(db, companyId, phones),
    ]);
    const existingPhones = new Set(existingBasis.keys());

    // Per-row upsert on (company_id, phone_e164) clearing deleted_at. Every
    // row in a batch carries the same keys (only the columns present in the
    // CSV header), so an absent column never nulls existing data.
    const cell = (cells: string[], index: number): string | null => {
      const value = (cells[index] ?? "").trim();
      return value === "" ? null : value;
    };
    // Undo the export's CSV-injection guard (csvSafeText): a name we exported
    // that began with a formula trigger carries a single leading apostrophe
    // followed by that trigger char (=+-@ / tab / CR / LF). Strip exactly that
    // apostrophe so an export→import round-trip is lossless (D20 §3.1), without
    // touching a legitimate leading apostrophe before ordinary text.
    const unguard = (value: string | null): string | null =>
      value !== null && /^'[=+\-@\t\r\n]/.test(value) ? value.slice(1) : value;
    // One timestamp for the whole file: every row in an import consented at the
    // same moment as far as the ledger is concerned, and a per-row now() would
    // make the evidence chain look like a thousand separate events.
    const importedAt = new Date().toISOString();

    // #248: the consent decision for every row, made once, from both reads, and
    // BEFORE anything is written — so a row's fate does not depend on how far
    // the import got.
    const refusals: { row: number; reason: string }[] = [];
    const consentByPhone = new Map<string, Record<string, unknown>>();
    for (const entry of entries) {
      const decision = importConsent(
        existingBasis.get(entry.phone),
        { standing: standing.has(entry.phone), inFile: entry.optedOut },
        importedAt,
        userId,
      );
      consentByPhone.set(entry.phone, decision.columns);
      if (decision.refused) {
        refusals.push({
          row: entry.row,
          reason: contactImportConsentRefusedReason(entry.phone),
        });
      }
    }

    const upsertRows = entries.map(({ phone, cells }) => {
      const row: Record<string, unknown> = {
        company_id: companyId,
        phone_e164: phone,
        deleted_at: null,
        // #191 attribution: every imported/resurrected row records the importer
        // as its creator. A constant key, so the batching invariant holds.
        created_by_user_id: userId,
      };
      // #226 basis, #248 rule: written only where there is none AND nothing
      // standing forbids it. A contact who texted this business first keeps
      // `inbound_sms` and the date they did it, however many times the
      // spreadsheet is re-uploaded; a contact who texted STOP gets nothing.
      Object.assign(row, consentByPhone.get(phone) ?? {});
      // A blank name cell means "this file says nothing about the name", never
      // "erase the name you already have". The column is decided for the whole
      // file, so one nameless row among named ones used to null out an existing
      // contact's name on import: a contact saved on someone's phone as a bare
      // number would blank the name the business had recorded for them, and the
      // wizard reported it as a plain "updated" row.
      //
      // Rows are grouped below so each batch keeps one key set.
      if (hasNameColumn) {
        // #248: first/last are joined here so the stored name is the person,
        // whichever shape the file used. joinContactName is shared, so the
        // wizard's preview promises exactly what lands.
        const name = joinContactName({
          first: firstNameCol === -1 ? null : unguard(cell(cells, firstNameCol)),
          last: lastNameCol === -1 ? null : unguard(cell(cells, lastNameCol)),
          full: nameCol === -1 ? null : unguard(cell(cells, nameCol)),
        });
        if (name !== null) row.name = name;
      }
      if (addressCol !== -1) {
        const address = cell(cells, addressCol);
        row.address = address;
        // Writing an address must re-queue geocoding (D25), exactly as
        // POST/PATCH /contacts do — the cron only re-scans rows with
        // geocode_status IN ('pending','failed'), so without this a re-import
        // that CHANGES an already-'ok' contact's address would keep the stale
        // cached lat/lng and never re-geocode. `geocodeReset` always writes the
        // same 4 keys, so a batch's rows keep identical key sets (the importer's
        // batching invariant) whether the address is present or cleared.
        Object.assign(row, geocodeReset(address));
      }
      if (notesCol !== -1) row.notes = cell(cells, notesCol);
      return row;
    });
    // opted_out=true → opt_outs rows (source='import', SPEC §5) + events for
    // numbers that were not already actively opted out.
    const optedOutPhones = entries
      .filter((entry) => entry.optedOut)
      .map((entry) => entry.phone);
    // Which of them this import has to ANNOUNCE on the timeline.
    //
    // Not "which ones changed": that was read from the state before this run's
    // own writes, so a re-run after a half-finished import saw the opt-outs it
    // had already written and stayed silent forever (see `announcedOptOuts`).
    // A number that is standing AND already has its event is the ordinary
    // case — a customer who texted STOP months ago, listed again in a file —
    // and it stays silent, so re-uploading the same book does not pile up
    // duplicate events.
    const alreadyStanding = optedOutPhones.filter((phone) => standing.has(phone));
    const announced =
      alreadyStanding.length > 0
        ? await announcedOptOuts(db, companyId, alreadyStanding)
        : new Set<string>();
    const newlyOptedOut = optedOutPhones.filter(
      (phone) => !standing.has(phone) || !announced.has(phone),
    );

    const contactIdByPhone = new Map<string, string>();
    try {
      // ===================================================================
      // RESTRICTIONS FIRST (#248).
      //
      // Everything below is one synchronous pass with no transaction around
      // it, so any of it may be the last thing that runs. That makes the ORDER
      // a safety property rather than a style choice: whichever prefix
      // completes has to be a state we can live in.
      //
      // Contacts used to be written first, so every partial failure landed on
      // the MOST PERMISSIVE state the file could produce — contacts created,
      // the file's attestation stamped on them, and not one of the opt-outs it
      // declared. A half-finished import that blocked people who should be
      // blocked and created no contacts costs somebody a re-upload; the
      // reverse costs a text to a person who said stop.
      // ===================================================================
      await writeImportOptOuts(db, companyId, userId, optedOutPhones);

      // PostgREST derives the column list from the first row of a batch, so
      // every row in one request must carry the same keys. Rows that omit
      // `name` (a blank cell, which must not erase an existing name) or the
      // consent columns (a contact whose basis is already recorded, or who is
      // opted out) are sent as their own group rather than padded back to null.
      for (const group of groupByKeySet(upsertRows)) {
        for (let i = 0; i < group.length; i += IMPORT_CHUNK) {
          const chunk = group.slice(i, i + IMPORT_CHUNK);
          const upserted = unwrap<{ id: string; phone_e164: string }[]>(
            await db
              .from("contacts")
              .upsert(chunk, { onConflict: "company_id,phone_e164" })
              .select("id,phone_e164"),
            "import upsert",
          );
          for (const row of upserted) {
            contactIdByPhone.set(row.phone_e164, row.id);
          }
        }
      }

      // The timeline entries come LAST because they are the only part that
      // needs the contact ids — a record of the block, after the block itself.
      await announceImportOptOuts(
        db,
        companyId,
        userId,
        newlyOptedOut,
        contactIdByPhone,
      );
    } catch (cause) {
      // A half-finished import that leaves no trace is the part of #248's D4
      // that a job table would have fixed by accident. This fixes it directly:
      // the audit log carries the attempt, so "where did these 200 contacts
      // come from, and why is there no import row" has an answer. The throw
      // stands — a 200 on an import that did not finish would be the lie.
      await recordAuditFromRequest(db, c, {
        companyId,
        action: "contacts.imported",
        targetType: "contact",
        after: {
          // What was asked for, not what landed: we genuinely do not know how
          // much landed, and a made-up count is worse than an honest bound.
          attempted: phones.length,
          skipped: errors.length,
          // #248 round 2: the refusals are DECIDED before the first write, so
          // they are known here — and this is the one path where the response
          // body never reaches anybody, because the caller gets a 500. Leaving
          // it off meant a failed import reported its refused rows NOWHERE,
          // which is precisely the case a carrier audit asks about.
          consent_refused: refusals.length,
          // #248 round 3: what this workspace SAID its columns were. On the
          // failed path too, because a half-finished import is exactly when
          // somebody asks what the file claimed to be.
          columns: declarations.map(formatContactImportColumn),
          source: "csv",
          outcome: "failed",
        },
      });
      throw cause;
    }

    const imported = phones.filter((p) => !existingPhones.has(p)).length;
    // #281 item 3: the other thing a workspace does between approval and its
    // first send. The COUNT is the property worth having — importing four
    // contacts and importing four hundred are different states of readiness,
    // and a drop-off after a big import is a different problem from a drop-off
    // after a token one. A number cannot carry a name or an address.
    await capture(getEnv(c.env), "contacts_imported", companyId, {
      imported,
      updated: phones.length - imported,
      source: "csv",
    });
    // #345: counts, never contacts. An import is how a workspace's customer
    // list arrives, and "where did these 400 people come from" is asked far
    // more often than anyone expects.
    await recordAuditFromRequest(db, c, {
      companyId,
      action: "contacts.imported",
      targetType: "contact",
      after: {
        imported,
        updated: phones.length - imported,
        skipped: errors.length,
        // #248: the rows whose attestation was refused. On the audit row as
        // well as in the response, because this is the number a carrier audit
        // or a demand letter is about, and a response body is gone the moment
        // the tab closes.
        consent_refused: refusals.length,
        // #248 round 3: the workspace's own statement about what every column
        // of this file meant. It is a CLAIM — the server cannot know a person
        // read the values — so it belongs where claims go, next to the consent
        // attestation it stands beside. Headers are the file's structure, not
        // the customers in it, so this stays inside the "counts, never
        // contacts" rule above.
        columns: declarations.map(formatContactImportColumn),
        source: "csv",
      },
    });
    return c.json({
      imported,
      updated: phones.length - imported,
      skipped: errors.length,
      errors,
      // #248: what the file's attestation did NOT cover, and which rows. Named
      // separately from `skipped` because these rows were imported — calling
      // them skipped would be a second wrong answer.
      ...refusalReport(refusals),
    });
  },
);

/** Max cards a single .vcf may carry — same CPU bound as the CSV importer. */
const VCARD_MAX_CARDS = VCARD_IMPORT_MAX_CARDS;

/**
 * POST /v1/contacts/import-vcard (D20 §3.2) — owner/admin (the §10 matrix,
 * matching the CSV importer). Accepts one .vcf with one-or-many VCARD blocks
 * (phone/Google/Apple export). Parses vCard 3.0 + 4.0 (FN/N → name, TEL →
 * phone), normalizes every TEL to E.164 against the company default country
 * (US/CA), drops un-normalizable numbers with a per-row reason. A card with
 * multiple valid TELs yields one contact per DISTINCT valid number (contacts
 * are phone-keyed). Reuses the exact idempotent upsert + dedupe + consent
 * attestation the CSV importer enforces — including #248's rule that a contact
 * who already has a recorded basis keeps it. Same
 * { imported, updated, skipped, errors } shape as CSV.
 *
 * #248 round 3: and the same declaration rule, in the shape this format allows.
 * Every property the cards carry that this parser does not read has to be
 * declared `ignore` or `opted_out` — `CATEGORIES` and `NOTE` are the only two
 * places a .vcf can say do-not-text, and both used to be dropped in silence.
 * A property declared `opted_out` writes the same `opt_outs` rows and timeline
 * events the CSV importer's flag column does, restrictions first.
 */
contactsRoutes.post(
  "/contacts/import-vcard",
  requireCapability("contacts.bulk"),
  async (c) => {
    // #36: declared-size gate BEFORE formData() buffers the whole body (§10).
    assertBodyWithinLimit(c, MAX_VCARD_IMPORT_BODY_BYTES);
    // #248: both bulk doors share one budget — see assertImportWithinRateLimit.
    await assertImportWithinRateLimit(getEnv(c.env), c.get("companyId"));
    let form: FormData;
    try {
      form = await c.req.raw.formData();
    } catch {
      throw new ApiError(
        "validation_failed",
        "Request must be multipart/form-data with a `file` field.",
      );
    }
    const file = form.get("file") as unknown as
      | string
      | { text(): Promise<string> }
      | null;
    if (file === null) {
      throw new ApiError("validation_failed", "file: missing .vcf file field.");
    }
    // #248: the same attestation the CSV route has demanded since #226. A phone
    // address book is not a consent record — it is every number the owner has
    // ever dialled, plumbers and school runs and their mother included — so if
    // either bulk door asks the question, this is the one that must.
    assertConsentAttested(form);
    const text = typeof file === "string" ? file : await file.text();
    if (text.length > VCARD_IMPORT_MAX_BYTES) {
      throw new ApiError(
        "validation_failed",
        `file: too large (max ${VCARD_IMPORT_MAX_BYTES / (1024 * 1024)} MB).`,
      );
    }
    // The same door check as the CSV route, for the same reason: a .vcf saved
    // as UTF-16 decodes exactly as badly, and a phone's export is the file most
    // likely to have been round-tripped through a desktop program (#248 H5).
    assertDecodableText(text);

    const cards = parseVCards(text);
    if (cards.length === 0) {
      throw new ApiError(
        "validation_failed",
        "file: no VCARD blocks found.",
      );
    }
    if (cards.length > VCARD_MAX_CARDS) {
      throw new ApiError(
        "validation_failed",
        `file: too many cards (max ${VCARD_MAX_CARDS}).`,
      );
    }
    // #248 round 3: the card cap first, for the same reason the CSV route's row
    // cap is first — the walk below reads every property of every card, and the
    // cap is what bounds it. Then: every property these cards carry that this
    // importer does not read has to be answered for. `CATEGORIES:DNC` and a
    // `NOTE` saying they asked us to stop were dropped here without a word.
    const propertyDeclarations = declaredVCardProperties(form, cards);
    const blockingProperties = new Set(
      propertyDeclarations
        .filter((declaration) => declaration.action === "opted_out")
        .map((declaration) => declaration.property),
    );

    const companyId = c.get("companyId");
    const userId = c.get("userId");
    const db = getDb(getEnv(c.env));

    const errors: { row: number; reason: string }[] = [];
    // One entry per DISTINCT valid E.164 across the whole file; first name
    // wins, and the card it came from is kept so a refusal can name it.
    const byPhone = new Map<
      string,
      { name: string | null; row: number; optedOut: boolean }
    >();

    cards.forEach((card, index) => {
      const cardNumber = index + 1; // 1-based card position
      // Somebody looked at this property and said a card carrying it must not
      // be texted. Read BEFORE the duplicate check below, and OR-ed into a
      // number already seen, for the reason the CSV route learned the hard way:
      // the restriction belongs to the person, not to the row that happened to
      // carry it, and a discarded duplicate must not take it away.
      const optedOut = card.properties.some((property) =>
        blockingProperties.has(property),
      );
      const valid = new Set<string>();
      for (const rawTel of card.tels) {
        const phone = normalizeNanpPhone(rawTel);
        if (!phone) {
          errors.push({
            row: cardNumber,
            reason: `invalid phone: ${rawTel === "" ? "(empty)" : rawTel}`,
          });
          continue;
        }
        valid.add(phone);
      }
      if (valid.size === 0 && card.tels.length === 0) {
        // A card with no TEL at all is a skip with a clear reason.
        errors.push({ row: cardNumber, reason: "no phone number" });
        return;
      }
      for (const phone of valid) {
        const seen = byPhone.get(phone);
        if (seen) {
          if (optedOut) seen.optedOut = true;
          errors.push({
            row: cardNumber,
            reason: `duplicate phone in file: ${phone}`,
          });
          continue;
        }
        byPhone.set(phone, { name: card.name, row: cardNumber, optedOut });
      }
    });

    const entries = [...byPhone.entries()];
    const phones = entries.map(([phone]) => phone);

    // Pre-existing contacts → imported-vs-updated counting, and the consent
    // basis each already carries (mirrors CSV, #248). Plus every standing
    // opt-out among these numbers: a phone's address book has no column for
    // "this person told us to stop", so this route is the one where the file
    // CANNOT know, and the attestation would otherwise be written over a live
    // STOP every single time.
    const [existingBasis, standing] = await Promise.all([
      existingConsentBasis(db, companyId, phones),
      standingOptOuts(db, companyId, phones),
    ]);
    const existingPhones = new Set(existingBasis.keys());

    // Idempotent upsert on (company_id, phone_e164), clearing deleted_at — the
    // exact CSV path. A name is written only when the card carried one, so a
    // re-import of a card without a name never nulls an existing name.
    const importedAt = new Date().toISOString();
    const refusals: { row: number; reason: string }[] = [];
    const upsertRows = entries.map(
      ([phone, { name, row: cardNumber, optedOut }]) => {
        const row: Record<string, unknown> = {
          company_id: companyId,
          phone_e164: phone,
          deleted_at: null,
          // #191 attribution: the importer is the creator (same as the CSV path).
          created_by_user_id: userId,
        };
        const decision = importConsent(
          existingBasis.get(phone),
          // #248 round 3: `inFile` is no longer always false here. A .vcf says
          // do-not-text in exactly one way — a property somebody declared as
          // meaning it — and a file that attests everyone agreed while carrying
          // a card marked DNC has contradicted itself, so the restriction is
          // the half to believe. Everything else standing is a disagreement
          // between the file and the record, and every one of those is reported.
          { standing: standing.has(phone), inFile: optedOut },
          importedAt,
          userId,
        );
        Object.assign(row, decision.columns);
        if (decision.refused) {
          refusals.push({
            row: cardNumber,
            reason: contactImportConsentRefusedReason(phone),
          });
        }
        if (name !== null) row.name = name;
        return row;
      },
    );
    // The blocked numbers, and which of them this import has to announce — the
    // same two questions the CSV route asks, answered from durable state so a
    // re-run after a half-finished import repairs the timeline rather than
    // staying silent forever. See `announcedOptOuts`.
    const optedOutPhones = entries
      .filter(([, entry]) => entry.optedOut)
      .map(([phone]) => phone);
    const alreadyStanding = optedOutPhones.filter((phone) => standing.has(phone));
    const announced =
      alreadyStanding.length > 0
        ? await announcedOptOuts(db, companyId, alreadyStanding)
        : new Set<string>();
    const newlyOptedOut = optedOutPhones.filter(
      (phone) => !standing.has(phone) || !announced.has(phone),
    );
    const contactIdByPhone = new Map<string, string>();
    try {
      // RESTRICTIONS FIRST, the same order and for the same reason as the CSV
      // route: there is no transaction around any of this, so whichever prefix
      // completes has to be a state we can live in. Contacts first would mean a
      // partial failure landing on contacts created, the file's attestation
      // stamped on them, and not one of the blocks it declared.
      await writeImportOptOuts(db, companyId, userId, optedOutPhones);
      // Grouped by key set, like the CSV path. This route never was: a nameless
      // card landing first in a chunk made PostgREST drop `name` from the whole
      // batch, so importing a phone book that starts with a bare number saved
      // every following contact as a number with no name.
      for (const group of groupByKeySet(upsertRows)) {
        for (let i = 0; i < group.length; i += IMPORT_CHUNK) {
          const upserted = unwrap<{ id: string; phone_e164: string }[]>(
            await db
              .from("contacts")
              .upsert(group.slice(i, i + IMPORT_CHUNK), {
                onConflict: "company_id,phone_e164",
              })
              .select("id,phone_e164"),
            "vcard upsert",
          );
          for (const row of upserted) {
            contactIdByPhone.set(row.phone_e164, row.id);
          }
        }
      }
      await announceImportOptOuts(
        db,
        companyId,
        userId,
        newlyOptedOut,
        contactIdByPhone,
      );
    } catch (cause) {
      // Same reason as the CSV route: a partial import that left no audit row
      // is a set of contacts nobody can account for. See there.
      await recordAuditFromRequest(db, c, {
        companyId,
        action: "contacts.imported",
        targetType: "contact",
        after: {
          attempted: phones.length,
          skipped: errors.length,
          // Known before the first write here too — see the CSV route.
          consent_refused: refusals.length,
          properties: propertyDeclarations.map(formatVCardProperty),
          source: "vcard",
          outcome: "failed",
        },
      });
      throw cause;
    }

    const imported = phones.filter((p) => !existingPhones.has(p)).length;
    // #281 item 3: same funnel step as the CSV importer above. Both paths emit,
    // because a workspace that arrived by vCard is no less imported than one
    // that arrived by spreadsheet, and a step only one path reports is a step
    // that under-counts.
    await capture(getEnv(c.env), "contacts_imported", companyId, {
      imported,
      updated: phones.length - imported,
      source: "vcard",
    });
    // #345: the vCard path is no less an import than the spreadsheet one, and
    // an audit trail only one route writes is a trail with a hole shaped
    // exactly like whichever route somebody chose.
    await recordAuditFromRequest(db, c, {
      companyId,
      action: "contacts.imported",
      targetType: "contact",
      after: {
        imported,
        updated: phones.length - imported,
        skipped: errors.length,
        consent_refused: refusals.length,
        // #248 round 3: what this workspace said the cards' unread properties
        // meant — the vCard door's half of the same claim the CSV door records
        // as `columns`.
        properties: propertyDeclarations.map(formatVCardProperty),
        source: "vcard",
      },
    });
    return c.json({
      imported,
      updated: phones.length - imported,
      skipped: errors.length,
      errors,
      // #248: the same three fields the CSV route answers with. A client that
      // has to branch on which door it used would eventually show the note on
      // one and not the other.
      ...refusalReport(refusals),
    });
  },
);

contactsRoutes.post(
  "/contacts/:id/opt-out",
  requireCapability("conversations.note"),
  async (c) => {
    const id = pathUuid(c, "id");
    const companyId = c.get("companyId");
    const userId = c.get("userId");
    const db = getDb(getEnv(c.env));

    const contact = await findContact(db, companyId, id);
    if (!contact) {
      return errorResponse(c, "not_found", "No such contact.");
    }
    const phone = contact.phone_e164 as string;

    const optOutCols = "id,phone_e164,source,created_at,revoked_at";
    // Make the STATE TRANSITION the arbiter for the timeline event, so a
    // concurrent double-submit can't write duplicate `opted_out` events (the
    // old check-then-write raced: two requests both passed the "already active?"
    // read, both upserted the idempotent row, and both inserted the event).
    // (1) Resurrect a REVOKED opt-out — only a genuine revoked→active change.
    const revived = unwrap<Record<string, unknown>[]>(
      await db
        .from("opt_outs")
        .update({ source: "manual", created_by: userId, revoked_at: null })
        .eq("company_id", companyId)
        .eq("phone_e164", phone)
        .not("revoked_at", "is", null)
        .select(optOutCols),
      "opt-out revive",
    );
    let transitioned = revived[0];
    if (!transitioned) {
      // (2) No revoked row to revive → try a brand-new opt-out. ON CONFLICT DO
      // NOTHING (ignoreDuplicates) so a concurrent insert OR an already-active
      // row yields zero rows — only the winner transitions.
      const inserted = unwrap<Record<string, unknown>[]>(
        await db
          .from("opt_outs")
          .upsert(
            {
              company_id: companyId,
              phone_e164: phone,
              source: "manual",
              created_by: userId,
              revoked_at: null,
            },
            { onConflict: "company_id,phone_e164", ignoreDuplicates: true },
          )
          .select(optOutCols),
        "opt-out insert",
      );
      transitioned = inserted[0];
    }
    if (!transitioned) {
      // Already opted out (active), or lost the concurrent insert — idempotent,
      // NO duplicate event. Return the current active row.
      const current = unwrap<Record<string, unknown>[]>(
        await db
          .from("opt_outs")
          .select(optOutCols)
          .eq("company_id", companyId)
          .eq("phone_e164", phone)
          .is("revoked_at", null)
          .limit(1),
        "opt-out current",
      );
      return c.json(current[0]);
    }

    await insertConversationEvents(db, [
      {
        company_id: companyId,
        conversation_id: await latestConversationId(db, companyId, id),
        actor_user_id: userId,
        type: "opted_out",
        payload: { phone_e164: phone, source: "manual" },
      },
    ]);
    // #331/#231: who this business may still contact, on the timeline an
    // incident is reconstructed from. The conversation event covers the thread;
    // this covers the workspace, and outlives the conversation.
    await recordAuditFromRequest(db, c, {
      companyId,
      action: "opt_out.recorded",
      targetType: "contact",
      targetId: id,
      after: { source: "manual" },
    });
    return c.json(transitioned, 201);
  },
);

async function revokeOptOut(c: Context<AppEnv>) {
  const id = pathUuid(c, "id");
  const companyId = c.get("companyId");
  const userId = c.get("userId");
  const db = getDb(getEnv(c.env));

  const contact = await findContact(db, companyId, id);
  if (!contact) {
    return errorResponse(c, "not_found", "No such contact.");
  }
  const phone = contact.phone_e164 as string;

  // A STOP the customer sent is a CARRIER block, not a row in our table.
  // Clearing our row would not clear theirs: the next send still comes back
  // 40300, while the contact page says the person can be texted. That
  // contradiction was reachable in production (revoke at 08:38:44, send
  // rejected at 08:38:53), and no amount of retrying resolves it, because the
  // only thing that lifts a carrier block is the customer texting START.
  // Refusing here is what makes the contradiction impossible.
  const active = unwrap<{ id: string; source: string }[]>(
    await db
      .from("opt_outs")
      .select("id,source")
      .eq("company_id", companyId)
      .eq("phone_e164", phone)
      .is("revoked_at", null)
      .limit(1),
    "opt-out lookup",
  );
  if (active.length === 0) {
    return errorResponse(c, "not_found", "Contact is not opted out.");
  }
  // #331: `carrier` is the same fact arriving by a different route — Telnyx
  // refused a send with 40300, or the nightly reconciliation found the number
  // on their list and not ours. Either way the block lives at the carrier, so
  // it refuses for exactly the reason `stop_keyword` does.
  if (active[0].source === "stop_keyword" || active[0].source === "carrier") {
    return errorResponse(
      c,
      "conflict",
      "This customer texted STOP, so their carrier is blocking your texts. " +
        "Only they can undo it, by texting START to your number.",
    );
  }

  const rows = unwrap<Record<string, unknown>[]>(
    await db
      .from("opt_outs")
      .update({ revoked_at: new Date().toISOString() })
      .eq("company_id", companyId)
      .eq("phone_e164", phone)
      .is("revoked_at", null)
      .select("id,phone_e164,source,created_at,revoked_at"),
    "opt-out revoke",
  );
  if (rows.length === 0) {
    return errorResponse(c, "not_found", "Contact is not opted out.");
  }

  await insertConversationEvents(db, [
    {
      company_id: companyId,
      conversation_id: await latestConversationId(db, companyId, id),
      actor_user_id: userId,
      type: "opt_out_revoked",
      payload: { phone_e164: phone },
    },
  ]);
  // #331/#231: the one that matters most. Texting someone who had asked not to
  // be texted starts with somebody lifting their opt-out, and this is the row
  // that says who.
  await recordAuditFromRequest(db, c, {
    companyId,
    action: "opt_out.revoked",
    targetType: "contact",
    targetId: id,
    before: { source: active[0].source },
  });
  return c.json(rows[0]);
}

contactsRoutes.post(
  "/contacts/:id/opt-out/revoke",
  requireCapability("conversations.note"),
  revokeOptOut,
);
// Alias: DELETE of the opt-out resource — same revoke semantics.
contactsRoutes.delete(
  "/contacts/:id/opt-out",
  requireCapability("conversations.note"),
  revokeOptOut,
);

/**
 * #246 — POST /v1/contacts/:id/merge: fold this contact into another.
 *
 * `settings.manage` rather than the member level the rest of this file uses.
 * A merge rewrites whose history is whose and cannot be fully undone — the row
 * comes back, but which thread came from which record does not. That is the
 * same class of decision as merging tags (#298), and it is the one contact
 * operation where getting it wrong costs more than doing nothing.
 */
contactsRoutes.post(
  "/contacts/:id/merge",
  requireCapability("settings.manage"),
  async (c) => {
    const from = pathUuid(c, "id");
    const body = await parseJsonBody(c, mergeSchema);
    const companyId = c.get("companyId");
    const db = getDb(getEnv(c.env));

    const result = unwrap<{
      outcome: string;
      moved?: number;
      closed?: number;
      opted_out?: boolean;
      from_phone?: string;
      into_phone?: string;
    }>(
      await db.rpc("api_merge_contacts", {
        p_company_id: companyId,
        p_from: from,
        p_into: body.into_contact_id,
        p_actor: c.get("userId"),
      }),
      "contact merge",
    );

    if (result.outcome === "not_found") {
      return errorResponse(c, "not_found", "No such contact.");
    }
    if (result.outcome === "same_contact") {
      return errorResponse(
        c,
        "validation_failed",
        "Pick a different contact to merge into.",
      );
    }
    if (result.outcome === "already_merged") {
      return errorResponse(
        c,
        "conflict",
        "One of these has already been merged. Open the surviving contact and " +
          "merge from there.",
      );
    }

    // #246 asks for undo OR a full record. Both: the tombstone is the undo and
    // this is the record. It carries both numbers because after the merge one
    // of them is the only way to say which record was folded in.
    await recordAuditFromRequest(db, c, {
      companyId,
      action: "contact.merged",
      targetType: "contact",
      targetId: body.into_contact_id,
      after: {
        merged_contact_id: from,
        from_phone: result.from_phone ?? null,
        into_phone: result.into_phone ?? null,
        conversations_moved: result.moved ?? 0,
        conversations_closed: result.closed ?? 0,
        opted_out: result.opted_out ?? false,
      },
    });

    return c.json({
      merged: true,
      moved: result.moved ?? 0,
      closed: result.closed ?? 0,
      opted_out: result.opted_out ?? false,
    });
  },
);

/**
 * #246 — POST /v1/contacts/:id/unmerge: put the second record back.
 *
 * Restores the contact and its number. It does NOT move the conversations
 * back: which thread came from which record is not recoverable once they are
 * under one contact, and a guess would be worse than the honest limit.
 *
 * The opt-out union is never undone either. If the customer said stop, they
 * said stop — an undo of a bookkeeping mistake is not consent to text them.
 */
contactsRoutes.post(
  "/contacts/:id/unmerge",
  requireCapability("settings.manage"),
  async (c) => {
    const id = pathUuid(c, "id");
    const companyId = c.get("companyId");
    const db = getDb(getEnv(c.env));

    const result = unwrap<{ outcome: string; phone?: string }>(
      await db.rpc("api_unmerge_contact", {
        p_company_id: companyId,
        p_contact_id: id,
      }),
      "contact unmerge",
    );

    if (result.outcome === "not_found") {
      return errorResponse(c, "not_found", "No such contact.");
    }
    if (result.outcome === "not_merged") {
      return errorResponse(c, "conflict", "That contact was not merged.");
    }

    await recordAuditFromRequest(db, c, {
      companyId,
      action: "contact.unmerged",
      targetType: "contact",
      targetId: id,
      after: { phone: result.phone ?? null },
    });

    return c.json({ unmerged: true });
  },
);

/**
 * #291 — a contact's OTHER numbers.
 *
 * "Customers have a mobile and a landline; households have two people; a
 * business has a main line and a cell."
 *
 * One row per request, like the addresses below and for the same reason. And
 * `conversations.note` to write, matching the rest of the contact record: a
 * second number is operational knowledge the crew keeps.
 *
 * THE PART THAT IS NOT BOOKKEEPING: a number recorded here is matched against
 * every inbound text and call, so adding one changes who a message is FROM.
 * That is why a number already in use is refused rather than moved — taking
 * somebody else's number would silently redirect their conversations.
 */
const contactPhoneSchema = z.object({
  phone_e164: z.string().trim().min(1).max(32),
  label: z.string().trim().min(1).max(80).nullable().optional(),
});

contactsRoutes.post(
  "/contacts/:id/phones",
  requireCapability("conversations.note"),
  async (c) => {
    const contactId = pathUuid(c, "id");
    const companyId = c.get("companyId");
    const db = getDb(getEnv(c.env));
    const body = await parseJsonBody(c, contactPhoneSchema);

    const contact = await findContact(db, companyId, contactId);
    if (!contact) return errorResponse(c, "not_found", "No such contact.");

    // Normalised before anything is compared. A raw "(416) 555-0199" stored
    // here would never equal a webhook's `from`, so the number would look
    // recorded and quietly never resolve.
    const phone = normalizeNanpPhone(body.phone_e164);
    if (!phone) {
      throw new ApiError(
        "validation_failed",
        "That does not look like a phone number.",
      );
    }
    if (phone === contact.phone_e164) {
      throw new ApiError(
        "validation_failed",
        "That is already this customer's main number.",
      );
    }

    // Is it somebody else's? Checked against BOTH the primaries and the other
    // numbers, because a number can only belong to one customer — and the two
    // tables each hold half the answer.
    const owner = unwrap<{ id: string; name: string | null }[]>(
      await db
        .from("contacts")
        .select("id,name")
        .eq("company_id", companyId)
        .eq("phone_e164", phone)
        .limit(1),
      "number owner lookup",
    );
    if (owner.length > 0) {
      throw new ApiError(
        "validation_failed",
        `${owner[0].name?.trim() || "Another customer"} already has that number. ` +
          "Merge the two records instead.",
      );
    }
    const taken = unwrap<{ contact_id: string }[]>(
      await db
        .from("contact_phones")
        .select("contact_id")
        .eq("company_id", companyId)
        .eq("phone_e164", phone)
        .limit(1),
      "number claim lookup",
    );
    if (taken.length > 0) {
      throw new ApiError(
        "validation_failed",
        taken[0].contact_id === contactId
          ? "That number is already on this customer."
          : "Another customer already has that number.",
      );
    }

    const existing = unwrap<{ id: string }[]>(
      await db
        .from("contact_phones")
        .select("id")
        .eq("company_id", companyId)
        .eq("contact_id", contactId),
      "number count",
    );
    if (existing.length >= CONTACT_PHONE_CAP) {
      throw new ApiError(
        "validation_failed",
        `A contact can hold ${CONTACT_PHONE_CAP} extra numbers.`,
      );
    }

    const rows = unwrap<Record<string, unknown>[]>(
      await db
        .from("contact_phones")
        .insert({
          company_id: companyId,
          contact_id: contactId,
          phone_e164: phone,
          label: body.label ?? null,
        })
        .select("id,phone_e164,label,created_at"),
      "create contact phone",
    );

    return c.json({ data: rows[0] }, 201);
  },
);

contactsRoutes.delete(
  "/contacts/:id/phones/:phoneId",
  requireCapability("conversations.note"),
  async (c) => {
    const contactId = pathUuid(c, "id");
    const phoneId = pathUuid(c, "phoneId");
    const companyId = c.get("companyId");
    const db = getDb(getEnv(c.env));

    // Scoped to the CONTACT as well as the company: a phone id from another
    // customer's record must be a 404, not a delete.
    const removed = unwrap<{ id: string }[]>(
      await db
        .from("contact_phones")
        .delete()
        .eq("company_id", companyId)
        .eq("contact_id", contactId)
        .eq("id", phoneId)
        .select("id"),
      "delete contact phone",
    );
    if (removed.length === 0) {
      return errorResponse(c, "not_found", "No such number.");
    }

    // The THREADS stay. A conversation held with that number is a real
    // history, and deleting the number is a correction to the contact record,
    // not a request to erase what was said.
    return c.json({ deleted: true });
  },
);

/**
 * #291 — a contact's addresses.
 *
 * WHY THESE ARE THEIR OWN ROUTES RATHER THAN A FIELD ON PATCH /contacts/:id.
 * A whole-list replace would make "add one address" a read-modify-write, and
 * two people editing one property manager's forty buildings would silently
 * lose each other's work. One row, one request.
 *
 * `conversations.note` to write, matching the rest of the contact record: an
 * address is operational knowledge the crew keeps, not customer-facing
 * messaging, and a member who can annotate a contact can correct where the van
 * goes.
 */
contactsRoutes.post(
  "/contacts/:id/addresses",
  requireCapability("conversations.note"),
  async (c) => {
    const contactId = pathUuid(c, "id");
    const companyId = c.get("companyId");
    const db = getDb(getEnv(c.env));
    const body = await parseJsonBody(c, addressSchema);

    const contact = await findContact(db, companyId, contactId);
    if (!contact) return errorResponse(c, "not_found", "No such contact.");

    const existing = unwrap<{ id: string; is_primary: boolean }[]>(
      await db
        .from("contact_addresses")
        .select("id,is_primary")
        .eq("company_id", companyId)
        .eq("contact_id", contactId),
      "address count",
    );
    if (existing.length >= ADDRESS_CAP) {
      throw new ApiError(
        "validation_failed",
        `A contact can hold ${ADDRESS_CAP} addresses.`,
      );
    }

    // The FIRST address is primary whether or not anybody said so. A contact
    // whose only address is not the primary one has no answer to "where is
    // this job", which is the single question the flag exists for.
    const wantsPrimary = body.is_primary === true || existing.length === 0;
    if (wantsPrimary) await demoteOtherPrimaries(db, companyId, contactId);

    const rows = unwrap<Record<string, unknown>[]>(
      await db
        .from("contact_addresses")
        .insert({
          company_id: companyId,
          contact_id: contactId,
          label: body.label ?? null,
          address: body.address,
          is_primary: wantsPrimary,
        })
        .select("id,label,address,is_primary,created_at"),
      "create contact address",
    );

    return c.json({ data: rows[0] }, 201);
  },
);

contactsRoutes.patch(
  "/contacts/:id/addresses/:addressId",
  requireCapability("conversations.note"),
  async (c) => {
    const contactId = pathUuid(c, "id");
    const addressId = pathUuid(c, "addressId");
    const companyId = c.get("companyId");
    const db = getDb(getEnv(c.env));
    const body = await parseJsonBody(c, addressSchema.partial());

    if (body.is_primary === true) {
      await demoteOtherPrimaries(db, companyId, contactId, addressId);
    }

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body.label !== undefined) patch.label = body.label ?? null;
    if (body.address !== undefined) patch.address = body.address;
    // Only ever set TRUE here. Clearing the flag directly would leave the
    // contact with no primary at all, and the demotion above is the only way
    // one moves.
    if (body.is_primary === true) patch.is_primary = true;

    const rows = unwrap<Record<string, unknown>[]>(
      await db
        .from("contact_addresses")
        .update(patch)
        .eq("company_id", companyId)
        .eq("contact_id", contactId)
        .eq("id", addressId)
        .select("id,label,address,is_primary,created_at"),
      "update contact address",
    );
    if (rows.length === 0) return errorResponse(c, "not_found", "No such address.");

    return c.json({ data: rows[0] });
  },
);

contactsRoutes.delete(
  "/contacts/:id/addresses/:addressId",
  requireCapability("conversations.note"),
  async (c) => {
    const contactId = pathUuid(c, "id");
    const addressId = pathUuid(c, "addressId");
    const companyId = c.get("companyId");
    const db = getDb(getEnv(c.env));

    const removed = unwrap<{ id: string; is_primary: boolean }[]>(
      await db
        .from("contact_addresses")
        .delete()
        .eq("company_id", companyId)
        .eq("contact_id", contactId)
        .eq("id", addressId)
        .select("id,is_primary"),
      "delete contact address",
    );
    if (removed.length === 0) {
      return errorResponse(c, "not_found", "No such address.");
    }

    // Deleting the primary promotes the oldest survivor. Leaving a contact
    // with addresses but no primary is the state that sends a van nowhere —
    // and it would happen on the most ordinary action there is.
    if (removed[0].is_primary) {
      const survivors = unwrap<{ id: string }[]>(
        await db
          .from("contact_addresses")
          .select("id")
          .eq("company_id", companyId)
          .eq("contact_id", contactId)
          .order("created_at", { ascending: true })
          .limit(1),
        "address promotion lookup",
      );
      if (survivors[0]) {
        unwrap(
          await db
            .from("contact_addresses")
            .update({ is_primary: true })
            .eq("company_id", companyId)
            .eq("id", survivors[0].id),
          "promote contact address",
        );
      }
    }

    return c.body(null, 204);
  },
);

/**
 * #291 — a workspace's own contact fields.
 *
 * A WHOLE-SET PUT rather than per-row routes, which is the opposite of the
 * addresses above and deliberately so. There are at most ten, they are ORDERED
 * relative to each other, and they are edited on a settings screen with a Save
 * button — the same shape #237's reminder rules take. Addresses are many,
 * independent, and edited one at a time by different people.
 */
const fieldDefSchema = z.object({
  key: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_]{0,39}$/, "A field key is lower case, no spaces"),
  label: z.string().trim().min(1).max(80),
  kind: z.enum(CONTACT_FIELD_KINDS),
  options: z.array(z.string().trim().min(1).max(80)).max(CONTACT_FIELD_OPTIONS_CAP).nullable().optional(),
});

const fieldDefsSchema = z.object({
  fields: z.array(fieldDefSchema).max(CONTACT_FIELDS_CAP),
});

contactsRoutes.get(
  "/contact-fields",
  requireCapability("conversations.read"),
  async (c) => {
    const db = getDb(getEnv(c.env));
    const rows = unwrap<Record<string, unknown>[]>(
      await db
        .from("contact_field_defs")
        .select("key,label,kind,options,position")
        .eq("company_id", c.get("companyId"))
        .order("position", { ascending: true })
        .order("created_at", { ascending: true }),
      "contact field definitions",
    );
    return c.json({ data: rows, cap: CONTACT_FIELDS_CAP });
  },
);

contactsRoutes.put(
  "/contact-fields",
  // `settings.manage`, not `conversations.note`: defining a field changes what
  // every contact record LOOKS like for the whole crew, which is workspace
  // configuration rather than annotating one customer.
  requireCapability("settings.manage"),
  async (c) => {
    const companyId = c.get("companyId");
    const db = getDb(getEnv(c.env));
    const body = await parseJsonBody(c, fieldDefsSchema);

    const keys = body.fields.map((field) => field.key);
    if (new Set(keys).size !== keys.length) {
      throw new ApiError(
        "validation_failed",
        "Two fields cannot share a key.",
      );
    }
    for (const field of body.fields) {
      const options = field.options ?? null;
      if (field.kind === "select" && (options === null || options.length === 0)) {
        throw new ApiError(
          "validation_failed",
          `${field.label} is a dropdown, so it needs some choices.`,
        );
      }
      if (field.kind !== "select" && options !== null && options.length > 0) {
        throw new ApiError(
          "validation_failed",
          `${field.label} is not a dropdown, so it cannot have choices.`,
        );
      }
    }

    // Delete-then-insert, in that order, because the set is small and ordered
    // and a diff would be more code for the same result. VALUES ARE NOT
    // TOUCHED: they live on `contacts.custom_fields` keyed by `key`, so a
    // field removed here and added back tomorrow finds its data waiting —
    // which is what the delete warning in the UI promises.
    unwrap(
      await db
        .from("contact_field_defs")
        .delete()
        .eq("company_id", companyId)
        .select("id"),
      "clear contact field definitions",
    );

    if (body.fields.length > 0) {
      unwrap(
        await db.from("contact_field_defs").insert(
          body.fields.map((field, index) => ({
            company_id: companyId,
            key: field.key,
            label: field.label,
            kind: field.kind,
            options: field.kind === "select" ? field.options ?? [] : null,
            position: index,
          })),
        ),
        "save contact field definitions",
      );
    }

    return c.json({ data: body.fields, cap: CONTACT_FIELDS_CAP });
  },
);
