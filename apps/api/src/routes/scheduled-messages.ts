/**
 * #233 — scheduling a text, changing your mind, and seeing what is queued.
 *
 * ---------------------------------------------------------------------------
 * QUIET HOURS ARE CHECKED AGAINST THE FIRE INSTANT, HERE
 *
 * #233 asks that scheduled sends "respect quiet hours (#225) rather than
 * bypassing them", and the interesting question is WHEN to ask. Not at fire
 * time: at 8am on Monday there is nobody to answer a confirmation prompt, and a
 * send that silently holds because of a window the sender already thought about
 * is the silent disappearance docs/DECISIONS.md rules out.
 *
 * So the gate runs at SCHEDULE time, evaluated against `send_at` rather than
 * now — `resolveDestinationClock` takes the instant for exactly this reason
 * ("callers pass the FIRE instant, never the queue one"). The person choosing
 * 11pm is warned and may confirm, which is #225 ask 2: warned, never blocked.
 * The person choosing 8am is not asked anything, because there is nothing to
 * warn about.
 *
 * That is also what makes this feature the escape hatch #233 describes rather
 * than a way around the rule. A tech blocked at 9:40pm schedules for 8am and
 * meets no gate at all, because 8am is not a quiet hour.
 *
 * ---------------------------------------------------------------------------
 * THE CLOCK IS RESOLVED ONCE, HERE, AND STORED
 *
 * The rung that answered ('contact', 'area_code' or 'company') is written onto
 * the row so the clients can say whose 8am this is. Deliberately not
 * re-resolved at fire time: a contact edited in between must not silently move
 * a send somebody already scheduled, and a UI that showed one clock at
 * scheduling and another afterwards would be lying about one of them.
 */
import {
  SCHEDULED_BODY_MAX,
  SCHEDULED_HORIZON_DAYS,
  isScheduledMessageLive,
} from "@loonext/shared";
import { Hono } from "hono";
import { z } from "zod";

import { requireCapability } from "../auth/company";
import type { AppEnv } from "../context";
import { getDb } from "../db";
import { getEnv } from "../env";
import { ApiError } from "../http/errors";
import { resolveDestinationClock } from "../messaging/destination-clock";
import { parseJsonBody, unwrap } from "./core/http";

export const scheduledMessageRoutes = new Hono<AppEnv>();

const scheduleSchema = z.object({
  conversation_id: z.string().uuid(),
  body: z.string().trim().min(1).max(SCHEDULED_BODY_MAX),
  send_at: z.string().datetime(),
  /**
   * Mirrors compose's flag. A caller that has shown the person the quiet-hours
   * warning sends this back; one that has not gets the 409.
   */
  quiet_hours_confirmed: z.boolean().optional(),
});

/**
 * How long after `send_at` a message stays worth sending.
 *
 * Rule 3 (docs/DECISIONS.md) says time-sensitive work expires rather than
 * arriving late, and this is where "late" gets a number. A day: a follow-up
 * that goes out the morning after it was meant to is still recognisably the
 * message somebody wrote, and one that goes out three days later is a business
 * that looks like it forgot. Long enough to ride out an outage, short enough
 * that it cannot arrive in a different week.
 */
const HOLD_HORIZON_HOURS = 24;

interface ScheduleOutcome {
  outcome: string;
  scheduled_message?: Record<string, unknown>;
  limit?: number;
  limit_days?: number;
}

