/**
 * #319 — the moment the number actually moves.
 *
 * A port is the most anxious week a customer spends with us. They have handed
 * over the line their business runs on, told nobody to call the old one yet,
 * and cannot tell from the outside whether anything is happening. #319 names
 * exactly that: they hand us their business line and then sit in the dark.
 *
 * Cutover was emailed and nothing else. Email is the wrong channel to carry
 * this alone, for a sharper reason than usual: **the customer needs to change
 * their behaviour the moment it lands.** Until cutover their old provider is
 * still carrying the line; after it, calls and texts arrive here and nowhere
 * else. Somebody who reads the news four hours later has spent four hours not
 * watching the inbox their customers are now texting.
 *
 * ---------------------------------------------------------------------------
 * MODELLED ON `registration-approved.ts`, DELIBERATELY, INCLUDING THE PART THAT
 * IGNORES THE DAILY CEILING.
 *
 * `push_enabled` is still obeyed: a member who turned push off does not get it
 * back through a side door, which is the rule every sender here follows.
 *
 * The daily push ceiling is not. That ceiling stops a busy inbox becoming a
 * nuisance; this fires once per port, ever, at the transition the whole feature
 * exists to deliver. Dropping it because the inbox was busy that day would be
 * the worst trade available.
 *
 * The email still goes. This is a second channel for one event, not a
 * replacement, because the two fail in different ways: push dies with a stale
 * token, email sits unread in a tab.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Env } from "../env";
import { deliverPush } from "./deliver";

/**
 * Tell the crew their number has moved.
 *
 * Best-effort by construction: the transition is already applied and the email
 * has already gone, so a push failure must never wedge the port state machine
 * or make a completed cutover look like it did not happen.
 */
export async function pushPortCompleted(
  env: Env,
  db: SupabaseClient,
  companyId: string,
  numberE164: string,
): Promise<void> {
  try {
    const { data: memberData, error: memberError } = await db
      .from("company_members")
      .select("user_id")
      .eq("company_id", companyId)
      .is("deactivated_at", null);
    if (memberError) throw new Error(memberError.message);

    const audience = (memberData ?? []).map(
      (row) => (row as { user_id: string }).user_id,
    );
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

    const failures: unknown[] = [];
    await deliverPush(env, db, {
      companyId,
      userIds: recipients,
      // #430: this is about the workspace's own number, not about any
      // customer, so there is nothing to withhold.
      content: { written: "us" },
      web: {
        title: "Your number is live",
        // The customer's vocabulary, and the same news the email carries, so
        // somebody who gets both does not wonder whether they are two events.
        // The number is in the body because a crew mid-port may be moving more
        // than one line and "your number" would not say which.
        body: `${numberE164} is on Loonext now. Text your customers from your inbox.`,
        url: `${env.APP_ORIGIN}/inbox`,
      },
      // Once per number, ever. Scoping the collapse key to the number rather
      // than the company means a workspace porting two lines gets told about
      // both, while a redelivered webhook replaces rather than repeats.
      collapseKey: `port-completed:${companyId}:${numberE164}`,
      failures,
    });

    // One dead device must not cost the rest of the crew the news, so
    // `deliverPush` collects rather than throws.
    if (failures.length > 0) {
      console.warn(
        `port completion push: ${failures.length} delivery failure(s) for ${companyId}`,
      );
    }
  } catch (cause) {
    // Swallowed on purpose. The number is live and the email is sent; a push
    // outage must not turn a successful cutover into a failed job that retries
    // the whole completion.
    console.error(
      `port completion push failed for ${companyId}: ${String(cause)}`,
    );
  }
}
