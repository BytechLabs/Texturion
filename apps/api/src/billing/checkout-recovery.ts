import { LEGAL_ENTITY_NAME, MAILING_ADDRESS, SUPPORT_EMAIL } from "@loonext/shared";

import { getDb } from "../db";
import { escapeHtml } from "../email/html";
import { sendEmail } from "../email/resend";
import type { Env } from "../env";
import { oneClickUnsubscribeUrl, unsubscribeUrl } from "../marketing/comparison-email";
import type { Stripe } from "./stripe";

export async function remindAbandonedCheckout(
  env: Env,
  session: Stripe.Checkout.Session,
): Promise<void> {
  const companyId = session.client_reference_id;
  const recovery = session.after_expiration?.recovery;
  if (
    session.mode !== "subscription" ||
    session.status !== "expired" ||
    session.recovered_from ||
    !companyId ||
    !recovery?.url ||
    !recovery.expires_at ||
    recovery.expires_at * 1000 <= Date.now()
  ) return;

  const senderAddress = MAILING_ADDRESS?.trim();
  if (!senderAddress) {
    console.info({
      event: "checkout_recovery_skipped",
      reason: "missing_sender_postal_address",
    });
    return;
  }
  const senderName = LEGAL_ENTITY_NAME?.trim() || "Loonext";
  let link: URL;
  try {
    link = new URL(recovery.url);
  } catch {
    return;
  }
  if (link.origin !== "https://checkout.stripe.com" && link.origin !== "https://buy.stripe.com") {
    return;
  }

  const db = getDb(env);
  const { data: company, error: companyError } = await db
    .from("companies")
    .select("owner_user_id,locale")
    .eq("id", companyId)
    .eq("subscription_status", "incomplete")
    .is("deleted_at", null)
    .is("checkout_reminder_sent_at", null)
    .maybeSingle();
  if (companyError) throw new Error("Could not read the workspace for checkout recovery.");
  if (!company?.owner_user_id) return;

  const { data: owner, error: ownerError } = await db.auth.admin.getUserById(company.owner_user_id);
  if (ownerError) throw new Error("Could not read the checkout recovery recipient.");
  const email = owner.user?.email?.trim().toLowerCase();
  if (!email || !owner.user?.email_confirmed_at) return;

  const { data: contact, error: contactError } = await db
    .from("marketing_contacts")
    .select("unsubscribe_token")
    .eq("email", email)
    .is("unsubscribed_at", null)
    .maybeSingle();
  if (contactError) throw new Error("Could not read checkout recovery consent.");
  if (!contact?.unsubscribe_token) return;

  const claimedAt = new Date().toISOString();
  const { data: claim, error: claimError } = await db
    .from("companies")
    .update({ checkout_reminder_sent_at: claimedAt })
    .eq("id", companyId)
    .eq("owner_user_id", company.owner_user_id)
    .eq("subscription_status", "incomplete")
    .is("deleted_at", null)
    .is("checkout_reminder_sent_at", null)
    .select("id");
  if (claimError) throw new Error("Could not claim the checkout recovery reminder.");
  if (!claim?.length) return;

  const locale = company.locale === "fr-CA" ? "fr-CA" : "en";
  const french = locale === "fr-CA";
  const subject = french ? "Terminez votre inscription à Loonext" : "Finish setting up Loonext";
  const intro = french
    ? "Votre session de paiement a expiré. Vous pouvez reprendre votre inscription à partir d'une nouvelle session."
    : "Your checkout session expired. You can continue setting up Loonext in a new checkout session.";
  const action = french ? "Reprendre le paiement" : "Continue to checkout";
  const unsubscribeLabel = french ? "Se désabonner" : "Unsubscribe";
  const unsubscribe = unsubscribeUrl(env, contact.unsubscribe_token, locale);
  const oneClick = oneClickUnsubscribeUrl(env, contact.unsubscribe_token);
  const sender = `${senderName}\n${senderAddress}\n${SUPPORT_EMAIL}`;

  const emailResult = await sendEmail(env, {
    to: email,
    subject,
    text: `${intro}\n\n${action}\n${link.href}\n\n${sender}\n\n${unsubscribeLabel}\n${unsubscribe}`,
    html: `<p>${escapeHtml(intro)}</p>` +
      `<p><a href="${escapeHtml(link.href)}">${escapeHtml(action)}</a></p>` +
      `<p>${escapeHtml(sender).replaceAll("\n", "<br>")}</p>` +
      `<p><a href="${escapeHtml(unsubscribe)}">${escapeHtml(unsubscribeLabel)}</a></p>`,
    kind: "commercial",
    idempotencyKey: `checkout-recovery:${companyId}:${session.id}`,
    headers: {
      "List-Unsubscribe": `<${oneClick}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  }).catch(() => null);
  if (emailResult?.id) return;

  const { error } = await db
    .from("companies")
    .update({ checkout_reminder_sent_at: null })
    .eq("id", companyId)
    .eq("checkout_reminder_sent_at", claimedAt);
  if (error) throw new Error("Could not release the checkout recovery claim.");
  if (!emailResult) throw new Error("Could not send the checkout recovery reminder.");
}
