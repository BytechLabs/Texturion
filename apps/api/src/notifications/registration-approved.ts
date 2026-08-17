/**
 * #310 — the moment the customer becomes a customer.
 *
 * A tradesperson signs up at 9pm on a Sunday because they are fed up with
 * missing jobs. That is the moment of maximum intent, and it is the moment we
 * say "come back in a few days" while 10DLC registration clears. By the time
 * approval lands the urgency has passed, the tab is closed, and the number they
 * bought is a line item on a card statement attached to nothing.
 *
 * Approval was already emailed. Email is the wrong channel for this alone: it
 * arrives in an inbox they may not open for a day, about a product they have
 * not yet formed a habit around. **Push is the one that lands on the phone
 * they are already holding** — and it was the missing channel.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS THE ONE PUSH THAT IGNORES ALMOST NOTHING.
 *
 * It still respects `push_enabled` — a member who turned push off does not get
 * it back through a side door, which is the rule every other sender here obeys.
 *
 * But it deliberately does NOT ride the daily push ceiling that inbound alerts
 * share. That ceiling exists to stop a busy inbox from becoming a nuisance;
 * this fires **once per workspace, ever**, at the single highest-value moment
 * in the customer's lifecycle. Being dropped because the inbox was busy that
 * day would be the worst possible trade.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Env } from "../env";
import { deliverPush } from "./deliver";

/**
 * What the lock screen says, in each of the two situations approval can land in.
 *
 * NAMED CONSTANTS RATHER THAN LITERALS AT THE CALL SITE so a guard can assert
 * against the shipped words instead of a phrase somebody retyped in a test — a
 * test that quotes a string nobody renders cannot fail.
 */
export const REGISTRATION_APPROVED_PUSH = {
  title: "Your texting is live",
  // Names the thing they signed up to do, not the process that finished.
  // "Campaign approved" is our vocabulary; "you can text customers" is theirs,
  // and this is the notification that has to land.
  body: "Carrier approval came through. You can text customers now.",
} as const;

/**
 * #525 — approval landing on a PAUSED workspace.
 *
 * Registering during a pause is allowed on purpose (the carrier wait is free in
 * a quiet winter, and the $29 is charged once per workspace ever), so approval
 * routinely arrives for somebody every send path is refusing. Telling them they
 * can text customers now would send them into the app to be turned away by
 * `runPreSendGates`, holding a notification that contradicts it.
 *
 * Still opens with the approval, because it is genuinely good news and the whole
 * argument for registering early: the wait is behind them rather than ahead of
 * them in spring. What changes is the second sentence — what to do next is
 * resume, not text.
 */
export const REGISTRATION_APPROVED_PAUSED_PUSH = {
  title: "Your US registration is approved",
  body: "Carrier approval came through. Texts send once you resume your plan.",
} as const;

/**
 * Tell the crew their US texting just went live.
 *
 * Best-effort by construction: this is a side effect of an already-applied
 * transition, and the email has already gone. A push failure must never wedge
 * the state machine or make the approval look like it did not happen.
 *
 * `paused` IS A REQUIRED ARGUMENT, not a lookup done here. The caller has just
 * read the company row that carries `paused_at` and is choosing the matching
 * email from the same fact — re-reading it would let the two channels disagree
 * about one workspace, which is the failure this whole branch exists to prevent.
 */
export async function pushRegistrationApproved(
  env: Env,
  db: SupabaseClient,
  companyId: string,
  paused: boolean,
): Promise<void> {
  try {
    const { data: memberData, error: memberError } = await db
      .from("company_members")
      .select("user_id")
      .eq("company_id", companyId)
      .is("deactivated_at", null);
    if (memberError) throw new Error(memberError.message);

    const audience = (memberData ?? []).map((row) => (row as { user_id: string }).user_id);
    if (audience.length === 0) return;

    const { data: prefData, error: prefError } = await db
      .from("notification_prefs")
      .select("user_id,push_enabled")
      .eq("company_id", companyId)
      .in("user_id", audience);
    if (prefError) throw new Error(prefError.message);

    const prefs = new Map(
      (prefData ?? []).map((row) => {
        const pref = row as { user_id: string; push_enabled: boolean };
        return [pref.user_id, pref.push_enabled];
      }),
    );
    // Default true: a member who has never opened the settings screen has not
    // opted out of anything.
    const recipients = audience.filter((userId) => prefs.get(userId) ?? true);
    if (recipients.length === 0) return;

    const notice = paused
      ? REGISTRATION_APPROVED_PAUSED_PUSH
      : REGISTRATION_APPROVED_PUSH;
    const failures: unknown[] = [];
    await deliverPush(env, db, {
      category: "operational",
      companyId,
      userIds: recipients,
      // #430: about the workspace, not about any customer. Withholding it
      // would protect nobody and cost the owner the one alert they have been
      // waiting days for.
      content: { written: "us" },
      web: () => ({
        title: notice.title,
        body: notice.body,
        // #525: the tap lands where the next action is. An inbox they cannot
        // send from is the wrong destination for a notification whose whole
        // message is "resume first".
        url: paused
          ? `${env.APP_ORIGIN}/settings/billing`
          : `${env.APP_ORIGIN}/inbox`,
      }),
      // Once per workspace, ever. A collapse key scoped to the company means a
      // redelivered webhook replaces rather than repeats.
      collapseKey: `registration-approved:${companyId}`,
      failures,
    });

    // One dead device must not cost the rest of the crew the news, so
    // `deliverPush` collects rather than throws. Logged, not raised: the whole
    // point here is that nothing about this push can undo the approval.
    if (failures.length > 0) {
      console.warn(
        `registration approval push: ${failures.length} delivery failure(s) for ${companyId}`,
      );
    }
  } catch (cause) {
    // Swallowed on purpose. The transition is applied and the email is sent;
    // a push outage must not turn the best moment in the lifecycle into a
    // failed job that retries the whole approval.
    console.error(`registration approval push failed for ${companyId}: ${String(cause)}`);
  }
}
