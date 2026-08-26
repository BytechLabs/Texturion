/**
 * #312 — the one email a captured prospect asked for, and the rules a commercial
 * message has to follow that a transactional one does not.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS DOES NOT USE `emailLayout`.
 *
 * `email/html.ts` states its own contract: the shared layout is for TRANSACTIONAL
 * messages and carries "no marketing chrome and no unsubscribe (not required)".
 * That is correct for the ~40 sends that use it and wrong for this one. A
 * commercial message needs three things the shared layout deliberately omits:
 *
 *   1. An unsubscribe link, one click, no confirmation step.
 *   2. Sender identification.
 *   3. A postal mailing address.
 *
 * So this builds its own body rather than bending a layout whose comment promises
 * the opposite.
 *
 * ---------------------------------------------------------------------------
 * WHY IT FAILS CLOSED, WHERE THE TRANSPORT FAILS OPEN.
 *
 * `sendEmail`'s suppression lookup sends anyway if the database is unreachable,
 * and the reasoning is sound for transactional mail: "a database blip must not be
 * the reason a customer never learns their payment failed."
 *
 * That reasoning inverts here. Mailing somebody who unsubscribed costs a
 * compliance breach and their trust; not mailing them costs a comparison table
 * they can read on the website anyway. So the marketing gate is checked BEFORE
 * the transport and refuses on any uncertainty.
 *
 * ---------------------------------------------------------------------------
 * WHERE THE POSTAL ADDRESS COMES FROM.
 *
 * A commercial email has to carry a real mailing address, and none exists in this
 * repository yet: `MAILING_ADDRESS` in `packages/shared` is an explicit null
 * awaiting ops, alongside the legal entity name, with every identity surface
 * already written to render honestly without it.
 *
 * This module reads that same constant rather than a Worker env var of its own.
 * Holding the fact twice would let the two disagree — set one and the legal pages
 * show an address while this refuses to send; set the other and the email carries
 * an address the pages say we do not have. Both are silent inconsistencies on a
 * compliance-adjacent surface.
 *
 * Until ops fills it in, this refuses to send and says so. The capture, the
 * consent record and the unsubscribe all work regardless: what is missing is a
 * fact about the business, and inventing one would put a false statement in a
 * compliance footer, where a missing one is just a feature switched off.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { MAILING_ADDRESS } from "@loonext/shared";

import { sendEmail } from "../email/resend";
import { escapeHtml } from "../email/html";
import type { Env } from "../env";

/** Where a consent was given. Stored on the row so a complaint is traceable. */
export type MarketingConsentSource = "compare_page" | "pricing_page";

/** The language shown at consent time and used for the requested email. */
export type MarketingConsentLocale = "en" | "fr-CA";

/**
 * The exact words a person agrees to, snapshotted onto their consent row.
 *
 * Exported so the web form and the stored record cannot drift: the copy the
 * visitor reads IS this string. If it changes, new consents record the new
 * wording and old ones keep the words that were actually shown.
 */
export const MARKETING_CONSENT_TEXT =
  "Email me this comparison. I understand Loonext may email me about the " +
  "product, and I can unsubscribe from any message.";

/** Server-owned wording shown by the French comparison route. */
export const MARKETING_CONSENT_TEXT_FR =
  "Envoyez-moi cette comparaison. Je comprends que Loonext peut m'écrire au " +
  "sujet du produit et que je peux me désabonner de chaque message.";

/** The request selects a language, never arbitrary consent prose. */
export function marketingConsentText(locale: MarketingConsentLocale): string {
  return locale === "fr-CA"
    ? MARKETING_CONSENT_TEXT_FR
    : MARKETING_CONSENT_TEXT;
}

/**
 * Global daily ceiling on captures.
 *
 * 50/day is far above the traffic a page like this produces and caps the
 * worst-case Resend spend of a distributed bot run — the same cost-protection
 * reasoning as the contact form's cap of 20, with a higher number because this
 * one does not also page a human.
 */
export const MARKETING_DAILY_CAP = 50;

