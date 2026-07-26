/**
 * #331 — the nightly comparison between our opt-out list and the carrier's.
 *
 * SPEC §5: manual opt-outs are enforced app-side only, because Telnyx has no
 * write API for its list. That is a deliberate limit, not a bug. What WAS a
 * bug is that nothing ever compared the two, so neither side's blind spot was
 * visible:
 *
 *   **Carrier has it, we do not.** An inbound STOP whose webhook we missed.
 *   The composer stays open, the thread looks live, and every send comes back
 *   40300 — the crew retyping the same message wondering why it will not go.
 *   This is also a webhook-health signal (#308): a run of these means inbound
 *   delivery is broken, not that customers suddenly started opting out.
 *
 *   **We have it, the carrier does not.** Expected, and the majority: every
 *   manual opt-out and every imported one lives only here by design. Counted
 *   rather than alarmed on — but counted, because "expected" should be a
 *   number somebody has seen rather than an assumption.
 *
 * WHAT IT DOES ABOUT THE FIRST KIND. It records it, with source `carrier`, and
 * says so in the report. The issue asked for divergence to be surfaced rather
 * than silently corrected, and this is not silent: it lands in the opt-out
 * list, on the conversation timeline, in the audit log, and in the ops email.
 * The alternative — reporting it and leaving the composer open — means we know
 * a customer said stop and keep offering to text them anyway. A STOP is the
 * customer's decision, and the carrier is the one who heard it.
 *
 * The other direction is NEVER touched. Deleting our record because Telnyx has
 * no matching one would erase a manual opt-out on every single run.
 */
import * as Sentry from "@sentry/cloudflare";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getDb } from "../db";
import { emailLayout, escapeHtml } from "../email/html";
import { sendEmail } from "../email/resend";
import type { Env } from "../env";
import { listCarrierOptOuts } from "../telnyx/opt-outs";
import { recordCarrierOptOut } from "./opt-out";

/**
 * Workspaces per run. The sweep walks a paginated vendor endpoint per profile,
 * so this bounds the nightly Telnyx call volume; the ordering below makes the
 * next run start where this one stopped.
 */
const MAX_COMPANIES_PER_RUN = 200;

export interface OptOutDivergence {
  companyId: string;
  companyName: string | null;
  /** On the carrier's list, missing from ours — and now recorded. */
  carrierOnly: string[];
  /** On ours, not on the carrier's. Expected for manual and imported ones. */
  oursOnly: number;
  /** The carrier's list was longer than one run reads. */
  truncated: boolean;
}

export interface OptOutReconcileSummary {
  companies: number;
  /** Companies whose carrier list could not be read at all. */
  failed: number;
  /** Numbers the carrier was blocking that we had no record for. */
  recorded: number;
  /** Opt-outs held only by us. Expected — this is the app-side enforcement. */
  appSideOnly: number;
  divergences: OptOutDivergence[];
}

interface CompanyRow {
  id: string;
  name: string | null;
  telnyx_messaging_profile_id: string | null;
}

/**
 * The daily job. Never throws for one company's failure: a carrier blip on one
 * profile must not stop the rest, and every step is safely repeatable
 * tomorrow.
 */
