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
import { Hono, type Context } from "hono";
import { z } from "zod";

import { requireRole } from "../auth/company";
import type { AppEnv } from "../context";
import { getDb } from "../db";
import { getEnv } from "../env";
import { ApiError, errorResponse } from "../http/errors";
import { buildPage } from "../http/pagination";
import { csvSafeText, parseCsv, serializeCsv } from "./core/csv";
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
import { normalizeNanpPhone } from "./core/phone";
import { parseVCards } from "./core/vcard";

const CONTACT_COLUMNS =
  "id,phone_e164,name,address,notes,consent_source,consent_at," +
  "consent_attested_by,created_by_user_id,updated_by_user_id," +
  "deleted_at,created_at,updated_at";

const createSchema = z.object({
  phone_e164: z.string().trim().min(1).max(32),
  name: z.string().trim().min(1).max(200).optional(),
  address: z.string().trim().min(1).max(500).optional(),
  notes: z.string().max(5000).optional(),
});

const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(200).nullable().optional(),
    address: z.string().trim().min(1).max(500).nullable().optional(),
    notes: z.string().max(5000).nullable().optional(),
    // §5 consent attestation: only literal true has meaning.
    consent_attested: z.literal(true).optional(),
  })
  .refine(
    (body) =>
      "name" in body ||
      "address" in body ||
      "notes" in body ||
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

export const contactsRoutes = new Hono<AppEnv>();

contactsRoutes.get("/contacts", requireRole("member"), async (c) => {
  const limit = parseLimit(c, 25, 100);
  const cursor = parseCursor(c);
  const rawQ = c.req.query("q")?.trim();
  const db = getDb(getEnv(c.env));

  let query = db
    .from("contacts")
    .select(CONTACT_COLUMNS)
    .eq("company_id", c.get("companyId"))
    .is("deleted_at", null);
  if (rawQ !== undefined && rawQ !== "") {
    if (rawQ.length > 200) {
      throw new ApiError("validation_failed", "q: too long (max 200).");
    }
    const q = orIlikeValue(rawQ);
    query = query.or(`name.ilike.*${q}*,phone_e164.ilike.*${q}*`);
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

  // DESIGN G6: the contacts table shows an opted-out badge, so list rows
  // carry the same app-side opt-out state as GET /v1/contacts/:id — one
  // batched lookup per page (max 100 rows).
  const optedOutPhones = new Set<string>();
  if (page.data.length > 0) {
    const active = unwrap<{ phone_e164: string }[]>(
      await db
        .from("opt_outs")
        .select("phone_e164")
        .eq("company_id", c.get("companyId"))
        .is("revoked_at", null)
        .in(
          "phone_e164",
          [...new Set(page.data.map((row) => row.phone_e164))],
        ),
      "opt-out lookup",
    );
    for (const row of active) optedOutPhones.add(row.phone_e164);
  }

  // DESIGN G6 "last activity" = conversation activity: the newest
  // conversations.last_message_at per contact (messages and notes both move
  // it — routes/conversations.ts), one batched lookup per page. Ordered DESC
  // so first-seen per contact wins.
  const lastActivityByContact = new Map<string, string>();
  if (page.data.length > 0) {
    const activity = unwrap<{ contact_id: string; last_message_at: string }[]>(
      await db
        .from("conversations")
        .select("contact_id,last_message_at")
        .eq("company_id", c.get("companyId"))
        .in(
          "contact_id",
          page.data.map((row) => row.id),
        )
        .order("last_message_at", { ascending: false }),
      "contact activity lookup",
    );
    for (const row of activity) {
      if (!lastActivityByContact.has(row.contact_id)) {
        lastActivityByContact.set(row.contact_id, row.last_message_at);
      }
    }
  }

  // #191 attribution: resolve created/updated actor names for the page in one
  // batched profiles lookup (the same mechanism as the detail route), so each
  // list row carries created_by_name/updated_by_name — null when the actor was
  // never recorded (older rows) or the profile has no name.
  const actorNames = await resolveActorNames(
    db,
    page.data.flatMap((row) => [row.created_by_user_id, row.updated_by_user_id]),
  );

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
contactsRoutes.get("/contacts/export", requireRole("member"), async (c) => {
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
    const q = orIlikeValue(rawQ);
    query = query.or(`name.ilike.*${q}*,phone_e164.ilike.*${q}*`);
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
  // tags = the union of tags across its conversations. One batched lookup per
  // export keeps this a single round-trip regardless of contact count.
  const tagsByContact = new Map<string, Set<string>>();
  if (rows.length > 0) {
    interface TagJoinRow {
      contact_id: string;
      conversation_tags: { tags: { name: string } | null }[];
    }
    const joins = unwrap<TagJoinRow[]>(
      await db
        .from("conversations")
        .select("contact_id,conversation_tags(tags(name))")
        .eq("company_id", companyId)
        .in(
          "contact_id",
          rows.map((row) => row.id),
        ),
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
      // Free-text columns are guarded against CSV/formula injection (a name or
      // tag beginning with =+-@ etc. is apostrophe-prefixed so a spreadsheet
      // treats it as text). phone_e164 is format-validated E.164 — left bare so
      // the round-trip stays exact; consent_*/created_at are enum/timestamps.
      csvSafeText(row.name),
      row.phone_e164,
      csvSafeText([...(tagsByContact.get(row.id) ?? [])].join(";")),
      row.consent_source,
      row.consent_at,
      row.created_at,
    ]),
  ];
  // UTF-8 BOM (D20 §3.1) so Excel reads the encoding correctly. Emit the body
  // as bytes with a literal EF BB BF prefix: `new Response(string)` would strip
  // a leading U+FEFF, so the BOM must be raw bytes, not a string char.
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

contactsRoutes.post("/contacts", requireRole("member"), async (c) => {
  const body = await parseJsonBody(c, createSchema);
  const phone = normalizeNanpPhone(body.phone_e164);
  if (!phone) {
    throw new ApiError(
      "validation_failed",
      "phone_e164: must be a US or Canada number (E.164, assigned area code).",
    );
  }

  const db = getDb(getEnv(c.env));
  const row: Record<string, unknown> = {
    company_id: c.get("companyId"),
    phone_e164: phone,
    // Upsert semantics (SPEC §7): any create path resurrects a soft-deleted
    // contact.
    deleted_at: null,
    // #191 attribution: record who created (or resurrected) the contact.
    created_by_user_id: c.get("userId"),
  };
  if (body.name !== undefined) row.name = body.name;
  if (body.notes !== undefined) row.notes = body.notes;
  if (body.address !== undefined) {
    row.address = body.address;
    // A new/resurrected contact with an address needs geocoding (D25). The
    // create schema requires a non-empty address, so this always queues.
    Object.assign(row, geocodeReset(body.address));
  }

  const rows = unwrap<Record<string, unknown>[]>(
    await db
      .from("contacts")
      .upsert(row, { onConflict: "company_id,phone_e164" })
      .select(CONTACT_COLUMNS),
    "contact upsert",
  );
  return c.json(rows[0], 201);
});

contactsRoutes.get("/contacts/:id", requireRole("member"), async (c) => {
  const id = pathUuid(c, "id");
  const companyId = c.get("companyId");
  const db = getDb(getEnv(c.env));

  const contact = await findContact(db, companyId, id);
  if (!contact) {
    return errorResponse(c, "not_found", "No such contact.");
  }
  const optOuts = unwrap<{ id: string }[]>(
    await db
      .from("opt_outs")
      .select("id")
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
  const actorNames = await resolveActorNames(db, [createdBy, updatedBy]);
  return c.json({
    ...contact,
    opted_out: optOuts.length > 0,
    created_by_name: createdBy ? actorNames.get(createdBy) ?? null : null,
    updated_by_name: updatedBy ? actorNames.get(updatedBy) ?? null : null,
  });
});

contactsRoutes.patch("/contacts/:id", requireRole("member"), async (c) => {
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
  return c.json(rows[0]);
});

contactsRoutes.delete("/contacts/:id", requireRole("member"), async (c) => {
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
  requireRole("admin"),
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
    const text = typeof file === "string" ? file : await file.text();
    if (text.length > 2 * 1024 * 1024) {
      throw new ApiError("validation_failed", "file: too large (max 2 MB).");
    }

    const rows = parseCsv(text);
    if (rows.length < 2) {
      throw new ApiError(
        "validation_failed",
        "file: CSV must have a header row and at least one data row.",
      );
    }
    const header = rows[0].map((cell) => cell.trim().toLowerCase());
    const col = (name: string) => header.indexOf(name);
    const phoneCol = col("phone");
    if (phoneCol === -1) {
      throw new ApiError("validation_failed", "file: missing `phone` column.");
    }
    const nameCol = col("name");
    const addressCol = col("address");
    const notesCol = col("notes");
    const optedOutCol = col("opted_out");

    const dataRows = rows.slice(1);
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

    dataRows.forEach((cells, index) => {
      // +2: 1-based line numbers, +1 for the header row.
      const rowNumber = index + 2;
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
    const upsertRows = entries.map(({ phone, cells }) => {
      const row: Record<string, unknown> = {
        company_id: companyId,
        phone_e164: phone,
        deleted_at: null,
        // #191 attribution: every imported/resurrected row records the importer
        // as its creator. A constant key, so the batching invariant holds.
        created_by_user_id: userId,
      };
      if (nameCol !== -1) row.name = unguard(cell(cells, nameCol));
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
    for (let i = 0; i < upsertRows.length; i += IMPORT_CHUNK) {
      const chunk = upsertRows.slice(i, i + IMPORT_CHUNK);
      const upserted = unwrap<{ id: string; phone_e164: string }[]>(
        await db
          .from("contacts")
          .upsert(chunk, { onConflict: "company_id,phone_e164" })
          .select("id,phone_e164"),
        "import upsert",
      );
      for (const row of upserted) contactIdByPhone.set(row.phone_e164, row.id);
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

      const optOutRows = optedOutPhones.map((phone) => ({
        company_id: companyId,
        phone_e164: phone,
        source: "import",
        created_by: userId,
        revoked_at: null,
      }));
      for (let i = 0; i < optOutRows.length; i += IMPORT_CHUNK) {
        unwrap(
          await db
            .from("opt_outs")
            .upsert(optOutRows.slice(i, i + IMPORT_CHUNK), {
              onConflict: "company_id,phone_e164",
            })
            .select("id"),
          "import opt-out upsert",
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
  requireRole("admin"),
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
  requireRole("member"),
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

    const active = unwrap<Record<string, unknown>[]>(
      await db
        .from("opt_outs")
        .select("id,phone_e164,source,created_at,revoked_at")
        .eq("company_id", companyId)
        .eq("phone_e164", phone)
        .is("revoked_at", null)
        .limit(1),
      "opt-out lookup",
    );
    if (active.length > 0) {
      // Already opted out — idempotent, no duplicate timeline event.
      return c.json(active[0]);
    }

    const rows = unwrap<Record<string, unknown>[]>(
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
          { onConflict: "company_id,phone_e164" },
        )
        .select("id,phone_e164,source,created_at,revoked_at"),
      "opt-out upsert",
    );

    await insertConversationEvents(db, [
      {
        company_id: companyId,
        conversation_id: await latestConversationId(db, companyId, id),
        actor_user_id: userId,
        type: "opted_out",
        payload: { phone_e164: phone, source: "manual" },
      },
    ]);
    return c.json(rows[0], 201);
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
  return c.json(rows[0]);
}

contactsRoutes.post(
  "/contacts/:id/opt-out/revoke",
  requireRole("member"),
  revokeOptOut,
);
// Alias: DELETE of the opt-out resource — same revoke semantics.
contactsRoutes.delete(
  "/contacts/:id/opt-out",
  requireRole("member"),
  revokeOptOut,
);