/** Why a send did not happen. Every one of these is a normal outcome. */
export type MarketingSendRefusal =
  | "not_configured"
  | "unsubscribed"
  | "unknown_contact"
  | "lookup_failed";

export interface MarketingSendResult {
  sent: boolean;
  refusal?: MarketingSendRefusal;
}

/** Human-facing unsubscribe page, localized to the requested email. */
export function unsubscribeUrl(
  env: Env,
  token: string,
  locale: MarketingConsentLocale = "en",
): string {
  const path = locale === "fr-CA" ? "/fr/desabonnement" : "/unsubscribe";
  const origin = env.SITE_ORIGIN ?? env.APP_ORIGIN;
  return `${origin}${path}?token=${encodeURIComponent(token)}`;
}

/** RFC 8058 endpoint for a mail client's direct POST, never a browser page. */
export function oneClickUnsubscribeUrl(env: Env, token: string): string {
  return `${env.API_ORIGIN}/marketing/unsubscribe?token=${encodeURIComponent(token)}`;
}

/**
 * Send the comparison to a captured prospect, or refuse and say why.
 *
 * Re-reads the contact row rather than trusting the caller's word that they are
 * subscribed: the claim and the send are two statements, and an unsubscribe can
 * land between them. Cheap, and it means this function is safe to call from
 * anywhere later.
 */
