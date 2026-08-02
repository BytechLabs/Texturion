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
// #298: `description` rides along too — what a tag MEANS is only useful at the
// moment somebody is choosing between two of them, which is every read of this
// list, not a detail screen nobody opens.
const TAG_COLUMNS =
  "id,name,color,description,pipeline_stage,created_at,updated_at";

const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    color: z
      .string()
      .trim()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .nullable()
      .optional(),
    /**
     * #298: what this tag means, in the crew's own words. Null clears it.
     *
     * Optional, and it stays optional. A required description would be
     * answered with "warranty" for a tag named Warranty by everybody who was
     * in a hurry, which is worse than nothing because it looks like an answer.
     * 200 chars mirrors tags_description_len: a sentence, not a policy.
     */
    description: z.string().trim().max(200).nullable().optional(),
  })
  .refine(
    (body) =>
      body.name !== undefined || "color" in body || "description" in body,
    { message: "Provide at least one field to update." },
  );

const mergeSchema = z.object({ into_tag_id: z.uuid() });

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
  // An empty string is a cleared field, not a description of "". The column is
  // nullable and every reader branches on null, so normalising here keeps the
  // "no description" state single-valued.
  if ("description" in body) {
    patch.description =
      body.description === null || body.description === "" ? null : body.description;
  }

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

/**
 * #298 — GET /v1/tags/usage: how much each tag is actually used.
 *
 * "Cleanup is impossible without being able to see the problem." A count and a
 * last-used date make the dead tags and the near-duplicates both obvious in one
 * list, and neither is visible from the names alone.
 *
 * Member-readable rather than admin-only: seeing that "warranty" has 40 uses
 * and "wrnty" has 2 is what stops somebody attaching the wrong one, and that is
 * everybody's problem.
 */
tagsRoutes.get("/tags/usage", requireCapability("conversations.read"), async (c) => {
  const db = getDb(getEnv(c.env));
  const rows = unwrap<unknown[]>(
    await db.rpc("api_tag_usage", { p_company_id: c.get("companyId") }),
    "tag usage",
  );
  return c.json({ data: rows, next_cursor: null });
});

/**
 * #298 — POST /v1/tags/:id/merge: fold this tag into another, losing nothing.
 *
 * The operation the system was missing. Delete was the only cleanup and delete
 * loses every association, so an admin who found six variants could only ever
 * destroy five.
 *
 * Owner/admin, matching delete: this rewrites how a workspace's history is
 * categorised, and unlike a rename it cannot be undone by typing the old name
 * back. `settings.manage` rather than a rank, per #315.
 */
tagsRoutes.post("/tags/:id/merge", requireCapability("settings.manage"), async (c) => {
  const from = pathUuid(c, "id");
  const body = await parseJsonBody(c, mergeSchema);
  const db = getDb(getEnv(c.env));

  const result = unwrap<{
    outcome: string;
    moved?: number;
    already_both?: number;
    stage_moved?: boolean;
    from_stage?: string;
    into_stage?: string;
  }>(
    await db.rpc("api_merge_tags", {
      p_company_id: c.get("companyId"),
      p_from_tag: from,
      p_into_tag: body.into_tag_id,
    }),
    "tag merge",
  );

  if (result.outcome === "not_found") {
    return errorResponse(c, "not_found", "No such tag.");
  }
  if (result.outcome === "same_tag") {
    return errorResponse(c, "validation_failed", "Pick a different tag to merge into.");
  }
  if (result.outcome === "two_stages") {
    // #354/D108: the survivor can carry one stage, and choosing silently would
    // throw away the other's history — including every conversion it recorded.
    return errorResponse(
      c,
      "conflict",
      "Both of these are pipeline stages, so merging them would lose one of " +
        "your win-rate categories. Rename one instead, or delete it deliberately.",
    );
  }
  return c.json({
    merged: true,
    moved: result.moved ?? 0,
    already_both: result.already_both ?? 0,
    stage_moved: result.stage_moved ?? false,
  });
});
