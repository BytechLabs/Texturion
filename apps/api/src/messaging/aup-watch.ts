/**
 * #303 — notice an AUP breach before a carrier does, and tell a human.
 *
 * `/legal/aup` exists and acceptance is mandatory at company creation. What
 * followed acceptance was nothing. For a messaging provider that is the
 * standard failure mode rather than a hypothetical: the industry rules are
 * enforced against US, not against the customer who broke them, so carrier
 * filtering and account-level action land on the whole sending pool and one
 * abusive workspace is billed to every other customer's deliverability (#235).
 *
 * ---------------------------------------------------------------------------
 * IT ALERTS. IT NEVER ACTS.
 *
 * The issue is explicit and it is right: "a genuinely busy crew after a storm
 * looks statistically like a spammer, and suspending them would be a
 * catastrophic false positive." The asymmetry decides the design — a missed
 * spammer costs us a carrier conversation, a suspended roofer on the busiest
 * day of their year costs them their business and us the customer. So this
 * writes an email to ops and changes nothing about the workspace.
 *
 * That also keeps it honest about what it knows. These are SHAPES, not
 * verdicts: the alert says what was unusual and leaves the judgement to the
 * person reading it.
 *
 * ---------------------------------------------------------------------------
 * BEHAVIOURAL, NEVER CONTENT.
 *
 * The other way this goes wrong is surveillance. Nothing here reads a message
 * body — `api_aup_signals` returns counts and ratios only — because a detector
 * that reads customer words to protect our sending reputation would betray the
 * privacy posture the rest of the product holds, and would be a worse trade
 * than the risk it manages.
 *
 * ---------------------------------------------------------------------------
 * WHY A CONJUNCTION AND NOT A THRESHOLD.
 *
 * Volume alone is a busy day. Reaching strangers alone is a new workspace doing
 * exactly what it should. It is the two TOGETHER — far above this workspace's
 * own ordinary day AND mostly to numbers it has never contacted — that
 * describes mass marketing and nothing else. Opt-outs are the third arm and the
 * only one that needs no interpretation: it is the recipients' own verdict.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { getDb } from "../db";
import { sendEmail } from "../email/resend";
import { renderEmailHtml } from "../email/html";
import type { Env } from "../env";

/**
 * How far above its OWN median day a workspace has to be before volume counts
 * as unusual. Five is deliberately generous: a small crew's median is a small
 * number, and a genuinely busy week must not trip this.
 */
const VELOCITY_MULTIPLE = 5;

/**
 * Below this, a multiple means nothing. A workspace whose median day is 2 hits
 * 5x by sending 10 texts, which is a Tuesday with one extra job on it.
 */
const MIN_SENDS_TO_JUDGE = 100;

/**
 * Share of a day's sends reaching numbers never contacted before. Mass
 * marketing is defined by reaching strangers; a busy crew is texting people who
 * already called them. Set high because a NEW workspace legitimately sits near
 * 1.0 for its first weeks — which is why this is only ever read alongside the
 * velocity arm, never alone.
 */
const FRESH_RATIO = 0.8;

/** Opt-outs in a day that speak for themselves, whatever the volume was. */
const OPT_OUT_ALARM = 10;

export interface AupSignals {
  company_id: string;
  company_name: string | null;
  sent_24h: number;
  baseline_daily: number;
  fresh_ratio: number;
  opt_outs_24h: number;
}

/** Why this workspace is being reported, in the words the email will use. */
export function aupConcerns(row: AupSignals): string[] {
  const concerns: string[] = [];
  const sent = Number(row.sent_24h ?? 0);
  const baseline = Number(row.baseline_daily ?? 0);
  const fresh = Number(row.fresh_ratio ?? 0);
  const optOuts = Number(row.opt_outs_24h ?? 0);

  // The conjunction. Either half alone is an ordinary thing a real business
  // does, and reporting either alone is how this becomes noise and gets muted.
  const fastForThem =
    sent >= MIN_SENDS_TO_JUDGE && baseline > 0 && sent >= baseline * VELOCITY_MULTIPLE;
  if (fastForThem && fresh >= FRESH_RATIO) {
    concerns.push(
      `${sent} sends in a day against a usual ${Math.round(baseline)}, and ` +
        `${Math.round(fresh * 100)}% went to numbers this workspace had never ` +
        `texted before — the shape of a marketing blast rather than a busy week`,
    );
  }

  // Stands alone, because it is not our inference: these people pressed STOP.
  if (optOuts >= OPT_OUT_ALARM) {
    concerns.push(
      `${optOuts} opt-outs in a day — the recipients' own verdict, and the one ` +
        `signal here that needs no interpretation`,
    );
  }

  return concerns;
}

/**
 * Daily. Reads the signals, reports the workspaces that trip a conjunction, and
 * does nothing else.
 *
 * ONE EMAIL PER RUN rather than one per workspace: the reader is a single
 * founder, and the pattern across workspaces is itself information — three at
 * once is a different problem from one.
 */
export async function runAupWatchJob(
  env: Env,
  _now: Date = new Date(),
  db: SupabaseClient = getDb(env),
): Promise<number> {
  const { data, error } = await db.rpc("api_aup_signals", {
    p_baseline_days: 14,
  });
  if (error) throw new Error(`aup signals read failed: ${error.message}`);

  const flagged = ((data ?? []) as AupSignals[])
    .map((row) => ({ row, concerns: aupConcerns(row) }))
    .filter((entry) => entry.concerns.length > 0);
  if (flagged.length === 0) return 0;

  const lines = flagged
    .map(
      ({ row, concerns }) =>
        `• ${row.company_name ?? row.company_id} (${row.company_id})\n` +
        concerns.map((c) => `  ${c}`).join("\n"),
    )
    .join("\n\n");

  const text =
    `${flagged.length} workspace(s) are sending in a shape the AUP exists to ` +
    `catch.\n\n${lines}\n\n` +
    `NOTHING HAS BEEN DONE TO THEM. This is a look-at-it alert, deliberately: a ` +
    `crew after a storm looks statistically like a spammer, and suspending the ` +
    `wrong one costs a customer their business and us the relationship. Open ` +
    `their inbox and read a few threads before deciding anything.\n\n` +
    `These are behavioural shapes — counts and ratios — never message content. ` +
    `If one is a real breach, /legal/aup is the policy it is measured against ` +
    `and the enforcement ladder (warn, rate-limit, suspend sending, terminate) ` +
    `is a decision for a person.`;

  await sendEmail(env, {
    to: [env.OPS_ALERT_EMAIL ?? "support@loonext.com"],
    subject: `AUP: ${flagged.length} workspace(s) worth a look`,
    text,
    html: renderEmailHtml(text),
  });

  return flagged.length;
}
