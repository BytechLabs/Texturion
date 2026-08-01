/**
 * Tag routes (SPEC §7, §10 matrix): tags are member-level, EXCEPT delete
 * which is owner/admin. Creation happens on attach
 * (POST /v1/conversations/:id/tags — conversations.ts); this file lists,
 * renames/recolors, and deletes.
 */
import { isPipelineStage, pipelineDeleteWarning } from "@loonext/shared";
import { Hono } from "hono";
import { z } from "zod";

import { requireCapability } from "../auth/company";
import type { AppEnv } from "../context";
import { getDb } from "../db";
import { getEnv } from "../env";
import { errorResponse } from "../http/errors";
import { parseJsonBody, pathUuid, unwrap } from "./core/http";

// #354: `pipeline_stage` rides along on every read. It is what the saved
// view, the conversion report and the delete guard all key on, and a
// client that cannot see it would have to guess from the name — which is
// exactly the coupling this column exists to remove.
const TAG_COLUMNS =
  "id,name,color,pipeline_stage,created_at,updated_at";

const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    color: z
      .string()
      .trim()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .nullable()
      .optional(),
  })
  .refine((body) => body.name !== undefined || "color" in body, {
    message: "Provide at least one field to update.",
  });

export const tagsRoutes = new Hono<AppEnv>();

tagsRoutes.get("/tags", requireCapability("conversations.read"), async (c) => {
  const db = getDb(getEnv(c.env));
  const rows = unwrap<unknown[]>(
    await db
      .from("tags")
      .select(TAG_COLUMNS)
      .eq("company_id", c.get("companyId"))
      .order("name", { ascending: true })
      // Defensive bound: this list is unpaginated (next_cursor is always null),
      // so cap the rows well above any real company's tag count rather than let
      // a pathological table return an unbounded response.
      .limit(500),
    "tags list",
  );
  return c.json({ data: rows, next_cursor: null });
});

tagsRoutes.patch("/tags/:id", requireCapability("conversations.note"), async (c) => {
  const id = pathUuid(c, "id");
  const body = await parseJsonBody(c, patchSchema);

  const patch: Record<string, unknown> = {};
  if (body.name !== undefined) patch.name = body.name;
  if ("color" in body) patch.color = body.color ?? null;

  const db = getDb(getEnv(c.env));
  const rows = unwrap<Record<string, unknown>[]>(
    await db
      .from("tags")
      .update(patch)
      .eq("company_id", c.get("companyId"))
      .eq("id", id)
      .select(TAG_COLUMNS),
    "tag update",
    "A tag with this name already exists.",
  );
  if (rows.length === 0) {
    return errorResponse(c, "not_found", "No such tag.");
  }
  return c.json(rows[0]);
});

/**
 * Tag delete is owner/admin (SPEC §10 matrix); conversation_tags rows cascade.
 *
 * #354: deleting a PIPELINE STAGE needs `?confirm_pipeline=true`. Renaming one
 * is deliberately left alone — nothing reads the name any more, so a crew that
 * wants "Quoted" instead of "Quote sent" should meet no friction at all. What
 * this stops is losing the stage, and with it every conversion that tag ever
 * recorded, by tidying up on a Tuesday.
 *
 * The gate is a query parameter rather than a client-side dialog because a
 * client-side dialog is not a gate: the mobile apps, a future integration and
 * anybody with curl would all be exempt from it.
 */
tagsRoutes.delete("/tags/:id", requireCapability("settings.manage"), async (c) => {
  const id = pathUuid(c, "id");
  const db = getDb(getEnv(c.env));

  const existing = unwrap<{ id: string; pipeline_stage: string | null }[]>(
    await db
      .from("tags")
      .select("id,pipeline_stage")
      .eq("company_id", c.get("companyId"))
      .eq("id", id)
      .limit(1),
    "tag delete lookup",
  );
  const tag = existing[0];
  if (!tag) return errorResponse(c, "not_found", "No such tag.");

  if (
    tag.pipeline_stage !== null &&
    isPipelineStage(tag.pipeline_stage) &&
    c.req.query("confirm_pipeline") !== "true"
  ) {
    return errorResponse(
      c,
      "conflict",
      pipelineDeleteWarning(tag.pipeline_stage),
    );
  }

  const rows = unwrap<{ id: string }[]>(
    await db
      .from("tags")
      .delete()
      .eq("company_id", c.get("companyId"))
      .eq("id", id)
      .select("id"),
    "tag delete",
  );
  if (rows.length === 0) {
    return errorResponse(c, "not_found", "No such tag.");
  }
  return c.body(null, 204);
});
