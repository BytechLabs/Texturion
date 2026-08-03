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
 *          consent_attested_by + consent_attested event).
 *   DELETE /v1/contacts/:id         M   — soft delete (deleted_at).
 *   POST   /v1/contacts/import     O/A  — CSV multipart (phone,name,address,
 *          notes,opted_out?): E.164-normalize, per-row upsert clearing
 *          deleted_at, opted_out=true → opt_outs source='import' + events;
 *          returns { imported, updated, skipped, errors }.
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
import { getEnv } from "../env";
import { ApiError, errorResponse } from "../http/errors";
import { buildPage, encodeCursor } from "../http/pagination";
import { csvSafeText, parseCsvRows, serializeCsv } from "./core/csv";
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
  type ContactFieldKind,
  contactFieldValueError,
  detectContactColumns,
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
      "custom_fields" in body ||
      body.consent_attested === true,
    { message: "Provide at least one field to update." },
  );

/** Rows a single import may carry — bounds URL sizes and Worker CPU. */
const IMPORT_MAX_ROWS = 2000;
/** Chunk size for batched PostgREST calls during import. */
const IMPORT_CHUNK = 200;
/**
 * #36 whole-request ceilings, checked from Content-Length BEFORE formData()
 * buffers the body into Worker memory (SPEC §10 DoS posture — the
 * attachments-route pattern). Each is the route's per-file text cap plus
 * generous multipart overhead; the post-parse text-length checks remain the
 * exact backstop for chunked requests that carry no Content-Length.
 */
const MAX_CSV_IMPORT_BODY_BYTES = 3 * 1024 * 1024; // 2 MB CSV + overhead
const MAX_VCARD_IMPORT_BODY_BYTES = 6 * 1024 * 1024; // 5 MB .vcf + overhead

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

const TRUTHY_CSV = new Set(["true", "1", "yes", "y"]);

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

  let query = db
    .from("contacts")
    .select(CONTACT_LIST_COLUMNS)
    .eq("company_id", c.get("companyId"))
    .is("deleted_at", null);
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
  const rows = unwrap<
    {
      id: string;
      created_at: string;
      phone_e164: string;
      created_by_user_id: string | null;
      updated_by_user_id: string | null;
    }[]
  >(
    await query
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(limit + 1),
    "contacts list",
  );
  const page = buildPage(rows, limit, "created_at");

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

