import { resolveLocale } from "@loonext/shared";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getDb } from "../db";
import { renderEmailHtml } from "../email/html";
import { sendEmail } from "../email/resend";
import type { Env } from "../env";

type PendingDisableNotice = { audit_id: string; company_id: string };

const DISABLE_EMAIL_COPY = {
  en: {
    subject: "Loonext paused one of your webhooks",
    body: "One of your webhooks repeatedly failed and had no successful deliveries for six hours. Check your receiver and turn the webhook back on in Settings when it is ready.",
  },
  "fr-CA": {
    subject: "Loonext a mis en pause l’un de vos webhooks",
    body: "L’un de vos webhooks a échoué à plusieurs reprises. Aucune livraison n’a réussi depuis six heures. Vérifiez votre système de réception, puis réactivez le webhook dans les paramètres lorsqu’il est prêt.",
  },
} as const;

async function sendDisableNotice(
  db: SupabaseClient,
  env: Env,
  notice: PendingDisableNotice,
): Promise<void> {
  const { data: company, error: companyError } = await db
    .from("companies")
    .select("owner_user_id,locale")
    .eq("id", notice.company_id)
    .is("deleted_at", null)
    .maybeSingle();
  if (companyError) throw new Error(`webhook notice workspace lookup failed: ${companyError.code}`);
  if (company) {
    const { data, error } = await db.auth.admin.getUserById(company.owner_user_id);
    if (error) throw new Error(`webhook notice owner lookup failed: ${error.code}`);
    const to = data.user?.email;
    if (to) {
      const locale = resolveLocale(null, company.locale);
      const { subject, body } = DISABLE_EMAIL_COPY[locale];
      const text = `${body}\n\n${env.APP_ORIGIN}/settings/webhooks`;
      try {
        await sendEmail(env, {
          to,
          subject,
          text,
          html: renderEmailHtml(text, locale),
          locale,
          idempotencyKey: `webhook-disabled:${notice.audit_id}`,
        });
      } catch {
        throw new Error(`could not send webhook disable email for audit ${notice.audit_id}`);
      }
    }
  }

  const { error } = await db.from("webhook_disable_emails").delete()
    .eq("company_id", notice.company_id).eq("audit_id", notice.audit_id);
  if (error) throw new Error(`webhook notice completion failed: ${error.code}`);
}

export async function runWebhookDisableEmails(
  env: Env,
  now: Date = new Date(),
  db: SupabaseClient = getDb(env),
): Promise<number> {
  const { data, error } = await db.rpc("api_claim_webhook_disable_emails");
  if (error) throw new Error(`webhook notice claim failed: ${error.code}`);

  const failures: unknown[] = [];
  const notices = (data ?? []) as PendingDisableNotice[];
  for (const notice of notices) {
    try {
      await sendDisableNotice(db, env, notice);
    } catch (error_) {
      failures.push(error_);
    }
  }

  // Retrying outside Resend's idempotency window could send a second email.
  const cutoff = new Date(now.getTime() - 23 * 60 * 60 * 1000).toISOString();
  const expired = await db.from("webhook_disable_emails").delete({ count: "exact" }).lte("created_at", cutoff);
  if (expired.error) failures.push(new Error(`webhook notice expiration failed: ${expired.error.code}`));
  if (expired.count) failures.push(new Error(`${expired.count} webhook disable email(s) expired`));
  if (failures.length > 0) throw new AggregateError(failures, "webhook disable email job failed");
  return notices.length;
}