scheduledMessageRoutes.post(
  "/scheduled-messages",
  requireCapability("conversations.send"),
  async (c) => {
    const companyId = c.get("companyId");
    const userId = c.get("userId");
    const db = getDb(getEnv(c.env));

    // The shared parser, so a malformed body fails with the same envelope and
    // the same field-level summary as every other route rather than a sentence
    // written here.
    const { conversation_id, body, send_at, quiet_hours_confirmed } =
      await parseJsonBody(c, scheduleSchema);
    const sendAt = new Date(send_at);

    if (Number.isNaN(sendAt.getTime())) {
      throw new ApiError("validation_failed", "That is not a time we understand.");
    }

    // The destination, and the conversation's own scope. Read before anything
    // else so a thread in another workspace is a 404 rather than a validation
    // message that confirms it exists.
    const conversation = unwrap<{
      // #291: the number this THREAD is with — where the text will actually
      // go when it fires. The contact's timezone still comes from the contact:
      // a second number does not put somebody in a second country.
      contact_phone_e164: string | null;
      contacts: { timezone: string | null } | null;
    } | null>(
      await db
        .from("conversations")
        .select("contact_phone_e164,contacts(timezone)")
        .eq("id", conversation_id)
        .eq("company_id", companyId)
        .maybeSingle(),
      "conversation lookup",
    );
    const destination = conversation?.contact_phone_e164;
    if (!destination) {
      throw new ApiError("not_found", "That conversation is not here.");
    }

    // Asked about the FIRE instant, not now. See the header.
    const clock = await resolveDestinationClock(db, {
      companyId,
      phoneE164: destination,
      atUtc: sendAt,
      contactTimezone: conversation?.contacts?.timezone ?? null,
    });

    if (clock.quiet && !quiet_hours_confirmed) {
      // Same code and envelope as compose, so a client shows the quiet-hours
      // dialog by CODE rather than by reading the sentence.
      throw new ApiError(
        "quiet_hours_confirmation_required",
        `That lands at ${String(clock.localHour).padStart(2, "0")}:00 where this customer is. Confirm with quiet_hours_confirmed to schedule it anyway.`,
      );
    }

    const result = unwrap<ScheduleOutcome>(
      await db.rpc("api_schedule_message", {
        p_company_id: companyId,
        p_conversation_id: conversation_id,
        p_user_id: userId,
        p_body: body,
        p_send_at: sendAt.toISOString(),
        p_clock_timezone: clock.timezone,
        p_clock_source: clock.source,
        p_expires_at: new Date(
          sendAt.getTime() + HOLD_HORIZON_HOURS * 3_600_000,
        ).toISOString(),
      }),
      "schedule message",
    );

    switch (result.outcome) {
      case "scheduled":
        return c.json({ scheduled_message: result.scheduled_message }, 201);
      case "not_found":
        throw new ApiError("not_found", "That conversation is not here.");
      case "in_the_past":
        throw new ApiError(
          "validation_failed",
          "That time has already passed. Pick one in the future.",
        );
      case "too_far_out":
        throw new ApiError(
          "validation_failed",
          `We can hold a message for up to ${result.limit_days ?? SCHEDULED_HORIZON_DAYS} days.`,
        );
      case "thread_cap":
        throw new ApiError(
          "validation_failed",
          `This conversation already has ${result.limit} messages waiting to send.`,
        );
      case "company_cap":
        throw new ApiError(
          "validation_failed",
          `Your workspace already has ${result.limit} messages waiting to send.`,
        );
      default:
        // A sentinel this route has not been taught about. A plain throw, so
        // it surfaces as a 500 in Sentry rather than being dressed up as a
        // validation message the person could act on.
        throw new Error(`unexpected schedule outcome: ${result.outcome}`);
    }
  },
);

/**
 * What is queued.
 *
 * Two reads in one route: a thread's, and the whole workspace's. #233 asks for
 * "a workspace-level view of everything scheduled, so nobody is surprised",
 * and the same shape answers the thread bubble.
 *
 * Live rows by default. The finished ones are history and a list that grows
 * forever is a list nobody opens — but `?status=all` is there, because
 * "why did that never send" is a question somebody will have.
 */
const listSchema = z.object({
  conversation_id: z.string().uuid().optional(),
  status: z.enum(["live", "all"]).optional(),
});

scheduledMessageRoutes.get(
  "/scheduled-messages",
  requireCapability("conversations.read"),
  async (c) => {
    const companyId = c.get("companyId");
    const db = getDb(getEnv(c.env));

    const parsed = listSchema.safeParse(c.req.query());
    if (!parsed.success) {
      throw new ApiError("validation_failed", "Check the filters.");
    }

    let query = db
      .from("scheduled_messages")
      .select(
        "id,conversation_id,body,send_at,clock_timezone,clock_source,status," +
          "held_reason,held_at,expires_at,sent_message_id,created_by,created_at," +
          // WHO this is going to. The thread strip does not need it — the
          // customer's name is already in the header above it — but the
          // workspace view is a list of texts to DIFFERENT people, and a list
          // of bodies with no names is the surprise #233 asks us to prevent
          // rather than the answer to it. Embedded rather than fetched per row
          // by each client: three clients each doing an N+1 over conversations
          // is the same query written three times, badly.
          "conversations(contacts(name,phone_e164))",
      )
      .eq("company_id", companyId)
      .order("send_at", { ascending: true })
      .limit(200);

    if (parsed.data.conversation_id) {
      query = query.eq("conversation_id", parsed.data.conversation_id);
    }
    if (parsed.data.status !== "all") {
      query = query.in("status", ["pending", "held"]);
    }

    const rows = unwrap<Record<string, unknown>[]>(
      await query,
      "scheduled message list",
    );
    return c.json({ scheduled_messages: rows });
  },
);

