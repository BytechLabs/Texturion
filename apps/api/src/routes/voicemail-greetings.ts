/**
 * #309 — recorded voicemail greetings, in the business's own voice.
 *
 * The greeting has always been a text string spoken by TTS. For most software
 * that is a detail; here it works against the product's own pitch, because our
 * customers' whole advantage is being a real, local, reachable person and a
 * synthetic voice is what a robocall sounds like.
 *
 * These routes are the RECORDING half. Selection happens where the identity
 * already lives — `PATCH /v1/numbers/:id/identity` for one line, the company
 * route for the workspace — so there is one place that answers "what does this
 * line do", not two.
 *
 * TTS is untouched. A workspace that never records anything behaves exactly as
 * it did, and a recording that turns out to be unplayable falls back to the
 * words at call time (see `greetingAudioUrl` in calls/runtime.ts).
 */
import { Hono } from "hono";
import { z } from "zod";

import { recordAuditFromRequest } from "../audit/log";
import { requireCapability } from "../auth/company";
import type { AppEnv } from "../context";
import { getDb } from "../db";
import { getEnv } from "../env";
import { ApiError, errorResponse } from "../http/errors";
import { assertBodyWithinLimit, pathUuid } from "./core/http";

export const voicemailGreetingsRoutes = new Hono<AppEnv>();

/** The bucket from 20260804360000. Private, company-scoped, audio only. */
const GREETING_BUCKET = "voicemail-greetings";

/**
 * Two minutes, matching the column's own ceiling.
 *
 * Duplicated here on purpose rather than read from the database: this is the
 * message a person sees when they record something too long, and "value too
 * long for constraint voicemail_greetings_duration_ms_check" is not that
 * message. The column stays as the backstop for the phone-recording path,
 * which does not come through here at all.
 */
const MAX_DURATION_MS = 120_000;

/** 2 MB, matching the bucket. Comfortably covers two minutes of speech. */
const MAX_GREETING_BYTES = 2 * 1024 * 1024;

/**
 * What the three clients actually produce when asked to record: Safari and iOS
 * give mp4/aac, Chrome and Android give webm/opus, and a phone recording
 * arrives from Telnyx as mp3 or wav.
 */
const ALLOWED_TYPES = new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/mp4",
  "audio/aac",
  "audio/x-m4a",
  "audio/webm",
  "audio/ogg",
  "audio/wav",
  "audio/x-wav",
]);

const EXTENSION: Record<string, string> = {
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/x-m4a": "m4a",
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
};

interface GreetingRow {
  id: string;
  name: string;
  duration_ms: number;
  mime_type: string;
  byte_size: number;
  created_at: string;
}

/** GET /v1/voicemail-greetings — what this workspace has recorded (O/A). */
voicemailGreetingsRoutes.get(
  "/voicemail-greetings",
  requireCapability("numbers.manage"),
  async (c) => {
    const db = getDb(getEnv(c.env));
    const { data, error } = await db
      .from("voicemail_greetings")
      .select("id,name,duration_ms,mime_type,byte_size,created_at")
      .eq("company_id", c.get("companyId"))
      .order("created_at", { ascending: false });
    if (error) {
      throw new Error(`voicemail_greetings lookup failed: ${error.message}`);
    }
    return c.json({ data: (data ?? []) as GreetingRow[] });
  },
);

const nameSchema = z.string().trim().min(1).max(60);

