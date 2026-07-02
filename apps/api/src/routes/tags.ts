/**
 * Tag routes (SPEC §7, §10 matrix): tags are member-level, EXCEPT delete
 * which is owner/admin. Creation happens on attach
 * (POST /v1/conversations/:id/tags — conversations.ts); this file lists,
 * renames/recolors, and deletes.
 */
import { Hono } from "hono";
import { z } from "zod";

import { requireRole } from "../auth/company";
import type { AppEnv } from "../context";
import { getDb } from "../db";
import { getEnv } from "../env";
import { errorResponse } from "../http/errors";
import { parseJsonBody, pathUuid, unwrap } from "./core/http";

const TAG_COLUMNS = "id,name,color,created_at,updated_at";

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

tagsRoutes.get("/tags", requireRole("member"), async (c) => {
  const db = getDb(getEnv(c.env));
  const rows = unwrap<unknown[]>(
    await db
      .from("tags")
      .select(TAG_COLUMNS)
      .eq("company_id", c.get("companyId"))
      .order("name", { ascending: true }),
    "tags list",
  );
  return c.json({ data: rows, next_cursor: null });
});

tagsRoutes.patch("/tags/:id", requireRole("member"), async (c) => {
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

// Tag delete is owner/admin (SPEC §10 matrix); conversation_tags rows cascade.
tagsRoutes.delete("/tags/:id", requireRole("admin"), async (c) => {
  const id = pathUuid(c, "id");
  const db = getDb(getEnv(c.env));
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