/**
 * Change your mind about the time or the words.
 *
 * Only while it is still live — editing a sent message is not an edit, it is a
 * second message, and letting the call succeed would tell somebody they had
 * changed something they had not.
 */
const updateSchema = z.object({
  body: z.string().trim().min(1).max(SCHEDULED_BODY_MAX).optional(),
  send_at: z.string().datetime().optional(),
  quiet_hours_confirmed: z.boolean().optional(),
});

scheduledMessageRoutes.patch(
  "/scheduled-messages/:id",
  requireCapability("conversations.send"),
  async (c) => {
    const companyId = c.get("companyId");
    const db = getDb(getEnv(c.env));
    const id = c.req.param("id");

    const patchBody = await parseJsonBody(c, updateSchema);

    const existing = unwrap<{
      status: string;
      conversation_id: string;
      conversations: { contacts: { phone_e164: string; timezone: string | null } | null } | null;
    } | null>(
      await db
        .from("scheduled_messages")
        .select("status,conversation_id,conversations(contacts(phone_e164,timezone))")
        .eq("id", id)
        .eq("company_id", companyId)
        .maybeSingle(),
      "scheduled message lookup",
    );
    if (!existing) throw new ApiError("not_found", "That message is not here.");
    if (!isScheduledMessageLive(existing.status as never)) {
      throw new ApiError(
        "validation_failed",
        "That message is no longer waiting to send.",
      );
    }

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (patchBody.body !== undefined) patch.body = patchBody.body;

    if (patchBody.send_at !== undefined) {
      const sendAt = new Date(patchBody.send_at);
      if (Number.isNaN(sendAt.getTime()) || sendAt <= new Date()) {
        throw new ApiError(
          "validation_failed",
          "That time has already passed. Pick one in the future.",
        );
      }
      const destination = existing.conversations?.contacts?.phone_e164;
      if (destination) {
        // Re-asked against the NEW instant: moving a send from 8am to 11pm has
        // to meet the same gate the original choice did, or the edit is the
        // way around it.
        const clock = await resolveDestinationClock(db, {
          companyId,
          phoneE164: destination,
          atUtc: sendAt,
          contactTimezone: existing.conversations?.contacts?.timezone ?? null,
        });
        if (clock.quiet && !patchBody.quiet_hours_confirmed) {
          throw new ApiError(
            "quiet_hours_confirmation_required",
            `That lands at ${String(clock.localHour).padStart(2, "0")}:00 where this customer is. Confirm with quiet_hours_confirmed to schedule it anyway.`,
          );
        }
        patch.clock_timezone = clock.timezone;
        patch.clock_source = clock.source;
      }
      patch.send_at = sendAt.toISOString();
      patch.expires_at = new Date(
        sendAt.getTime() + HOLD_HORIZON_HOURS * 3_600_000,
      ).toISOString();
      // Rescheduling a held message puts it back in the queue: the person has
      // looked at it and decided it should still go.
      patch.status = "pending";
      patch.held_reason = null;
      patch.held_at = null;
    }

    const updated = unwrap<Record<string, unknown>[]>(
      await db
        .from("scheduled_messages")
        .update(patch)
        .eq("id", id)
        .eq("company_id", companyId)
        .in("status", ["pending", "held"])
        .select(),
      "scheduled message update",
    );
    if (updated.length === 0) {
      // It fired or was cancelled between the read and the write.
      throw new ApiError(
        "validation_failed",
        "That message is no longer waiting to send.",
      );
    }
    return c.json({ scheduled_message: updated[0] });
  },
);

/** Cancel it. Idempotent-ish: cancelling something already gone is a 404. */
scheduledMessageRoutes.delete(
  "/scheduled-messages/:id",
  requireCapability("conversations.send"),
  async (c) => {
    const companyId = c.get("companyId");
    const userId = c.get("userId");
    const db = getDb(getEnv(c.env));

    const result = unwrap<{ outcome: string }>(
      await db.rpc("api_cancel_scheduled_message", {
        p_id: c.req.param("id"),
        p_company_id: companyId,
        p_user_id: userId,
      }),
      "cancel scheduled message",
    );
    if (result.outcome !== "canceled") {
      throw new ApiError("not_found", "That message is not waiting to send.");
    }
    return c.body(null, 204);
  },
);
