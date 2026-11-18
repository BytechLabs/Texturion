import type { Context } from "hono";
import { z } from "zod";

import {
  assertEgressWithinAllowance,
  assertMintRateWithinLimit,
} from "../attachments/egress";
import { resolveNumberAccess } from "../auth/number-access";
import type { AppEnv } from "../context";
import { getDb } from "../db";
import { getEnv } from "../env";
import { ApiError } from "../http/errors";
import { MMS_BUCKET } from "../messaging/media";
import { VOICEMAILS_BUCKET } from "../messaging/inbound-ring";
import { ATTACHMENTS_BUCKET } from "../routes/core/attachments";
import { parseWith, unwrap } from "../routes/core/http";
import { dispositionOptions } from "../storage/disposition";

const kindSchema = z.enum(["attachment", "mms", "voicemail"]);
const listSchema = z.object({
  kind: kindSchema.default("attachment"),
  after: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
const bucketByKind = {
  attachment: ATTACHMENTS_BUCKET,
  mms: MMS_BUCKET,
  voicemail: VOICEMAILS_BUCKET,
};
const mediaTtl = 300;

interface MediaRow {
  id: string;
  file_name: string | null;
  content_type: string | null;
  size_bytes: number | null;
  storage_path: string;
}

async function readMedia(
  c: Context<AppEnv>,
  cutoff: string,
  kind: z.infer<typeof kindSchema>,
  query: { after?: string; limit: number; item?: string },
) {
  const db = getDb(getEnv(c.env));
  const companyId = c.get("companyId");
  const access = await resolveNumberAccess(db, {
    companyId,
    userId: c.get("userId"),
    role: c.get("role"),
  });
  return unwrap<MediaRow[]>(
    await db.rpc("api_workspace_export_media", {
      p_company: companyId,
      p_before: cutoff,
      p_kind: kind,
      p_after: query.after ?? null,
      p_item: query.item ?? null,
      p_limit: query.limit,
      p_hidden: access.hiddenNumberIds,
    }),
    "workspace export files",
  );
}

export async function listWorkspaceMedia(c: Context<AppEnv>, cutoff: string) {
  const { kind, after, limit } = parseWith(listSchema, c.req.query());
  const rows = await readMedia(c, cutoff, kind, { after, limit: limit + 1 });
  const data = rows.slice(0, limit).map(({ id, file_name, content_type, size_bytes }) =>
    ({ id, file_name, content_type, size_bytes }),
  );
  return c.json({
    data,
    next_cursor: rows.length > limit ? data.at(-1)?.id ?? null : null,
  });
}

export async function signWorkspaceMedia(c: Context<AppEnv>, cutoff: string) {
  const { kind, mediaId } = parseWith(
    z.object({ kind: kindSchema, mediaId: z.uuid() }),
    c.req.param(),
  );
  const companyId = c.get("companyId");
  const env = getEnv(c.env);
  const db = getDb(env);
  await assertMintRateWithinLimit(env, companyId, c.get("userId"));
  const [file] = await readMedia(c, cutoff, kind, { item: mediaId, limit: 1 });
  if (!file) throw new ApiError("not_found", "No such export file.");

  const bucket = bucketByKind[kind];
  const path = kind === "mms" ? file.storage_path.replace(/^mms-media\//, "") : file.storage_path;
  const storage = db.storage.from(bucket);
  let size = file.size_bytes;
  if (size === null) {
    const { data, error } = await storage.info(path);
    if (error || typeof data?.size !== "number") {
      throw new ApiError("conflict", "This file's size could not be read. Try again later.");
    }
    size = data.size;
  }
  await assertEgressWithinAllowance(db, companyId, [{ bucket, path, sizeBytes: size }], mediaTtl);
  const download = dispositionOptions("application/octet-stream");
  const { data, error } = await storage.createSignedUrl(path, mediaTtl, {
    download: file.file_name || download.download,
  });
  if (error || !data?.signedUrl) throw new Error("Export file signing failed");
  return c.json({ url: data.signedUrl });
}
