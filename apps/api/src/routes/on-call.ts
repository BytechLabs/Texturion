/**
 * #244 — who is holding the phone, and claiming an alert so the others' stop.
 *
 * ACKNOWLEDGING IS THE WHOLE POINT OF THIS ROUTE. "When everyone is notified,
 * no one is accountable. An emergency call at midnight gets seen by four people
 * who each assume another is handling it." One tap puts a name on it, and the
 * second person to tap learns whose — being told "acknowledged" as well would
 * leave two people each believing they own it, which is the original failure
 * with extra steps.
 *
 * The shift list is readable by anybody who can read conversations, because
 * "any member can see who is on call right now" is one of the issue's own
 * acceptance criteria. Knowing who is holding the phone is not privileged
 * information inside a crew — it is the thing that stops two people driving to
 * the same job.
 */
import { Hono } from "hono";
import { z } from "zod";

import { requireCapability } from "../auth/company";
import type { AppEnv } from "../context";
import { getDb } from "../db";
import { getEnv } from "../env";
import { ApiError } from "../http/errors";
import { parseJsonBody, unwrap } from "./core/http";

export const onCallRoutes = new Hono<AppEnv>();

/** A shift longer than this is somebody who forgot to set an end. */
const MAX_SHIFT_DAYS = 31;

const shiftSchema = z
  .object({
    user_id: z.string().uuid(),
    phone_number_id: z.string().uuid().nullable().optional(),
    starts_at: z.string().datetime(),
    ends_at: z.string().datetime(),
  })
  .refine((value) => new Date(value.ends_at) > new Date(value.starts_at), {
    message: "A shift has to end after it starts",
  })
  .refine(
    (value) =>
      new Date(value.ends_at).getTime() - new Date(value.starts_at).getTime() <=
      MAX_SHIFT_DAYS * 24 * 60 * 60 * 1000,
    {
      // Not arbitrary. The failure this feature exists to prevent is one person
      // silently holding the phone forever, and a shift with no practical end
      // is that state wearing an interval's clothes.
      message: `A shift cannot run longer than ${MAX_SHIFT_DAYS} days`,
    },
  );

/**
 * GET /v1/on-call — the rota the whole crew can see.
 *
 * Live and upcoming only. A finished shift is history, and a list that grows
 * forever answers "who is on call" less clearly every week.
 */
onCallRoutes.get("/on-call", requireCapability("conversations.read"), async (c) => {
  const db = getDb(getEnv(c.env));
  const companyId = c.get("companyId");

  const shifts = unwrap<Record<string, unknown>[]>(
    await db
      .from("on_call_shifts")
      .select("id,user_id,phone_number_id,starts_at,ends_at,created_by")
      .eq("company_id", companyId)
      .gt("ends_at", new Date().toISOString())
      .order("starts_at", { ascending: true })
      .limit(100),
    "on-call shifts",
  );

  return c.json({ data: shifts });
});

/**
 * POST /v1/on-call — put somebody on call.
 *
 * Owner/admin only: deciding who gets woken at 2am is a scheduling decision
 * about somebody else's night, and a member quietly assigning it to a colleague
 * is the kind of thing that has to be visible and attributable.
 */
onCallRoutes.post("/on-call", requireCapability("team.manage"), async (c) => {
  const db = getDb(getEnv(c.env));
  const companyId = c.get("companyId");
  const body = await parseJsonBody(c, shiftSchema);

  // The member has to exist HERE. A user id from another workspace would be
  // refused by the foreign key eventually, but as a 500 rather than as an
  // answer, and this is a form somebody is filling in.
  const members = unwrap<{ user_id: string }[]>(
    await db
      .from("company_members")
      .select("user_id")
      .eq("company_id", companyId)
      .eq("user_id", body.user_id)
      .limit(1),
    "on-call member check",
  );
  if (members.length === 0) {
    throw new ApiError(
      "validation_failed",
      "That person is not in this crew",
    );
  }

  const inserted = unwrap<Record<string, unknown>[]>(
    await db
      .from("on_call_shifts")
      .insert({
        company_id: companyId,
        user_id: body.user_id,
        phone_number_id: body.phone_number_id ?? null,
        starts_at: body.starts_at,
        ends_at: body.ends_at,
        created_by: c.get("userId"),
      })
      .select("id,user_id,phone_number_id,starts_at,ends_at,created_by"),
    "create on-call shift",
  );

  return c.json({ data: inserted[0] }, 201);
});

/** DELETE /v1/on-call/:id — take somebody off call. */
onCallRoutes.delete("/on-call/:id", requireCapability("team.manage"), async (c) => {
  const db = getDb(getEnv(c.env));

  const deleted = unwrap<{ id: string }[]>(
    await db
      .from("on_call_shifts")
      .delete()
      .eq("id", c.req.param("id"))
      .eq("company_id", c.get("companyId"))
      .select("id"),
    "delete on-call shift",
  );
  if (deleted.length === 0) {
    throw new ApiError("not_found", "That shift is already gone");
  }

  return c.body(null, 204);
});

/**
 * POST /v1/on-call/alerts/:id/acknowledge — "I have this one."
 *
 * Any member who can read the thread, NOT just the person it was sent to.
 * Whoever is actually awake and reaching for their boots is the right person to
 * claim it, and refusing them because the rota named somebody else would leave
 * the alert widening while a human is already handling it.
 */
onCallRoutes.post(
  "/on-call/alerts/:id/acknowledge",
  // `send`, not `read`. Claiming an alert means "I will call this customer
  // back", and a read-only member (the bookkeeper preset, #315) cannot reply
  // to the thread at all — letting them take responsibility for a callback
  // they are not able to make is the diffusion problem with a name attached.
  // Within the set of people who CAN act, anybody may claim it, which is the
  // part that matters at 2am.
  requireCapability("conversations.send"),
  async (c) => {
    const db = getDb(getEnv(c.env));

    const result = unwrap<{
      outcome: string;
      conversation_id?: string;
      kind?: string;
      acknowledged_by?: string;
      acknowledged_at?: string;
    }>(
      await db.rpc("api_acknowledge_alert", {
        p_company_id: c.get("companyId"),
        p_alert_id: c.req.param("id"),
        p_user_id: c.get("userId"),
      }),
      "acknowledge alert",
    );

    if (result.outcome === "not_found") {
      throw new ApiError("not_found", "That alert is no longer open");
    }

    // 200 either way, with the outcome named. `already_acknowledged` is not an
    // error — the caller did nothing wrong, and what they need is the NAME on
    // it so the app can say "Sam has this" rather than "conflict".
    return c.json(result);
  },
);
