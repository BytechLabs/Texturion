/**
 * #382 — the route to a human, from inside the product.
 *
 * A signed-in paying customer had none. Settings had fourteen sections and not
 * one of them was help, and `SUPPORT_EMAIL` appeared only under the MARKETING
 * contact pages — the form built for strangers. A plumber whose texts stopped
 * arriving had to sign out, find the website and fill in a form, standing in
 * somebody's basement. They will not. They will churn, and we will record it as
 * churn rather than as the delivery bug it was.
 *
 * DELIBERATELY A MAILTO. Not chat, not a ticket queue. A solo founder cannot
 * staff a support desk, and a widget that implies one is a promise we would
 * break. A mailto creates no SLA, no queue and no vendor — and the objection it
 * answers is the real one: today we are not avoiding support load, we are
 * avoiding HEARING about it while still paying for it in churn.
 *
 * THE PRE-FILL IS THE POINT. "My texts aren't working" costs a round trip
 * before anyone can act on it. The same message carrying the workspace id,
 * plan and platform is something that can be looked up immediately. That is
 * smart defaults applied to a support request — the customer should not have to
 * know what we need in order to be helped.
 */

/** Where support mail goes. Mirrors the marketing constant. */
export const SUPPORT_EMAIL = "support@loonext.com";

export interface SupportContext {
  /** Which workspace — the single most useful field for looking anything up. */
  companyId: string;
  companyName?: string | null;
  /** Plan, so a billing question does not need a second message. */
  plan?: string | null;
  /** "web" | "android" | "ios" — where the person actually is. */
  platform: string;
  /** Client build, so a fixed-and-shipped bug is recognisable as one. */
  appVersion?: string | null;
  /** Optional subject seed for a screen-specific entry point. */
  subject?: string;
}

/**
 * The body we pre-fill. Ends with a blank line and a prompt, so the customer's
 * own words go at the TOP — nobody should have to scroll past our diagnostics
 * to write the sentence they came to write.
 */
export function supportBody(ctx: SupportContext): string {
  const lines = [
    "",
    "",
    "---",
    "The details below help us look this up. Please leave them in.",
    `Workspace: ${ctx.companyName ?? "(unnamed)"} (${ctx.companyId})`,
  ];
  if (ctx.plan) lines.push(`Plan: ${ctx.plan}`);
  lines.push(`App: ${ctx.platform}${ctx.appVersion ? ` ${ctx.appVersion}` : ""}`);
  return lines.join("\n");
}

/**
 * A `mailto:` carrying the diagnostic payload.
 *
 * Encoded with `encodeURIComponent` rather than a URL builder because mail
 * clients differ on how forgiving they are, and a subject with an apostrophe in
 * the workspace name should not truncate the body.
 */
export function supportMailto(ctx: SupportContext): string {
  const subject = ctx.subject ?? "Help with my Loonext workspace";
  return (
    `mailto:${SUPPORT_EMAIL}` +
    `?subject=${encodeURIComponent(subject)}` +
    `&body=${encodeURIComponent(supportBody(ctx))}`
  );
}
