/**
 * #301 — where this customer came from.
 *
 * Every conversation arrives as a phone number and nothing else, so "where do
 * my customers come from?" — the question every small-business owner asks, and
 * the one with the most money attached — has no answer. We sit at the exact
 * point where it becomes knowable, which is first contact, and throw it away.
 *
 * These routes are the owner's own VOCABULARY. The attribution itself mostly
 * happens without them: a source set on a phone number is stamped onto every
 * conversation that line creates, by a database trigger, with nobody tapping
 * anything (20260804420000). That is deliberate and it is the whole design —
 * #301's devil's-advocate section is blunt that asking the tech to categorise
 * every inbound is a tax on the person with the least time, and that a source
 * field empty 80% of the time produces a MISLEADING report rather than none.
 *
 * ── OWNER-DEFINED, NEVER A FIXED LIST ─────────────────────────────────────
 *
 * "Neighbour" matters to a plumber and "Trade counter" matters to an
 * electrician; a taxonomy we chose would be wrong for both. Same argument
 * #298 settled about tags: suggest, never impose. So a workspace starts with
 * an empty list and nothing is seeded.
 *
 * ── ARCHIVED, NEVER DELETED ───────────────────────────────────────────────
 *
 * A source is the axis of a report about the past. Deleting one would erase
 * where four hundred existing customers came from, silently — so the column's
 * FK is `on delete restrict` (the opposite of every other optional FK here)
 * and this route offers archiving instead: gone from the picker, kept in the
 * record.
 */
import { Hono } from "hono";
import { z } from "zod";

import { recordAuditFromRequest } from "../audit/log";
import { requireCapability } from "../auth/company";
import type { AppEnv } from "../context";
import { getDb } from "../db";
import { getEnv } from "../env";
import { ApiError, errorResponse } from "../http/errors";
import { parseJsonBody, pathUuid } from "./core/http";

export const leadSourcesRoutes = new Hono<AppEnv>();

/** Matches the column: a chip in a one-handed picker, not a campaign name. */
const nameSchema = z.string().trim().min(1).max(40);

interface LeadSourceRow {
  id: string;
  name: string;
  archived_at: string | null;
  created_at: string;
}

/**
 * GET /v1/lead-sources — the workspace's own list.
 *
 * Readable by anybody who can see the inbox, because the picker on a
 * conversation is where most of these are used and a tech needs the names to
 * tap one. Archived entries come back too, flagged: a report about last
 * quarter has to be able to name a source that has since been retired.
 */
leadSourcesRoutes.get(
  "/lead-sources",
  requireCapability("conversations.read"),
  async (c) => {
    const db = getDb(getEnv(c.env));
    const { data, error } = await db
      .from("lead_sources")
      .select("id,name,archived_at,created_at")
      .eq("company_id", c.get("companyId"))
      .order("name", { ascending: true });
    if (error) throw new Error(`lead_sources lookup failed: ${error.message}`);
    return c.json({ data: (data ?? []) as LeadSourceRow[] });
  },
);

const createSchema = z.object({ name: nameSchema });

/**
 * POST /v1/lead-sources — add one (O/A).
 *
 * Creating is owner/admin while USING one is member-level, and the split is
 * the same one #298 drew for tags: a tech who cannot categorise a thread
 * leaves it uncategorised, which is honest; a tech who invents a fifth spelling
 * of "Facebook" makes the report wrong in a way nobody notices. The vocabulary
 * is the report's axis, and the axis belongs to whoever reads the report.
 */
