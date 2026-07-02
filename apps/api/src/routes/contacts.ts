/**
 * Contact routes (SPEC §5, §7, §10 matrix):
 *
 *   GET    /v1/contacts             M   — cursor list (created_at, id) DESC,
 *          trgm-backed `q` over name/phone, soft-deleted hidden.
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
import { parseCsv } from "./core/csv";
import {
  insertConversationEvents,
  latestConversationId,
  type ConversationEventRow,
} from "./core/events";
import {
  keysetFilter,
  orIlikeValue,
  parseCursor,
  parseJsonBody,
  parseLimit,
  pathUuid,
  unwrap,
} from "./core/http";
import { normalizeNanpPhone } from "./core/phone";

const CONTACT_COLUMNS =
  "id,phone_e164,name,address,notes,consent_source,consent_at," +
  "consent_attested_by,first_identification_sent_at,deleted_at,created_at," +
  "updated_at";

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
  const rows = unwrap<{ id: string; created_at: string }[]>(
    await query
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(limit + 1),
    "contacts list",
  );
  return c.json(buildPage(rows, limit, "created_at"));
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
  };
  if (body.name !== undefined) row.name = body.name;
  if (body.address !== undefined) row.address = body.address;
  if (body.notes !== undefined) row.notes = body.notes;

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
  return c.json({ ...contact, opted_out: optOuts.length > 0 });
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
  if ("address" in body) patch.address = body.address ?? null;
  if ("notes" in body) patch.notes = body.notes ?? null;
  if (body.consent_attested === true) {
    patch.consent_source = "attested";
    patch.consent_at = new Date().toISOString();
    patch.consent_attested_by = userId;
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
  return c.json(rows[0]);
});

contactsRoutes.delete("/contacts/:id", requireRole("member"), async (c) => {
  const id = pathUuid(c, "id");
  const db = getDb(getEnv(c.env));
  const rows = unwrap<{ id: string }[]>(
    await db
      .from("contacts")
      .update({ deleted_at: new Date().toISOString() })
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
    const upsertRows = entries.map(({ phone, cells }) => {
      const row: Record<string, unknown> = {
        company_id: companyId,
        phone_e164: phone,
        deleted_at: null,
      };
      if (nameCol !== -1) row.name = cell(cells, nameCol);
      if (addressCol !== -1) row.address = cell(cells, addressCol);
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
