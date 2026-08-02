/**
 * Saved-reply routes (SPEC §7, §10 matrix).
 *
 * #461 (founder: "Member can see/edit templates, should this be more
 * granular??"): USING a saved reply stays every member's — that is the whole
 * point of the composer's "/" picker, and it is what a crew does all day.
 * CURATING the shared set became admin's, because a template is words the whole
 * crew sends in the business's name: the same class of thing as the away
 * message, the missed-call text-back and the voicemail greeting, all three of
 * which were already admin. One member's edit changes what everyone sends.
 *
 *   GET    /v1/templates      conversations.read
 *   POST   /v1/templates      settings.manage   { name, body }
 *   PATCH  /v1/templates/:id  settings.manage   { name?, body? }
 *   DELETE /v1/templates/:id  settings.manage
 */
import { Hono } from "hono";
import { z } from "zod";

import { recordAuditFromRequest } from "../audit/log";
import { requireCapability } from "../auth/company";
import type { AppEnv } from "../context";
import { getDb } from "../db";
import { getEnv } from "../env";
import { errorResponse } from "../http/errors";
import { resolveActorNames } from "./core/attribution";
import { parseJsonBody, pathUuid, unwrap } from "./core/http";

const TEMPLATE_COLUMNS =
  // #419: `updated_by` rides every read so a list can say who last changed
  // shared copy. Not a permission — visibility, which is what settles a
  // question before it becomes a dispute.
  "id,name,body,category,created_by,updated_by,created_at,updated_at";

/**
 * What the audit log is told about a template (#419).
 *
 * NAME AND SHAPE, NEVER THE BODY. `routes/companies.ts` established the rule
 * for `away_message`, `mctb_message` and `voicemail_greeting` — "an authored
 * message is reported as present/absent instead" — and a saved reply is the
 * same class of thing: copy the business wrote. The log records that somebody
 * changed the words and how long the new ones are; the words themselves live
 * in the row, which is now recoverable rather than deleted outright.
 */
function auditShape(row: Record<string, unknown>): Record<string, unknown> {
  return {
    name: row.name,
    body_length: typeof row.body === "string" ? row.body.length : null,
  };
}

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(2000),
  /**
   * #274: the crew's own grouping. Free text and optional — a taxonomy we
   * imposed would be ignored in favour of whatever people were already doing,
   * and a category is worth typing at thirty templates and friction at five.
   */
  // No min(1): an empty input box is how somebody CLEARS a category, and
   // rejecting "" would make the clear a 422 the client has to know to
   // avoid. Normalised to null in the handler, which is what the column's
   // CHECK requires and what every reader branches on.
   category: z.string().trim().max(40).nullable().optional(),
});

const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    body: z.string().trim().min(1).max(2000).optional(),
  /**
     * #274: the crew's own grouping. Free text and optional — a taxonomy we
     * imposed would be ignored in favour of whatever people were already doing,
     * and a category is worth typing at thirty templates and friction at five.
     */
    // No min(1): an empty input box is how somebody CLEARS a category, and
   // rejecting "" would make the clear a 422 the client has to know to
   // avoid. Normalised to null in the handler, which is what the column's
   // CHECK requires and what every reader branches on.
   category: z.string().trim().max(40).nullable().optional(),
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.body !== undefined ||
      "category" in value,
    { message: "Provide at least one field to update." },
  );

const NAME_CONFLICT = "A saved reply with this name already exists.";

export const templatesRoutes = new Hono<AppEnv>();

templatesRoutes.get("/templates", requireCapability("conversations.read"), async (c) => {
  const db = getDb(getEnv(c.env));
  /**
   * #274 — two orders, because two people are asking different questions.
   *
   * `sort=use` is the COMPOSER's picker: somebody about to send is looking for
   * the reply they send twenty times a day, and alphabetical puts it wherever
   * its name happens to fall. Rows come back with their counts already joined,
   * so the picker opens on one request rather than a list plus a usage table
   * to sort it by.
   *
   * The default stays alphabetical, for the SETTINGS list: somebody
   * maintaining thirty templates wants a stable place to find one, and a list
   * that reorders itself as the crew works is a list you cannot learn.
   */
  const byUse = c.req.query("sort") === "use";
  const rows = byUse
    ? unwrap<Record<string, unknown>[]>(
        await db.rpc("api_templates_by_use", {
          p_company_id: c.get("companyId"),
        }),
        "templates by use",
      )
    : unwrap<Record<string, unknown>[]>(
        await db
          .from("templates")
          .select(TEMPLATE_COLUMNS)
          .eq("company_id", c.get("companyId"))
          .is("deleted_at", null)
          .order("name", { ascending: true })
          // Defensive bound: this list is unpaginated (next_cursor is always
          // null), so cap the rows well above any real company's saved-reply
          // count rather than let a pathological table return an unbounded
          // response.
          .limit(500),
        "templates list",
      );

  // #419 ask 3: resolve the editor SERVER-SIDE, through the same #191
  // attribution helper every other surface uses. Three clients each mapping a
  // uuid against their own copy of the crew list is the shape #376 warns
  // about — and it would have cost each of them an extra request for one word.
  // An unresolved id (a member who has left, or an edit predating the column)
  // yields no name, and the clients omit the attribution rather than printing
  // a uuid.
  const names = await resolveActorNames(
    db,
    rows.map((row) => (row as { updated_by?: string | null }).updated_by),
  );
  const data = rows.map((row) => {
    const template = row as Record<string, unknown>;
    const editor = template.updated_by as string | null;
    return {
      ...template,
      updated_by_name: editor ? names.get(editor) ?? null : null,
    };
  });
  return c.json({ data, next_cursor: null });
});

