/**
 * #250 — the manual escape hatch: numbers a workspace refuses outright.
 *
 * # Why this is allowed to act where the classifier is not
 *
 * The inbound classifier badges and never hides, because every genuine new
 * customer is an unknown sender and a wrong guess costs somebody a job. A
 * block is not a guess. Somebody read the thread and decided, so inbound from
 * a blocked number is marked spam and closed on arrival.
 *
 * # What it is NOT
 *
 * Not an opt-out. An opt-out is the CONTACT's decision about being texted and
 * only they can lift it (#331, D22) — it outlives the workspace and travels
 * with the person. A block is this business's decision about what reaches
 * their inbox, it says nothing about any other business, and it dies with the
 * workspace. Conflating the two would either let a business silence somebody
 * permanently, or let one workspace's annoyance follow a number everywhere.
 *
 * Nothing here stops us TEXTING a blocked number. That would be the opt-out
 * machinery, and a crew that blocked a number by mistake must still be able to
 * reach the customer they meant to keep.
 */
import { Hono } from "hono";
import { z } from "zod";

import { requireCapability } from "../auth/company";
import { recordAuditFromRequest } from "../audit/log";
import type { AppEnv } from "../context";
import { getDb } from "../db";
import { getEnv } from "../env";

import { errorResponse } from "../http/errors";
import { parseJsonBody, unwrap } from "./core/http";

export const blockedSendersRoutes = new Hono<AppEnv>();

/**
 * A guard rather than a paging limit. A workspace blocking this many numbers
 * has a problem the block list is not the answer to, and an unbounded list is
 * a slow inbound path for everybody.
 */
const MAX_BLOCKED = 500;

const blockSchema = z.object({
  phone_e164: z
    .string()
    .trim()
    .regex(/^\+[1-9]\d{7,14}$/, "phone_e164: must be an E.164 number."),
  reason: z.string().trim().max(200).optional(),
});

/** GET /v1/blocked-senders — who this workspace refuses, newest first. */
blockedSendersRoutes.get(
  "/blocked-senders",
  requireCapability("conversations.read"),
  async (c) => {
    const db = getDb(getEnv(c.env));
    const rows = unwrap<Record<string, unknown>[]>(
      await db
        .from("blocked_senders")
        .select("id,phone_e164,reason,blocked_by,created_at")
        .eq("company_id", c.get("companyId"))
        .order("created_at", { ascending: false })
        .limit(MAX_BLOCKED),
      "blocked senders",
    );
    return c.json({ data: rows });
  },
);

/**
 * POST /v1/blocked-senders — refuse a number.
 *
 * Gated on `conversations.note`, the same axis as marking a thread spam. The
 * person who can mark a robotext is the person who should be able to stop it
 * coming back, and requiring an admin would mean the tech who actually sees
 * the spam has to go and find one.
 */
blockedSendersRoutes.post(
  "/blocked-senders",
  requireCapability("conversations.note"),
  async (c) => {
    const body = await parseJsonBody(c, blockSchema);
    const companyId = c.get("companyId");
    const db = getDb(getEnv(c.env));

    const existing = unwrap<{ id: string }[]>(
      await db
        .from("blocked_senders")
        .select("id")
        .eq("company_id", companyId)
        .limit(MAX_BLOCKED + 1),
      "blocked sender count",
    );
    if (existing.length > MAX_BLOCKED) {
      return errorResponse(
        c,
        "validation_failed",
        `You can block up to ${MAX_BLOCKED} numbers. Unblock one to add another.`,
      );
    }

    // Idempotent: blocking a number twice is the same answer, and a unique
    // violation surfacing as a 500 would be a worse one.
    const rows = unwrap<Record<string, unknown>[]>(
      await db
        .from("blocked_senders")
        .upsert(
          {
            company_id: companyId,
            phone_e164: body.phone_e164,
            reason: body.reason ?? null,
            blocked_by: c.get("userId"),
          },
          { onConflict: "company_id,phone_e164" },
        )
        .select("id,phone_e164,reason,blocked_by,created_at"),
      "block sender",
    );

    await recordAuditFromRequest(db, c, {
      companyId,
      action: "spam.sender_blocked",
      targetType: "blocked_sender",
      targetId: (rows[0]?.id as string) ?? null,
      after: { phone_e164: body.phone_e164 },
    });

    return c.json(rows[0] ?? {}, 201);
  },
);

/**
 * DELETE /v1/blocked-senders/:id — let them through again.
 *
 * Does NOT reopen the threads already closed by the block. Those are the
 * crew's own inbox history, and silently resurrecting a pile of closed
 * robotexts because somebody unblocked one number would be a surprise, not a
 * fix. The next inbound arrives normally.
 */
blockedSendersRoutes.delete(
  "/blocked-senders/:id",
  requireCapability("conversations.note"),
  async (c) => {
    const companyId = c.get("companyId");
    const db = getDb(getEnv(c.env));
    const rows = unwrap<{ id: string; phone_e164: string }[]>(
      await db
        .from("blocked_senders")
        .delete()
        .eq("company_id", companyId)
        .eq("id", c.req.param("id"))
        .select("id,phone_e164"),
      "unblock sender",
    );
    if (rows.length === 0) {
      return errorResponse(c, "not_found", "No such blocked sender.");
    }

    await recordAuditFromRequest(db, c, {
      companyId,
      action: "spam.sender_unblocked",
      targetType: "blocked_sender",
      targetId: rows[0]?.id ?? null,
      before: { phone_e164: rows[0]?.phone_e164 },
    });

    return c.body(null, 204);
  },
);
