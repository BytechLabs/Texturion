/**
 * #252 — "belt and braces on the ones that matter".
 *
 * A handful of notices in this product are ones a customer cannot afford to
 * miss: your subscription ended and your business number goes back to the
 * carrier in thirty days; it goes in three; it is gone. Every one of them was
 * an email, to an address that may bounce, may be filtered, and whose
 * deliverability #252 exists because we could not vouch for.
 *
 * From the customer's side a filtered warning is not an email problem. It is
 * losing the number on their van, their invoices and their Google listing,
 * with no warning they ever saw.
 *
 * The day-1/15/27 warnings got a push first, and this is that code lifted out
 * so the two notices that did not get one can have it: the cancellation notice
 * (the FIRST warning, and the one with thirty days of runway left to act on)
 * and the released notice (the last, and the one nobody should learn about by
 * noticing their number stopped working).
 *
 * ── BEST-EFFORT, AND ALWAYS AFTER THE EMAIL ───────────────────────────────
 *
 * Every caller has already claimed a ledger row or already sent, so a push
 * failure must never make the caller think the notice was not delivered — it
 * was, by the channel that has always carried it. Throwing would also re-run
 * the whole notice on the next sweep, where the claim would refuse it and the
 * email would not resend either. So the failure is logged and swallowed here,
 * exactly once, rather than at each call site.
 *
 * ── NO CONTENT TO WITHHOLD ────────────────────────────────────────────────
 *
 * These are our own sentences about the workspace's own billing, never a
 * customer's words, so #430's content rules have nothing to hide here.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Locale } from "@loonext/shared";

import type { Env } from "../env";
import { deliverPush } from "../notifications/deliver";

export async function pushConsequentialNotice(
  env: Env,
  db: SupabaseClient,
  args: {
    companyId: string;
    /**
     * The email's subject, so both channels say the same thing.
     *
     * #228: a function of the reader's language, matching `PushDelivery.web`.
     * Passing a finished string here would have been the quiet failure — this
     * helper composes the payload itself, so a caller with translations had
     * nowhere to put them and the locale would have stopped at this boundary.
     *
     * It must be INVOKED before it reaches the payload. A function left in
     * `title` is not a type error at runtime, it is a field `JSON.stringify`
     * silently drops — a notice with no title and no body, which is worse than
     * one in the wrong language.
     */
    title: (locale: Locale) => string;
    body: (locale: Locale) => string;
    /** Where acting on it starts. */
    path: string;
    /**
     * One notice per rung. Day 15 must not erase day 27 — each is a different
     * deadline and the later one matters most — so callers key by the rung
     * rather than by the company.
     */
    collapseKey: string;
  },
): Promise<void> {
  try {
    // Owners and admins. A member cannot act on any of this, and waking
    // somebody at a job to tell them about a billing deadline they cannot
    // resolve is how a workspace learns to swipe our notifications away.
    const { data, error } = await db
      .from("company_members")
      .select("user_id")
      .eq("company_id", args.companyId)
      .is("deactivated_at", null)
      .in("role", ["owner", "admin"]);
    if (error) throw new Error(`consequential push audience failed: ${error.message}`);

    const userIds = ((data ?? []) as { user_id: string }[]).map((row) => row.user_id);
    if (userIds.length === 0) return;

    const failures: unknown[] = [];
    await deliverPush(env, db, {
      category: "operational",
      companyId: args.companyId,
      userIds,
      content: { written: "us" },
      web: (locale) => ({
        title: args.title(locale),
        body: args.body(locale),
        url: `${env.APP_ORIGIN}${args.path}`,
      }),
      collapseKey: args.collapseKey,
      failures,
    });
    if (failures.length > 0) {
      throw new AggregateError(failures, "consequential notice push failed");
    }
  } catch (cause) {
    console.error(
      `consequential push failed for ${args.companyId} (${args.collapseKey}):`,
      cause instanceof Error ? (cause.stack ?? cause.message) : String(cause),
    );
  }
}