templatesRoutes.post("/templates", requireCapability("settings.manage"), async (c) => {
  const body = await parseJsonBody(c, createSchema);
  const db = getDb(getEnv(c.env));
  const rows = unwrap<Record<string, unknown>[]>(
    await db
      .from("templates")
      .insert({
        company_id: c.get("companyId"),
        name: body.name,
        body: body.body,
        // #274: normalised the same way the patch path does.
        category: body.category === "" ? null : (body.category ?? null),
        created_by: c.get("userId"),
      })
      .select(TEMPLATE_COLUMNS),
    "template create",
    NAME_CONFLICT,
  );
  await recordAuditFromRequest(db, c, {
    companyId: c.get("companyId"),
    action: "template.created",
    targetType: "template",
    targetId: rows[0].id as string,
    after: auditShape(rows[0]),
  });
  return c.json(rows[0], 201);
});

templatesRoutes.patch("/templates/:id", requireCapability("settings.manage"), async (c) => {
  const id = pathUuid(c, "id");
  const body = await parseJsonBody(c, patchSchema);

  const patch: Record<string, unknown> = {};
  if (body.name !== undefined) patch.name = body.name;
  if (body.body !== undefined) patch.body = body.body;
  // #274: an empty string is a cleared grouping, not a category named "". The
  // column is nullable and every reader branches on null, so normalising here
  // keeps "no category" single-valued.
  if ("category" in body) {
    patch.category =
      body.category === null || body.category === "" ? null : body.category;
  }

  patch.updated_by = c.get("userId");

  const db = getDb(getEnv(c.env));
  // Read first: "what did it say before" is the question asked after a price
  // or a promise turns up in a message nobody remembers writing, and after the
  // update there is nothing left to read.
  const before = unwrap<Record<string, unknown>[]>(
    await db
      .from("templates")
      .select(TEMPLATE_COLUMNS)
      .eq("company_id", c.get("companyId"))
      .eq("id", id)
      .is("deleted_at", null)
      .limit(1),
    "template read",
  );

  const rows = unwrap<Record<string, unknown>[]>(
    await db
      .from("templates")
      .update(patch)
      .eq("company_id", c.get("companyId"))
      .eq("id", id)
      .is("deleted_at", null)
      .select(TEMPLATE_COLUMNS),
    "template update",
    NAME_CONFLICT,
  );
  if (rows.length === 0) {
    return errorResponse(c, "not_found", "No such template.");
  }
  await recordAuditFromRequest(db, c, {
    companyId: c.get("companyId"),
    action: "template.updated",
    targetType: "template",
    targetId: id,
    before: before[0] ? auditShape(before[0]) : {},
    after: auditShape(rows[0]),
  });
  return c.json(rows[0]);
});

/**
 * #475 — GET /v1/templates/usage: how much each saved reply is actually used.
 *
 * One query, which is what the issue asks for: the count, the edit count and
 * the last-used date per template, deleted ones excluded. Everything the
 * picker's sort and the "which of these is dead" question need.
 *
 * Member-readable rather than admin-only, matching the list itself. The sort
 * order of somebody's own picker is not a permission, and a member who can see
 * the templates can already see how many there are.
 */
templatesRoutes.get(
  "/templates/usage",
  requireCapability("conversations.read"),
  async (c) => {
    const db = getDb(getEnv(c.env));
    const rows = unwrap<unknown[]>(
      await db.rpc("api_template_usage", { p_company_id: c.get("companyId") }),
      "template usage",
    );
    return c.json({ data: rows, next_cursor: null });
  },
);

templatesRoutes.delete("/templates/:id", requireCapability("settings.manage"), async (c) => {
  const id = pathUuid(c, "id");
  const db = getDb(getEnv(c.env));
  // #419: SOFT. Templates were the one shared object in this codebase that
  // simply ceased to exist — tasks (D17) and attachments (D19) both mark
  // `deleted_at`, and an offboarded member is soft-marked too. An accidental
  // delete here was unrecoverable, which is true regardless of anybody's
  // intent and is most of what made member-level deletion uncomfortable.
  //
  // Already-deleted rows are filtered, so a repeated DELETE answers 404 rather
  // than silently re-stamping a newer timestamp over the real one.
  const rows = unwrap<Record<string, unknown>[]>(
    await db
      .from("templates")
      .update({ deleted_at: new Date().toISOString(), updated_by: c.get("userId") })
      .eq("company_id", c.get("companyId"))
      .eq("id", id)
      .is("deleted_at", null)
      .select(TEMPLATE_COLUMNS),
    "template delete",
  );
  if (rows.length === 0) {
    return errorResponse(c, "not_found", "No such template.");
  }
  await recordAuditFromRequest(db, c, {
    companyId: c.get("companyId"),
    action: "template.deleted",
    targetType: "template",
    targetId: id,
    before: auditShape(rows[0]),
  });
  return c.body(null, 204);
});
