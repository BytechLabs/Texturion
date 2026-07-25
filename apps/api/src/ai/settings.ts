/**
 * The shared plumbing every AI cost center uses: the company's opt-in toggles,
 * the atomic monthly reservation, and the one-shot alert-before-cap.
 *
 * #214 (task enrichment) grew these privately inside routes/tasks.ts. Reply
 * suggestions needs exactly the same three things, so they live here once —
 * and the reservation is now keyed per FEATURE, so each cost center gets its
 * own bucket, its own cap, and its own alert instead of sharing one counter.
 *
 * The rule every caller follows (cost-protection mandate): reserve BEFORE
 * spending, skip the model when the reservation says over-cap, and treat a
 * failed reservation as over-cap. Failing closed means a broken ledger costs
 * us a suggestion, never an unbounded bill.
 */
import type { getDb } from "../db";
import { renderEmailHtml } from "../email/html";
import { sendEmail } from "../email/resend";
import type { Env } from "../env";

type Db = ReturnType<typeof getDb>;

/** Per-company AI opt-ins (company_ai_settings). */
export interface CompanyAiSettings {
  enrich_task_address: boolean;
  enrich_task_due: boolean;
  suggest_replies: boolean;
  /**
   * One sentence describing what this business does, used to ground drafts.
   * Null means Lou has been told nothing and may not describe the business at
   * all — the difference between an honest answer and an invented one.
   */
  business_description: string | null;
  /** Whether new voicemails are transcribed. Off leaves the audio untouched. */
  transcribe_voicemail: boolean;
}

/**
 * Default when a company has never set toggles. Founder decision (#214
 * follow-up): AI help is ON by default — every output is a reviewed suggestion
 * and the monthly cap-and-drop bounds the spend — and a company can turn any of
 * them off in Settings.
 */
export const DEFAULT_AI_SETTINGS: CompanyAiSettings = {
  enrich_task_address: true,
  enrich_task_due: true,
  suggest_replies: true,
  business_description: null,
  transcribe_voicemail: true,
};

/** The columns that make up the settings row, for a `select`. */
export const AI_SETTINGS_COLUMNS =
  "enrich_task_address,enrich_task_due,suggest_replies,business_description," +
  "transcribe_voicemail";

/** Company AI toggles, falling back to the defaults when the row is absent. */
export async function loadAiSettings(
  db: Db,
  companyId: string,
): Promise<CompanyAiSettings> {
  const { data, error } = await db
    .from("company_ai_settings")
    .select(AI_SETTINGS_COLUMNS)
    .eq("company_id", companyId)
    .limit(1);
  if (error) throw new Error(`ai settings lookup failed: ${error.message}`);
  return (data?.[0] as unknown as CompanyAiSettings | undefined) ?? DEFAULT_AI_SETTINGS;
}

export interface AiReservation {
  count: number;
  over_cap: boolean;
  should_alert: boolean;
}

/**
 * Claim one unit of a feature's monthly cap (ai_usage_reserve). Returns
 * `over_cap: true` when the ledger is unreachable: a suggestion surface must
 * never 500 on its own bookkeeping, and refusing to spend is the safe way to
 * fail.
 */
export async function reserveAiUsage(
  db: Db,
  args: {
    companyId: string;
    feature: string;
    cap: number;
    alertThreshold: number;
  },
): Promise<AiReservation> {
  const { data, error } = await db.rpc("ai_usage_reserve", {
    p_company_id: args.companyId,
    p_feature: args.feature,
    p_cap: args.cap,
    p_alert_threshold: args.alertThreshold,
  });
  if (error || !data) {
    return { count: 0, over_cap: true, should_alert: false };
  }
  return data as AiReservation;
}

/**
 * The one-shot ops alert, fired the first time a company crosses a feature's
 * alert threshold in a month. `stops` says in plain language what the company
 * loses at the cap, so whoever reads the email knows the blast radius without
 * opening the code.
 */
export async function sendAiCapAlert(
  env: Env,
  args: {
    companyId: string;
    label: string;
    count: number;
    cap: number;
    alertThreshold: number;
    stops: string;
  },
): Promise<void> {
  const text =
    `Company ${args.companyId} has used ${args.count} of ${args.cap} AI ` +
    `${args.label} calls this month (alerting at ${args.alertThreshold}). ` +
    `At the cap, ${args.stops} Review if this volume looks abusive.`;
  await sendEmail(env, {
    to: [env.OPS_ALERT_EMAIL ?? "support@loonext.com"],
    subject: `AI ${args.label} nearing monthly cap — company ${args.companyId}`,
    text,
    html: renderEmailHtml(text),
  });
}