export async function reconcileOptOuts(
  env: Env,
): Promise<OptOutReconcileSummary> {
  const db = getDb(env);
  const summary: OptOutReconcileSummary = {
    companies: 0,
    failed: 0,
    recorded: 0,
    appSideOnly: 0,
    divergences: [],
  };

  const { data, error } = await db
    .from("companies")
    .select("id,name,telnyx_messaging_profile_id")
    .not("telnyx_messaging_profile_id", "is", null)
    .is("deleted_at", null)
    .order("created_at", { ascending: true })
    .limit(MAX_COMPANIES_PER_RUN);
  if (error) {
    throw new Error(`opt-out reconcile company query failed: ${error.message}`);
  }

  for (const company of (data ?? []) as CompanyRow[]) {
    if (!company.telnyx_messaging_profile_id) continue;
    summary.companies += 1;
    try {
      const divergence = await reconcileCompany(env, db, company);
      summary.recorded += divergence.carrierOnly.length;
      summary.appSideOnly += divergence.oursOnly;
      // Only worth reporting when something is actually out of step. A run
      // where every list agrees should produce no email at all.
      if (divergence.carrierOnly.length > 0 || divergence.truncated) {
        summary.divergences.push(divergence);
      }
    } catch (cause) {
      summary.failed += 1;
      Sentry.captureMessage(
        `opt-out reconcile failed for ${company.id}: ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
        "error",
      );
    }
  }

  await reportDivergence(env, summary);
  return summary;
}

async function reconcileCompany(
  env: Env,
  db: SupabaseClient,
  company: CompanyRow,
): Promise<OptOutDivergence> {
  const carrier = await listCarrierOptOuts(
    env,
    company.telnyx_messaging_profile_id as string,
  );

  const { data, error } = await db
    .from("opt_outs")
    .select("phone_e164")
    .eq("company_id", company.id)
    .is("revoked_at", null);
  if (error) throw new Error(`opt_outs read failed: ${error.message}`);

  const ours = new Set(
    ((data ?? []) as { phone_e164: string }[]).map((row) => row.phone_e164),
  );
  // De-duplicated: the carrier lists one record per profile per number, but a
  // company with several numbers on one profile can produce repeats.
  const theirs = new Set(carrier.optOuts.map((row) => row.phoneE164));

  const carrierOnly: string[] = [];
  for (const phone of theirs) {
    if (ours.has(phone)) continue;
    const recorded = await recordCarrierOptOut(db, {
      companyId: company.id,
      phoneE164: phone,
      signal: "reconciliation",
      // No conversation to point at — the inbound that carried the STOP is the
      // one we never saw. The events check permits a null for `opted_out`.
      conversationId: null,
      detail: "found on the carrier's opt-out list and missing from ours",
    });
    if (recorded) carrierOnly.push(phone);
  }

  let oursOnly = 0;
  for (const phone of ours) {
    if (!theirs.has(phone)) oursOnly += 1;
  }

  return {
    companyId: company.id,
    companyName: company.name,
    carrierOnly,
    oursOnly,
    truncated: carrier.truncated,
  };
}

/**
 * The report. Goes to ops rather than to the customer: a divergence is our
 * plumbing failing, not something a plumber can act on, and the customer-facing
 * consequence — the number is now correctly marked opted out — is already
 * visible in their app.
 *
 * Silence is the healthy state. An email every night that says "0" is one
 * nobody reads by week three, and then the one that says "47" is not read
 * either.
 */
async function reportDivergence(
  env: Env,
  summary: OptOutReconcileSummary,
): Promise<void> {
  if (summary.divergences.length === 0) return;

  const lines = summary.divergences.map((row) => {
    const name = row.companyName ?? row.companyId;
    const parts = [`${name}: ${row.carrierOnly.length} recorded from the carrier`];
    if (row.truncated) {
      parts.push("carrier list longer than one run reads — TRUNCATED");
    }
    return `- ${parts.join("; ")}`;
  });

  const text =
    `${summary.recorded} number(s) were being blocked by the carrier with no ` +
    "opt-out on our side. Each is an inbound STOP whose webhook we did not " +
    "process, and each has now been recorded so the composer stops offering " +
    "to text them.\n\n" +
    `${lines.join("\n")}\n\n` +
    `Checked ${summary.companies} workspace(s); ${summary.failed} could not ` +
    `be read. ${summary.appSideOnly} opt-out(s) are held app-side only, which ` +
    "is expected — Telnyx has no write API, so manual and imported opt-outs " +
    "live only with us.\n\n" +
    "A run of these is a webhook-delivery problem, not a sudden change in " +
    "customer behaviour.\n";

  try {
    await sendEmail(env, {
      to: [env.OPS_ALERT_EMAIL ?? "support@loonext.com"],
      subject: `Opt-out reconciliation: ${summary.recorded} missed by our webhook`,
      text,
      html: emailLayout(
        text
          .split("\n\n")
          // Company names are customer-controlled and reach this verbatim,
          // so they go through the shared escaper like every other builder.
          .map((para) => `<p>${escapeHtml(para).replaceAll("\n", "<br>")}</p>`)
          .join(""),
      ),
    });
  } catch (cause) {
    // The records are already written; the email is the notification, not the
    // fix. Losing it must not fail the sweep.
    Sentry.captureMessage(
      `opt-out reconciliation report not sent: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
      "error",
    );
  }
}
