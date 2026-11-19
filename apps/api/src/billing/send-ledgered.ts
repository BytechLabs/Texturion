import type { SupabaseClient } from "@supabase/supabase-js";

interface LedgerSend {
  claim: () => Promise<boolean>;
  release: () => Promise<void>;
  send: () => Promise<boolean>;
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

export async function sendLedgered({ claim, release, send }: LedgerSend): Promise<boolean> {
  if (!(await claim())) return false;

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