/** POST /v1/voicemail-greetings — record one (O/A). multipart: name + file. */
voicemailGreetingsRoutes.post(
  "/voicemail-greetings",
  requireCapability("numbers.manage"),
  async (c) => {
    const db = getDb(getEnv(c.env));
    const companyId = c.get("companyId");
    const userId = c.get("userId");

    // Before formData() buffers the whole body, not after.
    assertBodyWithinLimit(c, MAX_GREETING_BYTES + 64 * 1024);

    let form: FormData;
    try {
      form = await c.req.raw.formData();
    } catch {
      throw new ApiError(
        "validation_failed",
        "Request must be multipart/form-data with name, duration_ms and file.",
      );
    }

    const parsedName = nameSchema.safeParse(form.get("name"));
    if (!parsedName.success) {
      throw new ApiError(
        "validation_failed",
        "name: give this greeting a name you will recognise in a list, up to 60 characters.",
      );
    }
    const name = parsedName.data;

    const durationRaw = Number(form.get("duration_ms"));
    if (!Number.isFinite(durationRaw) || durationRaw <= 0) {
      throw new ApiError("validation_failed", "duration_ms: must be a positive number.");
    }
    const durationMs = Math.round(durationRaw);
    if (durationMs > MAX_DURATION_MS) {
      throw new ApiError(
        "validation_failed",
        "That greeting is longer than two minutes. A caller waiting to leave a message will hang up first.",
      );
    }

    const filePart = form.get("file");
    if (filePart === null || typeof filePart === "string") {
      throw new ApiError("validation_failed", "file: is required.");
    }
    const blob = filePart as File;
    const declaredType = (blob.type || "").split(";")[0]!.trim().toLowerCase();
    if (!ALLOWED_TYPES.has(declaredType)) {
      throw new ApiError(
        "validation_failed",
        "file: must be an audio recording your phone or browser produced.",
      );
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (bytes.byteLength === 0) {
      throw new ApiError("validation_failed", "file: is empty.");
    }
    if (bytes.byteLength > MAX_GREETING_BYTES) {
      throw new ApiError("validation_failed", "file: is larger than 2 MB.");
    }

    const objectPath = `${companyId}/${crypto.randomUUID()}.${EXTENSION[declaredType]}`;

    // The OBJECT first, then the row.
    //
    // This order is chosen for what each failure leaves behind. An orphaned
    // object costs a few kilobytes and is swept; a row pointing at bytes that
    // never landed is a line whose greeting cannot be played. That falls back
    // to TTS rather than silence — #309's rule holds either way — but an owner
    // would see a greeting listed, hear the robot, and have nothing to fix.
    const upload = await db.storage
      .from(GREETING_BUCKET)
      .upload(objectPath, bytes.slice().buffer, {
        contentType: declaredType,
        upsert: false, // fresh uuid per upload — never overwrite
      });
    if (upload.error) {
      throw new Error(`greeting upload failed (${objectPath}): ${upload.error.message}`);
    }

    const { data, error } = await db
      .from("voicemail_greetings")
      .insert({
        company_id: companyId,
        name,
        storage_path: `${GREETING_BUCKET}/${objectPath}`,
        duration_ms: durationMs,
        mime_type: declaredType,
        byte_size: bytes.byteLength,
        created_by: userId,
      })
      .select("id,name,duration_ms,mime_type,byte_size,created_at")
      .limit(1);

    if (error) {
      // Take the bytes back out. Best-effort: the insert error is what the
      // caller needs to see either way, and a stranded object is swept.
      const removal = await db.storage.from(GREETING_BUCKET).remove([objectPath]);
      if (removal.error) {
        console.error(
          `greeting object orphaned (${objectPath}): ${removal.error.message}`,
        );
      }
      // A duplicate name is the owner's mistake, not ours — say which.
      if (error.code === "23505") {
        throw new ApiError(
          "validation_failed",
          `You already have a greeting called "${name}".`,
        );
      }
      throw new Error(`voicemail_greetings insert failed: ${error.message}`);
    }

    await recordAuditFromRequest(db, c, {
      companyId,
      action: "voicemail_greeting.recorded",
      targetType: "voicemail_greeting",
      targetId: ((data ?? [])[0] as GreetingRow | undefined)?.id ?? null,
      after: { name, duration_ms: durationMs },
    });

    return c.json((data ?? [])[0] as GreetingRow, 201);
  },
);

/** DELETE /v1/voicemail-greetings/:id — and any line using it goes back to TTS (O/A). */
voicemailGreetingsRoutes.delete(
  "/voicemail-greetings/:id",
  requireCapability("numbers.manage"),
  async (c) => {
    const db = getDb(getEnv(c.env));
    const companyId = c.get("companyId");
    const id = pathUuid(c, "id");

    const { data, error } = await db
      .from("voicemail_greetings")
      .delete()
      .eq("company_id", companyId)
      .eq("id", id)
      .select("id,name,storage_path");
    if (error) {
      throw new Error(`voicemail_greetings delete failed: ${error.message}`);
    }
    const row = (data ?? [])[0] as
      | { id: string; name: string; storage_path: string }
      | undefined;
    if (!row) return errorResponse(c, "not_found", "No such greeting.");

    // The row is gone, so every company and number that pointed at it is back
    // on TTS already — that is the FK's `on delete set null`, asserted by VG-2.
    // The bytes go after, best-effort: an object nobody references is waste,
    // but failing the request over it would tell an owner the delete did not
    // happen when it did.
    const removal = await db.storage
      .from(GREETING_BUCKET)
      .remove([row.storage_path.replace(`${GREETING_BUCKET}/`, "")]);
    if (removal.error) {
      console.error(
        `greeting object orphaned on delete (${row.storage_path}): ${removal.error.message}`,
      );
    }

    await recordAuditFromRequest(db, c, {
      companyId,
      action: "voicemail_greeting.deleted",
      targetType: "voicemail_greeting",
      targetId: row.id,
      before: { name: row.name },
    });

    return c.body(null, 204);
  },
);

