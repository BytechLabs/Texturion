/**
 * GET /v1/attachments/:id/url (SPEC §7, §6 Storage posture) — mint a
 * short-lived signed Supabase Storage URL for an MMS attachment. The
 * mms-media bucket is private with no end-user policies; this
 * membership-checked mint (companyContext middleware + the company-scoped
 * row lookup here) is the ONLY way a browser reaches media. TTL 1 hour.
 */
import { Hono } from "hono";

import { requireRole } from "../auth/company";
import type { AppEnv } from "../context";
import { getDb } from "../db";
import { getEnv } from "../env";
import { errorResponse } from "../http/errors";
import { pathUuid, unwrap } from "./core/http";

const BUCKET = "mms-media";
const TTL_SECONDS = 3600;

export const attachmentsRoutes = new Hono<AppEnv>();

attachmentsRoutes.get(
  "/attachments/:id/url",
  requireRole("member"),
  async (c) => {
    const id = pathUuid(c, "id");
    const db = getDb(getEnv(c.env));

    // company_id lives on message_attachments precisely so this check needs
    // no join: the row must belong to the caller's company.
    const rows = unwrap<{ id: string; storage_path: string }[]>(
      await db
        .from("message_attachments")
        .select("id,storage_path")
        .eq("company_id", c.get("companyId"))
        .eq("id", id)
        .limit(1),
      "attachment lookup",
    );
    const attachment = rows[0];
    if (!attachment) {
      return errorResponse(c, "not_found", "No such attachment.");
    }

    // storage_path is documented as `mms-media/{company_id}/{message_id}/{n}`
    // (SPEC §6); the Storage API wants the object key WITHOUT the bucket
    // prefix, so strip it when present.
    const objectPath = attachment.storage_path.replace(/^mms-media\//, "");
    const { data, error } = await db.storage
      .from(BUCKET)
      .createSignedUrl(objectPath, TTL_SECONDS);
    if (error || !data) {
      throw new Error(
        `signed URL mint failed: ${error?.message ?? "no data"}`,
      );
    }

    return c.json({
      url: data.signedUrl,
      expires_at: new Date(Date.now() + TTL_SECONDS * 1000).toISOString(),
    });
  },
);