leadSourcesRoutes.post(
  "/lead-sources",
  requireCapability("settings.manage"),
  async (c) => {
    const db = getDb(getEnv(c.env));
    const companyId = c.get("companyId");
    const { name } = await parseJsonBody(c, createSchema);

    const { data, error } = await db
      .from("lead_sources")
      .insert({ company_id: companyId, name, created_by: c.get("userId") })
      .select("id,name,archived_at,created_at")
      .limit(1);
    if (error) {
      // A name they already have is their own mistake — say which, rather than
      // surfacing a 23505. It is also the commonest way this call fails: the
      // archived one is still in the list and still holds the name.
      if (error.code === "23505") {
        throw new ApiError(
          "validation_failed",
          `You already have a source called "${name}". If you archived it, ` +
            `bring it back rather than making a second one — a report cannot ` +
            `tell two identical names apart.`,
        );
      }
      throw new Error(`lead_sources insert failed: ${error.message}`);
    }

    const row = (data ?? [])[0] as LeadSourceRow | undefined;
    await recordAuditFromRequest(db, c, {
      companyId,
      action: "lead_source.created",
      targetType: "lead_source",
      targetId: row?.id ?? null,
      after: { name },
    });
    return c.json(row, 201);
  },
);

const patchSchema = z
  .object({
    name: nameSchema.optional(),
    /**
     * True retires it, false brings it back. There is no DELETE on this route
     * at all: the FK refuses it, and the reason the FK refuses it is that a
     * source is the axis of a report about the past.
     */
    archived: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: "Provide at least one field to update.",
  });

/** PATCH /v1/lead-sources/:id — rename, archive, or bring back (O/A). */
leadSourcesRoutes.patch(
  "/lead-sources/:id",
  requireCapability("settings.manage"),
  async (c) => {
    const db = getDb(getEnv(c.env));
    const companyId = c.get("companyId");
    const id = pathUuid(c, "id");
    const body = await parseJsonBody(c, patchSchema);

    const patch: Record<string, unknown> = {};
    if (body.name !== undefined) patch.name = body.name;
    if (body.archived !== undefined) {
      patch.archived_at = body.archived ? new Date().toISOString() : null;
    }

    const { data, error } = await db
      .from("lead_sources")
      .update(patch)
      .eq("company_id", companyId)
      .eq("id", id)
      .select("id,name,archived_at,created_at");
    if (error) {
      if (error.code === "23505") {
        throw new ApiError(
          "validation_failed",
          `You already have a source called "${body.name}".`,
        );
      }
      throw new Error(`lead_sources update failed: ${error.message}`);
    }
    const row = (data ?? [])[0] as LeadSourceRow | undefined;
    if (!row) return errorResponse(c, "not_found", "No such source.");

    await recordAuditFromRequest(db, c, {
      companyId,
      action: body.archived === undefined
        ? "lead_source.renamed"
        : body.archived
          ? "lead_source.archived"
          : "lead_source.restored",
      targetType: "lead_source",
      targetId: row.id,
      after: { name: row.name, archived: row.archived_at !== null },
    });
    return c.json(row);
  },
);

/**
 * A source id must belong to the workspace selecting it.
 *
 * The foreign key only says the row exists somewhere. Without this a member
 * could attribute their conversation — or their phone line — to another
 * business's source id, and the name would then appear in their own report.
 *
 * This is the lesson from #309's greeting selection, applied before it could
 * be a bug rather than after: the company scope on an UPDATE decides which row
 * is written, never which id lands in it.
 */
export async function assertOwnLeadSource(
  c: { get: (key: "companyId") => string; env: unknown },
  leadSourceId: string,
): Promise<void> {
  const db = getDb(getEnv(c.env as never));
  const { data, error } = await db
    .from("lead_sources")
    .select("id,archived_at")
    .eq("company_id", c.get("companyId"))
    .eq("id", leadSourceId)
    .limit(1);
  if (error) throw new Error(`lead_sources lookup failed: ${error.message}`);
  const row = (data ?? [])[0] as { archived_at: string | null } | undefined;
  if (!row) throw new ApiError("validation_failed", "No such source.");
  // An archived source stays valid on the conversations that already carry it
  // — that is the point of archiving — but nothing new may be filed under a
  // name the owner has retired, or the list would never actually shrink.
  if (row.archived_at !== null) {
    throw new ApiError(
      "validation_failed",
      "That source is archived. Bring it back first, or pick another.",
    );
  }
}