/** Export column order — round-trips with the CSV importer (D20 §3.1). */
const EXPORT_HEADER = [
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
  // consent state, even in appearance.
  const optOuts = unwrap<{ id: string; source: string }[]>(
    await db
      .from("opt_outs")
      .select("id,source")
      .eq("company_id", companyId)
      .eq("phone_e164", rows[0].phone_e164 as string)
      .is("revoked_at", null)
      .limit(1),
    "opt-out lookup",
  );
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
    //
    // Checked BEFORE the CSV is parsed so a caller cannot spend the upload and
    // then be told. `z.literal(true)` because only an explicit yes means
    // anything — a checkbox that accepts "false" is not an attestation.
    const attested = form.get("consent_attested");
    if (attested !== "true") {
      throw new ApiError(
        "validation_failed",
        "consent_attested: confirm that everyone in this file agreed to be " +
          "texted by this business before importing them.",
      );
    }
    const text = typeof file === "string" ? file : await file.text();
    if (text.length > 2 * 1024 * 1024) {
      throw new ApiError("validation_failed", "file: too large (max 2 MB).");
    }

    const parsed = parseCsvRows(text);
    const rows = parsed.map((row) => row.cells);
    if (rows.length < 2) {
      throw new ApiError(
        "validation_failed",
        "file: CSV must have a header row and at least one data row.",
      );
    }
    // Header detection is shared with the web importer (@loonext/shared), so a
    // file exported from another tool ("Phone Number", "Mobile", "Cell") lands
    // the same way whichever client posted it. Web rewrote the header before
    // uploading and the phones did not, so the same file that imported from a
    // laptop was rejected from a phone.
    const mapping = detectContactColumns(rows[0].map((cell) => cell.trim()));
    const phoneCol = mapping.phone ?? -1;
    if (phoneCol === -1) {
      throw new ApiError("validation_failed", "file: missing `phone` column.");
    }
    const nameCol = mapping.name ?? -1;
    const addressCol = mapping.address ?? -1;
    const notesCol = mapping.notes ?? -1;
    const optedOutCol = mapping.opted_out ?? -1;

    const dataRows = parsed.slice(1);
    if (dataRows.length > IMPORT_MAX_ROWS) {
      throw new ApiError(
        "validation_failed",
        `file: too many rows (max ${IMPORT_MAX_ROWS}).`,
      );
    }

    const companyId = c.get("companyId");
    const userId = c.get("userId");
    const db = getDb(getEnv(c.env));

    const errors: { row: number; reason: string }[] = [];
    interface ImportRow {
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
      if (byPhone.has(phone)) {
        errors.push({
          row: rowNumber,
          reason: `duplicate phone in file: ${phone}`,
        });
        return;
      }
      const optedOut =
        optedOutCol !== -1 &&
        TRUTHY_CSV.has((cells[optedOutCol] ?? "").trim().toLowerCase());
      byPhone.set(phone, { phone, cells, optedOut });
    });

    const entries = [...byPhone.values()];
    const phones = entries.map((entry) => entry.phone);

    // Pre-existing contacts, for imported-vs-updated counting.
    const existingPhones = new Set<string>();
    for (let i = 0; i < phones.length; i += IMPORT_CHUNK) {
      const chunk = phones.slice(i, i + IMPORT_CHUNK);
      const found = unwrap<{ phone_e164: string }[]>(
        await db
          .from("contacts")
          .select("phone_e164")
          .eq("company_id", companyId)
          .in("phone_e164", chunk),
        "import pre-check",
      );
      for (const row of found) existingPhones.add(row.phone_e164);
    }

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
    const upsertRows = entries.map(({ phone, cells }) => {
      const row: Record<string, unknown> = {
        company_id: companyId,
        phone_e164: phone,
        deleted_at: null,
        // #191 attribution: every imported/resurrected row records the importer
        // as its creator. A constant key, so the batching invariant holds.
        created_by_user_id: userId,
      };
      // #226: the basis the importer attested to, on every row the file
      // creates. `attested` is the same source a by-hand add writes (§5 D4),
      // because it is the same claim — a member is vouching for consent they
      // obtained off-platform. Constant keys, so the batching invariant holds.
      row.consent_source = "attested";
      row.consent_at = importedAt;
      row.consent_attested_by = userId;
      // A blank name cell means "this file says nothing about the name", never
      // "erase the name you already have". The column is decided for the whole
      // file, so one nameless row among named ones used to null out an existing
      // contact's name on import: a contact saved on someone's phone as a bare
      // number would blank the name the business had recorded for them, and the
      // wizard reported it as a plain "updated" row.
      //
      // Rows are grouped below so each batch keeps one key set.
      if (nameCol !== -1) {
        const name = unguard(cell(cells, nameCol));
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
    const contactIdByPhone = new Map<string, string>();
    // PostgREST derives the column list from the first row of a batch, so every
    // row in one request must carry the same keys. Rows that omit `name`
    // (a blank cell, which must not erase an existing name) are sent as their
    // own group rather than being padded back to a null.
    const withName = upsertRows.filter((row) => "name" in row);
    const withoutName = upsertRows.filter((row) => !("name" in row));
    for (const group of [withName, withoutName]) {
      for (let i = 0; i < group.length; i += IMPORT_CHUNK) {
        const chunk = group.slice(i, i + IMPORT_CHUNK);
        const upserted = unwrap<{ id: string; phone_e164: string }[]>(
          await db
            .from("contacts")
            .upsert(chunk, { onConflict: "company_id,phone_e164" })
            .select("id,phone_e164"),
          "import upsert",
        );
        for (const row of upserted) contactIdByPhone.set(row.phone_e164, row.id);
      }
    }

    // opted_out=true → opt_outs rows (source='import', SPEC §5) + events for
    // numbers that were not already actively opted out.
    const optedOutPhones = entries
      .filter((entry) => entry.optedOut)
      .map((entry) => entry.phone);
    if (optedOutPhones.length > 0) {
      const alreadyActive = new Set<string>();
      for (let i = 0; i < optedOutPhones.length; i += IMPORT_CHUNK) {
        const chunk = optedOutPhones.slice(i, i + IMPORT_CHUNK);
        const found = unwrap<{ phone_e164: string }[]>(
          await db
            .from("opt_outs")
            .select("phone_e164")
            .eq("company_id", companyId)
            .is("revoked_at", null)
            .in("phone_e164", chunk),
          "import opt-out pre-check",
        );
        for (const row of found) alreadyActive.add(row.phone_e164);
      }

      // An import may ADD an opt-out; it may never rewrite one that is already
      // standing. There is a single opt_outs row per (company, phone), so a
      // plain upsert overwrote `source` on an ACTIVE row: a carrier STOP became
      // source='import', and the revoke guard that makes a STOP unrevokable
      // stopped firing. The app would then let someone "opt them back in" while
      // the carrier block stood, so every send failed 40300 against a contact
      // the UI showed as textable. Only the customer can lift a STOP.
      //
      // Same two-step transition the manual opt-out route uses: revive a
      // REVOKED row, otherwise insert and let an existing active row win.
      const optOutRows = optedOutPhones.map((phone) => ({
        company_id: companyId,
        phone_e164: phone,
        source: "import",
        created_by: userId,
        revoked_at: null,
      }));
      for (let i = 0; i < optedOutPhones.length; i += IMPORT_CHUNK) {
        const chunk = optedOutPhones.slice(i, i + IMPORT_CHUNK);
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
      for (let i = 0; i < optOutRows.length; i += IMPORT_CHUNK) {
        unwrap(
          await db
            .from("opt_outs")
            .upsert(optOutRows.slice(i, i + IMPORT_CHUNK), {
              onConflict: "company_id,phone_e164",
              // An active row is left exactly as it is, whatever its source.
              ignoreDuplicates: true,
            })
            .select("id"),
          "import opt-out insert",
        );
      }

      const newlyOptedOut = optedOutPhones.filter(
        (phone) => !alreadyActive.has(phone),
      );
      if (newlyOptedOut.length > 0) {
        // Attach each event to the contact's most recent conversation when
        // one exists (SPEC §6 conversation_events rule), else null.
        const contactIds = newlyOptedOut
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
        const events: ConversationEventRow[] = newlyOptedOut.map((phone) => {
          const contactId = contactIdByPhone.get(phone);
          return {
            company_id: companyId,
            conversation_id:
              (contactId && latestByContact.get(contactId)) || null,
            actor_user_id: userId,
            type: "opted_out",
            payload: { phone_e164: phone, source: "import" },
          };
        });
        await insertConversationEvents(db, events);
      }
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
        source: "csv",
      },
    });
    return c.json({
      imported,
      updated: phones.length - imported,
      skipped: errors.length,
      errors,
    });
  },
);

