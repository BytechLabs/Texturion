/**
 * Saved-reply routes (SPEC §7, §10 matrix): templates are member-level for
 * every operation — any active member can create, edit, and delete.
 *
 *   GET    /v1/templates      M
 *   POST   /v1/templates      M   { name, body }
 *   PATCH  /v1/templates/:id  M   { name?, body? }
 *   DELETE /v1/templates/:id  M
 */
import { Hono } from "hono";
import { z } from "zod";

import { requireRole } from "../auth/company";
import type { AppEnv } from "../context";
import { getDb } from "../db";
import { getEnv } from "../env";
import { errorResponse } from "../http/errors";
import { parseJsonBody, pathUuid, unwrap } from "./core/http";

const TEMPLATE_COLUMNS = "id,name,body,created_by,created_at,updated_at";

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(2000),
});

const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    body: z.string().trim().min(1).max(2000).optional(),
  })
  .refine((value) => value.name !== undefined || value.body !== undefined, {
    message: "Provide at least one field to update.",
  });

const NAME_CONFLICT = "A saved reply with this name already exists.";

export const templatesRoutes = new Hono<AppEnv>();

templatesRoutes.get("/templates", requireRole("member"), async (c) => {
  const db = getDb(getEnv(c.env));
  const rows = unwrap<unknown[]>(
    await db
      .from("templates")
      .select(TEMPLATE_COLUMNS)
      .eq("company_id", c.get("companyId"))
      .order("name", { ascending: true }),
    "templates list",
  );
  return c.json({ data: rows, next_cursor: null });
});

templatesRoutes.post("/templates", requireRole("member"), async (c) => {
  const body = await parseJsonBody(c, createSchema);
  const db = getDb(getEnv(c.env));
  const rows = unwrap<Record<string, unknown>[]>(
    await db
      .from("templates")
      .insert({
        company_id: c.get("companyId"),
        name: body.name,
        body: body.body,
        created_by: c.get("userId"),
      })
      .select(TEMPLATE_COLUMNS),
    "template create",
    NAME_CONFLICT,
  );
  return c.json(rows[0], 201);
});

templatesRoutes.patch("/templates/:id", requireRole("member"), async (c) => {
  const id = pathUuid(c, "id");
  const body = await parseJsonBody(c, patchSchema);

  const patch: Record<string, unknown> = {};
  if (body.name !== undefined) patch.name = body.name;
  if (body.body !== undefined) patch.body = body.body;

  const db = getDb(getEnv(c.env));
  const rows = unwrap<Record<string, unknown>[]>(
    await db
      .from("templates")
      .update(patch)
      .eq("company_id", c.get("companyId"))
      .eq("id", id)
      .select(TEMPLATE_COLUMNS),
    "template update",
    NAME_CONFLICT,
  );
  if (rows.length === 0) {
    return errorResponse(c, "not_found", "No such template.");
  }
  return c.json(rows[0]);
});

templatesRoutes.delete("/templates/:id", requireRole("member"), async (c) => {
  const id = pathUuid(c, "id");
  const db = getDb(getEnv(c.env));
  const rows = unwrap<{ id: string }[]>(
    await db
      .from("templates")
      .delete()
      .eq("company_id", c.get("companyId"))
      .eq("id", id)
      .select("id"),
    "template delete",
  );
  if (rows.length === 0) {
    return errorResponse(c, "not_found", "No such template.");
  }
  return c.body(null, 204);
});
