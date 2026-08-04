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

import { recordAudit, recordAuditFromRequest } from "../audit/log";
import { requireCapability } from "../auth/company";
import {
  buildGreetingCaptureState,
  GREETING_CAPTURE_AUDIT_ACTION,
  GREETING_CAPTURE_DAILY_CAP,
  GREETING_CAPTURE_RING_SECS,
  GREETING_CAPTURE_TIME_LIMIT_SECS,
} from "../calls/greeting-capture";
import type { AppEnv } from "../context";
import { getDb } from "../db";
import { getEnv } from "../env";
import { isKilled } from "../flags/evaluate";
import { ApiError, errorResponse } from "../http/errors";
import { TelnyxApiError, telnyxRequest } from "../telnyx/client";
import { assertBodyWithinLimit, parseJsonBody, pathUuid } from "./core/http";
import { normalizeNanpPhone } from "./core/phone";

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

const captureBodySchema = z.object({
  name: nameSchema,
  /** The phone to ring. Typed by the owner — we store nobody's mobile. */
  to: z.string().trim().min(1).max(32),
});

/**
 * POST /v1/voicemail-greetings/capture-call — record a greeting BY PHONE (O/A).
 *
 * #309's last Scope item, inverted: we ring the owner rather than publishing a
 * number for them to ring. The reasoning is in calls/greeting-capture.ts, and
 * the short version is that an inbound record-this line is a number anyone can
 * call, and identifying the workspace by caller ID means a spoofed caller ID
 * rewrites a business's greeting.
 *
 * Everything this route does before dialing is a gate, and the ORDER is the
 * cost posture: the free checks first, the audit row (which is also the daily
 * ceiling) next, and the dial — the only thing that spends money — last.
 */
voicemailGreetingsRoutes.post(
  "/voicemail-greetings/capture-call",
  requireCapability("numbers.manage"),
  async (c) => {
    const env = getEnv(c.env);
    const db = getDb(env);
    const companyId = c.get("companyId");
    const body = await parseJsonBody(c, captureBodySchema);

    // The same switch that stops calls being placed or accepted. A capture call
    // is a call we place, so an owner who hit the switch during an incident
    // gets the containment they asked for.
    if (await isKilled(env, "kill:calls", companyId, db)) {
      return errorResponse(
        c,
        "service_unavailable",
        "Calling is paused while we deal with an issue. You can still record a greeting in the app.",
      );
    }

    // US/CA only, the same table every other dial target goes through — it
    // excludes the Caribbean +1 codes a bare `+1[2-9]` regex would admit.
    const to = normalizeNanpPhone(body.to);
    if (!to) {
      return errorResponse(
        c,
        "validation_failed",
        "Enter a valid US or Canada number for us to call.",
      );
    }

    const { data: companyRows, error: companyError } = await db
      .from("companies")
      .select("subscription_status")
      .eq("id", companyId)
      .limit(1);
    if (companyError) {
      throw new Error(`company lookup failed: ${companyError.message}`);
    }
    const company = companyRows?.[0] as
      | { subscription_status: string }
      | undefined;
    if (!company || company.subscription_status !== "active") {
      return errorResponse(
        c,
        "subscription_inactive",
        "Your subscription isn't active.",
      );
    }

    // Refused HERE rather than after the call, where the owner has already
    // spoken and there is nobody left on the line to tell. The insert is still
    // the authority — two capture calls racing on the same name is a real
    // sequence, and the one that loses is discarded rather than overwriting.
    const { data: clash, error: clashError } = await db
      .from("voicemail_greetings")
      .select("id")
      .eq("company_id", companyId)
      .eq("name", body.name)
      .limit(1);
    if (clashError) {
      throw new Error(`voicemail_greetings lookup failed: ${clashError.message}`);
    }
    if (clash && clash.length > 0) {
      throw new ApiError(
        "validation_failed",
        `You already have a greeting called "${body.name}".`,
      );
    }

    // The daily ceiling. A capture leg writes no `calls` row, so the voice
    // spending cap — which counts seconds off that table — structurally cannot
    // see it; these audit rows are the only count there is.
    const since = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
    const { count, error: countError } = await db
      .from("audit_log")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("action", GREETING_CAPTURE_AUDIT_ACTION)
      .gte("occurred_at", since);
    if (countError) {
      throw new Error(`capture-call count failed: ${countError.message}`);
    }
    if ((count ?? 0) >= GREETING_CAPTURE_DAILY_CAP) {
      return errorResponse(
        c,
        "usage_cap_reached",
        "That's a lot of recording calls for one day. Record in the app, or try again tomorrow.",
      );
    }

    // Any active number of the workspace's own: this call presents the business
    // to its own owner, so which line it comes from carries no meaning — but it
    // must be a number we hold, because Telnyx will not originate from one we
    // do not.
    const { data: numbers, error: numbersError } = await db
      .from("phone_numbers")
      .select("id,number_e164")
      .eq("company_id", companyId)
      .eq("status", "active")
      .order("created_at", { ascending: true })
      .limit(1);
    if (numbersError) {
      throw new Error(`active number lookup failed: ${numbersError.message}`);
    }
    const from = (numbers?.[0] as { number_e164: string } | undefined)
      ?.number_e164;
    if (!from) {
      return errorResponse(
        c,
        "conflict",
        "You have no active number to call from yet.",
      );
    }

    // BEFORE the dial, and a failure here refuses the call.
    //
    // Everywhere else in this codebase the audit write is best-effort, because
    // refusing an action over a log write is the worse failure. Here the row IS
    // the ceiling: a write that silently failed would make the cap under-count,
    // which is a cost control that fails open. So this one is fail-closed, and
    // the cost of that is a capture call refused during a database blip.
    const nowMs = Date.now();
    const logged = await recordAudit(db, {
      companyId,
      actorUserId: c.get("userId"),
      action: GREETING_CAPTURE_AUDIT_ACTION,
      targetType: "voicemail_greeting",
      targetId: null,
      actorIp:
        c.req.header("CF-Connecting-IP") ??
        c.req.header("X-Forwarded-For")?.split(",")[0]?.trim() ??
        null,
      actorAgent: c.req.header("User-Agent") ?? null,
      // The greeting's name and the line it rang. Never the recording.
      after: { name: body.name, to },
    });
    if (!logged) {
      return errorResponse(
        c,
        "service_unavailable",
        "We couldn't start the call just now. Try again in a moment.",
      );
    }

    const clientState = await buildGreetingCaptureState(
      env,
      companyId,
      body.name,
      nowMs,
    );

    try {
      await telnyxRequest(env, {
        method: "POST",
        path: "/v2/calls",
        body: {
          connection_id: env.TELNYX_VOICE_CONNECTION_ID,
          to,
          from,
          timeout_secs: GREETING_CAPTURE_RING_SECS,
          // The ceiling the recording cap cannot enforce: a leg that answers
          // and then does nothing at all.
          time_limit_secs: GREETING_CAPTURE_TIME_LIMIT_SECS,
          client_state: clientState,
        },
      });
    } catch (cause) {
      if (cause instanceof TelnyxApiError && cause.status < 500) {
        // A definite carrier refusal — an unreachable number, a blocked
        // destination. Say so plainly instead of a 500: the owner mistyped, and
        // the fix is theirs.
        return errorResponse(
          c,
          "conflict",
          "We couldn't ring that number. Check it and try again.",
        );
      }
      throw cause instanceof Error
        ? cause
        : new Error("greeting capture dial failed");
    }

    return c.json({ to, from, name: body.name }, 202);
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