/** Max cards a single .vcf may carry — same CPU bound as the CSV importer. */
const VCARD_MAX_CARDS = IMPORT_MAX_ROWS;

/**
 * POST /v1/contacts/import-vcard (D20 §3.2) — owner/admin (the §10 matrix,
 * matching the CSV importer). Accepts one .vcf with one-or-many VCARD blocks
 * (phone/Google/Apple export). Parses vCard 3.0 + 4.0 (FN/N → name, TEL →
 * phone), normalizes every TEL to E.164 against the company default country
 * (US/CA), drops un-normalizable numbers with a per-row reason. A card with
 * multiple valid TELs yields one contact per DISTINCT valid number (contacts
 * are phone-keyed). Reuses the exact idempotent upsert + dedupe the CSV
 * importer enforces (clears deleted_at; consent_source is not in the shipped
 * enum's import value, so — like the CSV path — it is left untouched). Same
 * { imported, updated, skipped, errors } shape as CSV.
 */
contactsRoutes.post(
  "/contacts/import-vcard",
  requireCapability("contacts.bulk"),
  async (c) => {
    // #36: declared-size gate BEFORE formData() buffers the whole body (§10).
    assertBodyWithinLimit(c, MAX_VCARD_IMPORT_BODY_BYTES);
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
    const text = typeof file === "string" ? file : await file.text();
    if (text.length > 5 * 1024 * 1024) {
      throw new ApiError("validation_failed", "file: too large (max 5 MB).");
    }

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

    const companyId = c.get("companyId");
    const userId = c.get("userId");
    const db = getDb(getEnv(c.env));

    const errors: { row: number; reason: string }[] = [];
    // One entry per DISTINCT valid E.164 across the whole file; first name wins.
    const byPhone = new Map<string, { name: string | null }>();

    cards.forEach((card, index) => {
      const cardNumber = index + 1; // 1-based card position
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
        if (byPhone.has(phone)) {
          errors.push({
            row: cardNumber,
            reason: `duplicate phone in file: ${phone}`,
          });
          continue;
        }
        byPhone.set(phone, { name: card.name });
      }
    });

    const entries = [...byPhone.entries()];
    const phones = entries.map(([phone]) => phone);

    // Pre-existing contacts → imported-vs-updated counting (mirrors CSV).
    const existingPhones = new Set<string>();
    for (let i = 0; i < phones.length; i += IMPORT_CHUNK) {
      const chunk = phones.slice(i, i + IMPORT_CHUNK);
      const found = unwrap<{ phone_e164: string }[]>(
        await db
          .from("contacts")
          .select("phone_e164")
          .eq("company_id", companyId)
          .in("phone_e164", chunk),
        "vcard pre-check",
      );
      for (const row of found) existingPhones.add(row.phone_e164);
    }

    // Idempotent upsert on (company_id, phone_e164), clearing deleted_at — the
    // exact CSV path. A name is written only when the card carried one, so a
    // re-import of a card without a name never nulls an existing name.
    const upsertRows = entries.map(([phone, { name }]) => {
      const row: Record<string, unknown> = {
        company_id: companyId,
        phone_e164: phone,
        deleted_at: null,
        // #191 attribution: the importer is the creator (same as the CSV path).
        created_by_user_id: userId,
      };
      if (name !== null) row.name = name;
      return row;
    });
    for (let i = 0; i < upsertRows.length; i += IMPORT_CHUNK) {
      unwrap(
        await db
          .from("contacts")
          .upsert(upsertRows.slice(i, i + IMPORT_CHUNK), {
            onConflict: "company_id,phone_e164",
          })
          .select("id"),
        "vcard upsert",
      );
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
        source: "vcard",
      },
    });
    return c.json({
      imported,
      updated: phones.length - imported,
      skipped: errors.length,
      errors,
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
