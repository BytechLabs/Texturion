/**
 * #237 — the workspace's reminder rules: how long before a job a text goes,
 * and what it says.
 *
 * NO ROWS MEANS NO REMINDERS, AND THAT IS THE DEFAULT FOR EVERY EXISTING
 * WORKSPACE.
 *
 * It is tempting to seed the two industry-standard rules on company creation so
 * the feature "just works". That would mean every workspace already using this
 * product starts texting its customers automatically tomorrow morning, without
 * anybody having asked for it. Automated outbound to a consumer is the category
 * with a private right of action attached to it (#237's own scope names TCPA),
 * and the crew — not us — has to be the one who decided.
 *
 * So the defaults are OFFERED rather than applied: the GET returns them
 * alongside whatever the workspace has, and the settings screen can fill the
 * form with them in one tap. The difference between those two designs is one
 * network call for the owner and a compliance exposure for us.
 */
import {
  DEFAULT_REMINDER_RULES,
  REMINDER_OFFSET_MAX_MINUTES,
  REMINDER_OFFSET_MIN_MINUTES,
  REMINDER_RULES_CAP,
  SCHEDULED_BODY_MAX,
} from "@loonext/shared";
import { Hono } from "hono";
import { z } from "zod";

import { requireCapability } from "../auth/company";
import type { AppEnv } from "../context";
import { getDb } from "../db";
import { getEnv } from "../env";
import { ApiError } from "../http/errors";
import { parseJsonBody, unwrap } from "./core/http";

export const appointmentReminderRoutes = new Hono<AppEnv>();

const ruleSchema = z.object({
  offset_minutes: z
    .number()
    .int()
    .min(REMINDER_OFFSET_MIN_MINUTES)
    .max(REMINDER_OFFSET_MAX_MINUTES),
  body: z.string().trim().min(1).max(SCHEDULED_BODY_MAX),
  enabled: z.boolean().optional(),
});

/**
 * The WHOLE set, replaced in one call.
 *
 * Not per-rule CRUD. There are at most two of them, they are edited together on
 * one screen, and a partial update would let a client leave the workspace with
 * a rule it did not intend by failing halfway. Replace-all also makes "turn
 * reminders off entirely" an empty array rather than a separate verb.
 */
const putSchema = z.object({
  rules: z.array(ruleSchema).max(REMINDER_RULES_CAP),
});

appointmentReminderRoutes.get(
  "/appointment-reminders",
  requireCapability("conversations.read"),
  async (c) => {
    const companyId = c.get("companyId");
    const db = getDb(getEnv(c.env));

    const rules = unwrap<Record<string, unknown>[]>(
      await db
        .from("appointment_reminder_rules")
        .select("id,offset_minutes,body,enabled,created_at,updated_at")
        .eq("company_id", companyId)
        // Furthest-out first, which is the order they fire in and the order a
        // person thinks about them: the day before, then the morning of.
        .order("offset_minutes", { ascending: false }),
      "appointment reminder rules",
    );

    return c.json({
      rules,
      // Offered, never applied. See the header.
      suggested: DEFAULT_REMINDER_RULES,
      cap: REMINDER_RULES_CAP,
    });
  },
);

appointmentReminderRoutes.put(
  "/appointment-reminders",
  requireCapability("settings.manage"),
  async (c) => {
    const companyId = c.get("companyId");
    const userId = c.get("userId");
    const db = getDb(getEnv(c.env));

    const { rules } = await parseJsonBody(c, putSchema);

    // Two rules at the same offset is the same reminder arriving twice, which
    // is the failure a customer notices and blames the business for. The unique
    // index would catch it as a 500; catching it here says something useful.
    const offsets = new Set(rules.map((rule) => rule.offset_minutes));
    if (offsets.size !== rules.length) {
      throw new ApiError(
        "validation_failed",
        "Two reminders cannot go out the same length of time before a job — the customer would get the same text twice.",
      );
    }

    // Replace-all, and the delete comes first so removing a rule really removes
    // it. An upsert-only sync leaves a deleted offset firing forever, which is
    // the same asymmetry `api_sync_task_reminders` avoids by rebuilding.
    unwrap(
      await db
        .from("appointment_reminder_rules")
        .delete()
        .eq("company_id", companyId),
      "clear appointment reminder rules",
    );

    if (rules.length > 0) {
      unwrap(
        await db.from("appointment_reminder_rules").insert(
          rules.map((rule) => ({
            company_id: companyId,
            offset_minutes: rule.offset_minutes,
            body: rule.body,
            enabled: rule.enabled ?? true,
            created_by: userId,
          })),
        ),
        "insert appointment reminder rules",
      );
    }

    const saved = unwrap<Record<string, unknown>[]>(
      await db
        .from("appointment_reminder_rules")
        .select("id,offset_minutes,body,enabled,created_at,updated_at")
        .eq("company_id", companyId)
        .order("offset_minutes", { ascending: false }),
      "appointment reminder rules",
    );

    // NOT re-syncing every open job here, deliberately. A workspace with two
    // hundred booked jobs would turn one settings save into two hundred
    // regenerations inside one request. Each job picks up the new rules the
    // next time it is touched, and until then the old queue is still correct
    // for what it was queued from — while `jobStillBooked` keeps anything stale
    // from reaching a customer. A sweep that reconciles the rest belongs with
    // the cron, not here.
    return c.json({ rules: saved });
  },
);
