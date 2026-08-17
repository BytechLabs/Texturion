/**
 * #244 — the page nobody answered, widened.
 *
 * "Unacknowledged emergencies must escalate rather than evaporate." This is the
 * half of on-call routing that makes narrowing SAFE: sending one person a
 * missed-call alert is only defensible because this runs ten minutes later if
 * they slept through it.
 *
 * Same lease shape as the scheduled-message queue (#233) — claim by UPDATE with
 * the deadline still set, so two workers cannot both widen one alert and wake
 * the crew twice about one call.
 *
 * THE SECOND PUSH HAS TO SAY WHY IT IS ARRIVING. A crew that gets a duplicate
 * "Missed call from Dana" ten minutes after the first learns that this product
 * sends things twice. "Nobody has picked this up" is a different sentence about
 * a different fact, and it is the one that gets somebody out of bed.
 */
import type { Locale } from "@loonext/shared";

import { listConversationViewers } from "../auth/conversation-audience";
import { getDb } from "../db";
import type { Env } from "../env";
import { deliverPush } from "./deliver";
import { ESCALATION_COPY } from "./escalation-copy";

/** How many alerts one tick will widen. */
const MAX_PER_TICK = 50;

export interface EscalationSweepSummary {
  claimed: number;
  widened: number;
}

interface AlertRow {
  id: string;
  company_id: string;
  conversation_id: string;
  kind: string;
  on_call_user_id: string | null;
}

/**
 * What the crew reads at 11:52pm.
 *
 * Deliberately not the original alert's words. The fact being reported is not
 * "a call came in" — they were told that, or the on-call member was — it is
 * "ten minutes later nobody has touched it", which is the thing that needs a
 * different person to act.
 *
 * #228: the kind picks a WHOLE title from the copy table rather than a noun to
 * be pasted in front of a shared tail. See `escalation-copy.ts` — English can
 * build the sentence from a fragment and French cannot be relied on to keep
 * that property.
 */
export function escalationCopy(
  kind: string,
  locale: Locale,
): { title: string; body: string } {
  const copy = ESCALATION_COPY[locale];
  const title =
    kind === "missed_call"
      ? copy.missedCallTitle
      : kind === "emergency"
        ? copy.emergencyTitle
        : copy.genericTitle;
  return { title, body: copy.body };
}

/**
 * Widen every alert whose grace period has run out.
 *
 * Best-effort per alert: one workspace's dead push tokens must not stop the
 * next workspace's emergency from reaching anybody. Failures are logged and the
 * run continues, because the alternative is a single bad row holding the whole
 * sweep hostage every minute.
 */
export async function runEscalationSweep(
  env: Env,
  now = new Date(),
): Promise<EscalationSweepSummary> {
  const db = getDb(env);
  const summary: EscalationSweepSummary = { claimed: 0, widened: 0 };

  const { data, error } = await db.rpc("api_claim_due_alerts", {
    p_now: now.toISOString(),
    p_limit: MAX_PER_TICK,
  });
  if (error) throw new Error(`claim due alerts failed: ${error.message}`);

  const alerts = (data ?? []) as AlertRow[];
  summary.claimed = alerts.length;

  for (const alert of alerts) {
    try {
      const conversation = await db
        .from("conversations")
        .select("phone_number_id")
        .eq("id", alert.conversation_id)
        .eq("company_id", alert.company_id)
        .maybeSingle();
      const thread = conversation.data as { phone_number_id: string | null } | null;
      // UNCERTAINTY DOES NOT WIDEN HERE, and that is the opposite of the rule
      // in `on-call.ts` — deliberately.
      //
      // There, not knowing the hour meant waking extra people, which is merely
      // noisy. Here, not knowing WHICH NUMBER the thread is on means not
      // knowing who is allowed to see it: `phoneNumberId: undefined` reads as
      // "no restriction" and would page members #106 denies access to. A
      // failed read must therefore stop this alert, not broaden it.
      if (conversation.error || !thread) {
        throw new Error(
          `escalation ${alert.id}: conversation ${alert.conversation_id} ` +
            `unreadable (${conversation.error?.message ?? "no row"})`,
        );
      }

      const viewers = await listConversationViewers(db, {
        companyId: alert.company_id,
        phoneNumberId: thread.phone_number_id,
      });

      // Everyone EXCEPT the person who was already paged. They have the first
      // notification on their phone already; a second one telling them nobody
      // has picked it up is the product arguing with itself.
      const widenTo = viewers
        .map((viewer) => viewer.user_id)
        .filter((userId) => userId !== alert.on_call_user_id);
      if (widenTo.length === 0) continue;

      // #228: the sentence is composed per reader, so only the link — the same
      // for everyone — can be settled up here.
      const url = `${env.APP_ORIGIN}/inbox/${alert.conversation_id}`;
      const failures: unknown[] = [];
      await deliverPush(env, db, {
        category: "missed_calls",
        companyId: alert.company_id,
        failures,
        userIds: widenTo,
        // #430: every word is ours — see escalationCopy. Nothing the customer
        // wrote appears here.
        content: { written: "us" },
        // Distinct from the original alert's conversation key ON PURPOSE. This
        // must not replace the first notification on a phone that has it: they
        // are two different facts, and collapsing them would silently turn the
        // escalation into an edit of a message the reader may never have seen.
        collapseKey: `escalation:${alert.id}`,
        // #244: this IS the emergency override. An alert that has already gone
        // unanswered for the grace period is exactly the case a member's quiet
        // hours must not swallow — it is the reason the window is safe to set.
        overridesQuietHours: { reason: "escalation" },
        web: (locale) => ({ ...escalationCopy(alert.kind, locale), url }),
        native: (locale) => ({
          kind: "escalation",
          ...escalationCopy(alert.kind, locale),
          url,
          alert_id: alert.id,
        }),
      });
      if (failures.length > 0) {
        console.error(
          `escalation sweep: ${failures.length} push(es) failed for alert ${alert.id}`,
        );
      }
      summary.widened += 1;
    } catch (cause) {
      // The claim already happened, so this alert will not be retried. That is
      // the right trade: a retry loop on a broken row would re-page the crew
      // every minute, and the alert is still visible in the thread and on the
      // For You surface.
      console.error(`escalation sweep: alert ${alert.id} failed`, cause);
    }
  }

  return summary;
}
