import type { Locale } from "@loonext/shared";
import type { SupabaseClient } from "@supabase/supabase-js";

import { renderEmailHtml } from "../email/html";
import { sendEmail } from "../email/resend";
import type { Env } from "../env";

interface LedgerSend {
  claim: () => Promise<boolean>;
  release: () => Promise<void>;
  send: () => Promise<boolean>;
  alreadyClaimed?: boolean;
}

export function emailLedger(db: SupabaseClient, companyId: string, emailKey: string) {
  return {
    claim: async () => {
      const { data, error } = await db
        .from("email_ledger")
        .upsert(
          { company_id: companyId, email_key: emailKey },
          { onConflict: "company_id,email_key", ignoreDuplicates: true },
        )
        .select("email_key");
      if (error) throw new Error(`email_ledger insert failed: ${error.message}`);
      return (data?.length ?? 0) > 0;
    },
    release: async () => {
      const { error } = await db.from("email_ledger").delete()
        .eq("company_id", companyId)
        .eq("email_key", emailKey);
      if (error) throw new Error(`email_ledger release failed: ${error.message}`);
    },
  };
}

export function usageAlertLedger(
  db: SupabaseClient,
  key: { company_id: string; period_start: string; metric: string; threshold: number },
) {
  return {
    claim: async () => {
      const { data, error } = await db
        .from("usage_alerts")
        .upsert({
          company_id: key.company_id,
          period_start: key.period_start,
          metric: key.metric,
          threshold: key.threshold,
        }, {
          onConflict: "company_id,period_start,metric,threshold",
          ignoreDuplicates: true,
        })
        .select("company_id");
      if (error) throw new Error(`usage_alerts insert failed: ${error.message}`);
      return (data?.length ?? 0) > 0;
    },
    release: async () => {
      const { error } = await db.from("usage_alerts").delete()
        .eq("company_id", key.company_id)
        .eq("period_start", key.period_start)
        .eq("metric", key.metric)
        .eq("threshold", key.threshold);
      if (error) throw new Error(`usage_alerts release failed: ${error.message}`);
    },
  };
}

export async function sendLedgered({ claim, release, send, alreadyClaimed = false }: LedgerSend): Promise<boolean> {
  if (!(await claim())) return alreadyClaimed;

  let sent: boolean;
  try {
    sent = await send();
  } catch (error) {
    try {
      await release();
    } catch (releaseError) {
      throw new AggregateError([error, releaseError], "Notice failed and the ledger could not be released", {
        cause: releaseError,
      });
    }
    throw error;
  }
  if (!sent) await release();
  return sent;
}

export async function sendBillingEmailGroups(
  env: Env,
  db: SupabaseClient,
  companyId: string,
  noticeKey: string,
  groups: Map<Locale, string[]>,
  copy: (locale: Locale) => { subject: string; text: string },
  { critical }: { critical: boolean },
): Promise<boolean> {
  const outcomes = await Promise.allSettled(Array.from(groups, ([locale, to]) => {
    const key = `${noticeKey}:${locale}`;
    return sendLedgered({
      ...emailLedger(db, companyId, key),
      alreadyClaimed: true,
      send: async () => {
        const { subject, text } = copy(locale);
        const { id } = await sendEmail(env, {
          to,
          subject,
          text,
          html: renderEmailHtml(text, locale),
          locale,
          critical,
          idempotencyKey: `${companyId}:${key}`,
        });
        return id !== null;
      },
    });
  }));
  const failures = outcomes.flatMap((outcome) => outcome.status === "rejected" ? [outcome.reason] : []);
  if (failures.length > 0) throw new AggregateError(failures, "Billing email could not be sent");
  return outcomes.some((outcome) => outcome.status === "fulfilled" && outcome.value);
}