export async function sendComparisonEmail(
  env: Env,
  db: SupabaseClient,
  email: string,
): Promise<MarketingSendResult> {
  const address = MAILING_ADDRESS?.trim();
  if (!address) {
    // Not an error. The feature is configured off, and the caller reports that
    // honestly rather than promising an email nobody will receive.
    return { sent: false, refusal: "not_configured" };
  }

  const normalized = email.trim().toLowerCase();
  const { data, error } = await db
    .from("marketing_contacts")
    .select("email,unsubscribe_token,unsubscribed_at,consent_locale")
    .eq("email", normalized)
    .limit(1);

  // FAIL CLOSED. See the header: the transport fails open on purpose and this
  // must not.
  if (error) return { sent: false, refusal: "lookup_failed" };

  const row = (data ?? [])[0] as
    | {
        email: string;
        unsubscribe_token: string;
        unsubscribed_at: string | null;
        consent_locale: MarketingConsentLocale;
      }
    | undefined;
  if (!row) return { sent: false, refusal: "unknown_contact" };
  if (row.unsubscribed_at !== null) return { sent: false, refusal: "unsubscribed" };

  const unsubscribe = unsubscribeUrl(env, row.unsubscribe_token, row.consent_locale);
  const oneClickUnsubscribe = oneClickUnsubscribeUrl(env, row.unsubscribe_token);
  const { subject, text, html } = comparisonEmailCopy(
    unsubscribe,
    address,
    row.consent_locale,
  );

  await sendEmail(env, {
    to: row.email,
    subject,
    text,
    html,
    // #252: the one commercial send. It carries its own CAN-SPAM block below,
    // and the recipient is a prospect with no Loonext account, so the shared
    // "service message about your Loonext account" footer would both misdescribe
    // this email and sit underneath its unsubscribe line.
    kind: "commercial",
    headers: {
      // RFC 8058 one-click goes to the API, not the localized browser GET page
      // linked in the body. A mail client POSTs the marker below directly; a
      // page-only URL would answer 405 and merely LOOK like one-click worked.
      "List-Unsubscribe": `<${oneClickUnsubscribe}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  });

  // Stamps the row so retention can tell a live contact from a capture nobody
  // ever acted on. Best-effort: the message has already gone, and failing here
  // would report a send that happened as a send that did not.
  await db
    .from("marketing_contacts")
    .update({ last_sent_at: new Date().toISOString() })
    .eq("email", row.email);

  return { sent: true };
}

/**
 * The message body.
 *
 * Deliberately thin on claims. Everything factual it says is already on the
 * public comparison page, and #403's dating machinery is what makes those numbers
 * quotable — so this points at the page rather than restating figures that would
 * then need their own staleness guard.
 */
export function comparisonEmailCopy(
  unsubscribe: string,
  postalAddress: string,
  locale: MarketingConsentLocale = "en",
): { subject: string; text: string; html: string } {
  if (locale === "fr-CA") {
    return frenchComparisonEmailCopy(unsubscribe, postalAddress);
  }

  const compareUrl = "https://loonext.com/compare";
  const subject = "The comparison you asked for";

  const text = [
    "Here is the comparison you asked for:",
    "",
    compareUrl,
    "",
    "Every number on that page is dated and sourced, so you can check when we",
    "last verified it. If a competitor has changed their pricing since, the page",
    "says so rather than quietly going stale.",
    "",
    "Nothing else is needed from you. If you have a question, just reply to this",
    "email and a person will answer.",
    "",
    "---",
    "Loonext",
    postalAddress,
    "",
    `Unsubscribe: ${unsubscribe}`,
  ].join("\n");

  const html = [
    '<div style="font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;',
    'font-size:15px;line-height:1.55;color:#1b1d1a;max-width:560px">',
    "<p>Here is the comparison you asked for:</p>",
    `<p><a href="${escapeHtml(compareUrl)}">${escapeHtml(compareUrl)}</a></p>`,
    "<p>Every number on that page is dated and sourced, so you can check when we ",
    "last verified it. If a competitor has changed their pricing since, the page ",
    "says so rather than quietly going stale.</p>",
    "<p>Nothing else is needed from you. If you have a question, just reply to ",
    "this email and a person will answer.</p>",
    '<hr style="border:none;border-top:1px solid #e3e2dd;margin:24px 0">',
    '<p style="font-size:12.5px;color:#6b6f68">',
    "Loonext<br>",
    `${escapeHtml(postalAddress)}<br><br>`,
    `<a href="${escapeHtml(unsubscribe)}">Unsubscribe</a>`,
    "</p></div>",
  ].join("");

  return { subject, text, html };
}

/** French commercial copy stays beside English so their compliance block matches. */
function frenchComparisonEmailCopy(
  unsubscribe: string,
  postalAddress: string,
): { subject: string; text: string; html: string } {
  const compareUrl = "https://loonext.com/fr/comparer";
  const subject = "La comparaison que vous avez demandée";

  const text = [
    "Voici la comparaison que vous avez demandée :",
    "",
    compareUrl,
    "",
    "Chaque chiffre de cette page est daté et accompagné de sa source. Vous",
    "pouvez donc voir quand nous l'avons vérifié pour la dernière fois. Si un",
    "concurrent a modifié ses tarifs depuis, la page le dit plutôt que de",
    "laisser l'information devenir périmée en silence.",
    "",
    "Vous n'avez rien d'autre à faire. Si vous avez une question, répondez",
    "simplement à ce courriel et une personne vous répondra.",
    "",
    "---",
    "Loonext",
    postalAddress,
    "",
    `Se désabonner : ${unsubscribe}`,
  ].join("\n");

  const html = [
    '<div style="font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;',
    'font-size:15px;line-height:1.55;color:#1b1d1a;max-width:560px">',
    "<p>Voici la comparaison que vous avez demandée :</p>",
    `<p><a href="${escapeHtml(compareUrl)}">${escapeHtml(compareUrl)}</a></p>`,
    "<p>Chaque chiffre de cette page est daté et accompagné de sa source. ",
    "Vous pouvez donc voir quand nous l'avons vérifié pour la dernière fois. ",
    "Si un concurrent a modifié ses tarifs depuis, la page le dit plutôt que de ",
    "laisser l'information devenir périmée en silence.</p>",
    "<p>Vous n'avez rien d'autre à faire. Si vous avez une question, répondez ",
    "simplement à ce courriel et une personne vous répondra.</p>",
    '<hr style="border:none;border-top:1px solid #e3e2dd;margin:24px 0">',
    '<p style="font-size:12.5px;color:#6b6f68">',
    "Loonext<br>",
    `${escapeHtml(postalAddress)}<br><br>`,
    `<a href="${escapeHtml(unsubscribe)}">Se désabonner</a>`,
    "</p></div>",
  ].join("");

  return { subject, text, html };
}
