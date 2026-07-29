/**
 * #281 item 4 — notice a workspace stalling in the funnel while somebody can
 * still do something about it.
 *
 * The issue's framing is the whole justification: "A workspace sitting at the
 * same step for days is recoverable with one founder message and a churn
 * statistic a week later. The events exist; nothing watches for their absence."
 *
 * The states, and why they are separate rather than one "stalled" flag, are
 * argued in the migration. The short version: a US workspace inside the carrier
 * wait is QUEUED, not stalled, and alerting on it would fire on every US signup
 * for the first week of their life. An alarm that fires on the normal case is an
 * alarm nobody reads — which is the failure mode #244 warns about and the reason
 * `job:call-silence` announces transitions only.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { getDb } from "../db";
import { renderEmailHtml } from "../email/html";
import { sendEmail } from "../email/resend";
import type { Env } from "../env";

/** One workspace whose activation state changed since the last assessment. */
export interface ActivationStallTransition {
  company_id: string;
  company_name: string | null;
  was: string;
  state: "ok" | "not_sent" | "no_reply" | "awaiting_carrier";
  days_in_state: number;
}

/**
 * What each stall means, and what the reader should do about it.
 *
 * The advice is not decoration. A founder reading "3 workspaces stalled" at
 * 7am has to decide whether to open the laptop, and the three states want
 * genuinely different responses — one is a message to the customer, one is
 * reading what they sent, one is chasing a carrier. An alert that does not say
 * which is a notification rather than information.
 */
const EXPLANATION: Record<string, { heading: string; advice: string }> = {
  not_sent: {
    heading: "can send and have not",
    advice:
      "They are past every gate and have sent nothing. This is the one that a " +
      "single message usually fixes: ask what they are stuck on. The commonest " +
      "answers are not knowing the crew has to be invited, and waiting to " +
      "import contacts they do not actually need.",
  },
  no_reply: {
    heading: "sent, and nobody answered",
    advice:
      "They texted and got no reply inside seven days, which is an activation " +
      "failure by D12's own definition rather than a slow start. Worth reading " +
      "what they sent: texting into silence usually means the number is not the " +
      "one their customers know, or the first message did not ask anything.",
  },
  awaiting_carrier: {
    heading: "still waiting on the carrier",
    advice:
      "Not their fault and not a stall — but our own copy promises 3 to 7 " +
      "business days, and this is past it. The claim is what is failing here, " +
      "so check the registration for a fixable rejection before assuming the " +
      "queue is just slow.",
  },
};

/**
 * The ops report for a set of transitions, or null when there is nothing to
 * say. Pure, so the copy for each state is assertable without a database — the
 * wording IS the feature here, because an alert nobody can act on is an alert
 * that gets filtered.
 */
export function composeStallReport(
  transitions: ActivationStallTransition[],
): { subject: string; text: string } | null {
  const entered = transitions.filter((row) => row.state !== "ok");
  const recovered = transitions.filter((row) => row.state === "ok");
  if (entered.length === 0 && recovered.length === 0) return null;

  const parts: string[] = [];
  for (const [state, copy] of Object.entries(EXPLANATION)) {
    const rows = entered.filter((row) => row.state === state);
    if (rows.length === 0) continue;
    const listed = rows
      .map(
        (row) =>
          `  ${row.company_name ?? row.company_id}: ${row.days_in_state} day(s)`,
      )
      .join("\n");
    parts.push(
      `${rows.length} workspace(s) ${copy.heading}:\n${listed}`,
      "",
      copy.advice,
      "",
    );
  }
  if (recovered.length > 0) {
    const listed = recovered
      .map((row) => `  ${row.company_name ?? row.company_id} (was ${row.was})`)
      .join("\n");
    parts.push(`${recovered.length} workspace(s) got moving again:\n${listed}`);
  }

  return {
    subject:
      entered.length > 0
        ? `[ops] ${entered.length} workspace(s) stalled getting started`
        : `[ops] ${recovered.length} workspace(s) got moving again`,
    text: parts.join("\n").trimEnd(),
  };
}

/**
 * Assess every paying workspace and email ops about the ones that changed.
 * Returns the transitions so the caller can log a count.
 */
export async function runActivationStallJob(
  env: Env,
  _now: Date = new Date(),
  db: SupabaseClient = getDb(env),
): Promise<ActivationStallTransition[]> {
  const { data, error } = await db.rpc("api_assess_activation_stall");
  if (error) {
    throw new Error(`activation stall assessment failed: ${error.message}`);
  }

  const transitions = (data ?? []) as ActivationStallTransition[];
  const report = composeStallReport(transitions);
  if (!report) return transitions;

  await sendEmail(env, {
    to: [env.OPS_ALERT_EMAIL ?? "support@loonext.com"],
    subject: report.subject,
    text: report.text,
    html: renderEmailHtml(report.text),
  });

  return transitions;
}
