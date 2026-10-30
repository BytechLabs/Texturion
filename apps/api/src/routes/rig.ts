import { Hono } from "hono";
import { z } from "zod";

import { requireCapability } from "../auth/company";
import type { AppEnv } from "../context";
import { getDb } from "../db";
import { getEnv } from "../env";
import { errorResponse } from "../http/errors";
import { notifyIncomingCall } from "../notifications/incoming-call";
import { pushAttemptsSettled } from "../notifications/push-attempts";
import { parseOptionalJsonBody } from "./core/http";

/**
 * D142: the one route that exists only on the rig. `index.ts` never mounts it
 * on the production app; the Worker dispatches to it only when the
 * environments module says this deployment serves rig routes.
 */
export const rigRoutes = new Hono<AppEnv>();

const simulateIncomingSchema = z.strictObject({
  /** Whose devices ring. Defaults to the caller. */
  user_id: z.uuid().optional(),
  /** What the ringing screen shows as the caller. */
  caller: z.string().trim().min(1).max(32).optional(),
});

/**
 * POST /v1/rig/simulate-incoming — wake a member's devices with a real call
 * push for a call that does not exist.
 *
 * This is how the rig tests Android wake without dialling anybody. The push is
 * built and sent by the production code, so the device receives exactly what a
 * real ring sends. The session behind it is
 * synthetic: no call row and no session object is written, so when the woken
 * device asks to be rung, ring-me finds no call and answers 404 before
 * anything reaches Telnyx.
 */
rigRoutes.post(
  "/rig/simulate-incoming",
  requireCapability("conversations.send"),
  async (c) => {
    const env = getEnv(c.env);
    const db = getDb(env);
    const companyId = c.get("companyId");
    const body = await parseOptionalJsonBody(c, simulateIncomingSchema);
    const userId = body.user_id ?? c.get("userId");

    const { data, error } = await db
      .from("company_members")
      .select("user_id")
      .eq("company_id", companyId)
      .eq("user_id", userId)
      .is("deactivated_at", null)
      .limit(1);
    if (error) throw new Error(`member lookup failed: ${error.message}`);
    if ((data ?? []).length === 0) {
      return errorResponse(c, "not_found", "No such member.");
    }

    const sessionId = crypto.randomUUID();
    const report = await notifyIncomingCall(env, db, {
      companyId,
      userIds: [userId],
      caller: body.caller ?? null,
      callSessionId: sessionId,
    });
    // The ring records its evidence in the background, which a request may cut
    // off once it has answered, and that evidence is what this route is for.
    c.executionCtx.waitUntil(pushAttemptsSettled());
    return c.json(
      {
        session_id: sessionId,
        reachable: !report.unreachableUserIds.includes(userId),
      },
      201,
    );
  },
);
