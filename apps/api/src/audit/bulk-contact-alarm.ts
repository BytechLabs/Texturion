/**
 * #345 / #231 / #497 — tell the owner when somebody takes the customer data.
 *
 * #231 named the reason plainly: *"A contact export or mass delete is the
 * departing-employee signature. Log it, and notify the owner when it happens."*
 * The log half is the audit row beside every call to this. This is the other
 * half, and it is the only PROACTIVE thing in the audit system — everything else
 * waits to be read by somebody who already suspects something.
 *
 * That asymmetry is the point. An audit log answers questions; it does not raise
 * them. A workspace owner is not reading /settings/history on an ordinary
 * Tuesday, and the whole customer list leaving on an ordinary Tuesday is exactly
 * the case worth knowing about within the hour rather than during an
 * investigation three weeks later.
 *
 * NEVER FIRES FOR THE OWNER'S OWN EXPORT. They know; they just did it. An alert
 * that mostly reports the owner to themselves is an alert they filter, and then
 * it is not there for the one that matters. That is the whole discipline #231
 * asked for — *"must not be so chatty that a legitimate migration buries the one
 * that matters"* — and it is why this takes the actor rather than reading it
 * from a context.
 *
 * BEST EFFORT, ALWAYS. The export already happened and already has its audit
 * row; a mail failure must not turn a successful download into a 500. Anything
 * that goes wrong here is logged for us and invisible to the customer.
 *
 * COUNTS, NEVER CONTENT. The email says how many rows moved and who moved them.
 * It cannot say which customers, because this is the one email in the product
 * most likely to be forwarded outside the workspace.
 */
import * as Sentry from "@sentry/cloudflare";
import type { SupabaseClient } from "@supabase/supabase-js";

import { renderEmailHtml } from "../email/html";
import { sendEmail } from "../email/resend";
import type { Env } from "../env";

/** What happened to the contacts, in the words the email uses. */
export type BulkContactEvent =
  | "exported"
  | "bulk_deleted"
  | "workspace_exported"
  // #304: one customer's whole correspondence, taken out as a document.
  // Narrower than the workspace dump and the same class of act — it is the
  // record of one relationship leaving the product, and the owner should
  // hear about it for the same reason.
  | "history_exported";

export interface BulkContactAlarm {
  companyId: string;
  /** Who did it. Compared against the owner, and named in the email. */
  actorUserId: string;
  event: BulkContactEvent;
  /**
   * How many contact rows were involved. Ignored for `workspace_exported`,
   * which is built asynchronously and has no count at request time — and does
   * not need one, because "everything the business holds" is not a quantity
   * anybody needs told.
   */
  count: number;
}

/**
 * Below this, say nothing. A member exporting a handful of rows is somebody
 * looking something up, not somebody taking the list — and an alert that fires
 * on a three-row export teaches the owner to ignore the one that fires on three
 * thousand.
 *
 * Deliberately low rather than clever: a real theft is orders of magnitude
 * above it, and the failure mode of setting it too low (a few extra emails) is
 * far cheaper than setting it too high (silence on the one that counts).
 */
export const BULK_CONTACT_ALARM_MIN_ROWS = 25;

/**
 * Fire-and-forget: schedules the alarm and returns immediately.
 *
 * The export route streams a CSV a person is waiting on, and this does a
 * company read, two auth lookups and a Resend call. Awaiting all of that before
 * the first byte would make every export slower for everybody so that a rare
 * email arrives a second sooner — and a Resend outage would turn a working
 * download into a timeout. `waitUntil` is the Workers answer: the response goes
 * now, the mail goes after.
 */
export function alarmOnBulkContactAccess(
  c: { executionCtx: { waitUntil: (promise: Promise<unknown>) => void } },
  env: Env,
  db: SupabaseClient,
  alarm: BulkContactAlarm,
): void {
  const work = deliver(env, db, alarm);
  try {
    c.executionCtx.waitUntil(work);
  } catch {
    // No execution context (tests, and the `app.request()` path): the promise
    // is already running and already swallows its own failures.
  }
}

async function deliver(
  env: Env,
  db: SupabaseClient,
  alarm: BulkContactAlarm,
): Promise<void> {
  try {
    // #497: the threshold is about telling a lookup from a theft, and a
    // WORKSPACE export is never a lookup — it is every contact, message and
    // call the business holds, by definition. Gating it on a contact count it
    // does not have would silence the loudest signal in the product.
    if (
      alarm.event !== "workspace_exported" &&
      // #304: built asynchronously, so there is no message count to compare —
      // and one customer's whole history is not a lookup whatever its size.
      alarm.event !== "history_exported" &&
      alarm.count < BULK_CONTACT_ALARM_MIN_ROWS
    ) {
      return;
    }

    const { data: companyRows, error: companyError } = await db
      .from("companies")
      .select("id,name,owner_user_id")
      .eq("id", alarm.companyId)
      .limit(1);
    if (companyError) throw new Error(companyError.message);
    const company = companyRows?.[0] as
      | { id: string; name: string; owner_user_id: string }
      | undefined;
    if (!company) return;

    // The owner doing it themselves is not news.
    if (company.owner_user_id === alarm.actorUserId) return;

    const [ownerResult, actorResult] = await Promise.all([
      db.auth.admin.getUserById(company.owner_user_id),
      db.auth.admin.getUserById(alarm.actorUserId),
    ]);
    const ownerEmail = ownerResult.data?.user?.email;
    if (ownerResult.error || !ownerEmail) return;

    // The actor's email rather than their display name: a display name is
    // editable by the person it describes, and this is the one email where that
    // matters. Falls back to the id, which is still enough to act on.
    const actor = actorResult.data?.user?.email ?? alarm.actorUserId;

    const what =
      alarm.event === "workspace_exported"
        ? "requested a full export of this workspace"
        : alarm.event === "history_exported"
          ? "exported one customer's message history"
          : alarm.event === "exported"
            ? `downloaded ${alarm.count} contacts`
            : `deleted ${alarm.count} contacts`;
    const text =
      `${actor} just ${what} in ${company.name}.\n\n` +
      `If that was expected, nothing needs doing. If it was not, the full ` +
      `record — who, when, and from where — is at ` +
      `${env.APP_ORIGIN}/settings/history.\n\n` +
      `You are getting this because you own this workspace. It is sent for ` +
      `bulk actions only, and never for your own.`;

    await sendEmail(env, {
      to: [ownerEmail],
      subject:
        alarm.event === "workspace_exported"
          ? `${actor} requested a full export of ${company.name}`
          : alarm.event === "history_exported"
            ? `${actor} exported a customer's message history from ${company.name}`
            : `${actor} ${alarm.event === "exported" ? "exported" : "deleted"} ${alarm.count} contacts`,
      text,
      html: renderEmailHtml(text),
    });
  } catch (cause) {
    // Loud for us, invisible to the customer — the same posture as a failed
    // audit write, and for the same reason: the action succeeded and must not
    // be undone, but a missing alarm is not something to swallow silently.
    Sentry.captureMessage(
      `bulk contact alarm failed for ${alarm.companyId}/${alarm.event}: ` +
        (cause instanceof Error ? cause.message : String(cause)),
      "warning",
    );
  }
}
