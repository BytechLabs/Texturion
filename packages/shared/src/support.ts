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

/**
 * #253 acceptance 4 — the response time, stated once and everywhere.
 *
 * "A support channel a solo founder cannot service is worse than none — an
 * unanswered form is a promise broken in writing." So this is the commitment
 * that survives a bad week, not the one that reads best: two business days is
 * reachable while flying to a customer site or asleep in a different timezone.
 * The good weeks beat it, and beating a stated commitment costs nothing.
 *
 * One constant, and every surface renders THIS. A number typed into three
 * clients separately is a number that drifts, and the drifted one is a promise
 * somebody made without knowing they were making it.
 */
export const SUPPORT_RESPONSE_TIME = "within two business days, usually sooner";

/**
 * #321 acceptance 4 — the loop, stated out loud.
 *
 * "When a reported issue ships, tell the person who reported it. That is the
 * single cheapest loyalty moment available to a small company, and we discard
 * it every time." The mechanism is not a ticket system — #253 chose a mailto
 * precisely so no queue, vendor or SLA exists — it is a reply on the same email
 * thread, made reliable rather than heroic by two things: `supportSubjectFor`
 * gives every reporter of one failure the identical subject line, so a single
 * inbox search finds all of them, and docs/RELEASING.md makes the reply a step
 * of every release rather than something remembered.
 *
 * Stated in the product because a promise nobody knows about changes nobody's
 * behaviour: the reason to bother writing in is knowing you will hear back.
 * Which makes the release step load-bearing — this sentence is a lie the first
 * time it is skipped.
 */
export const SUPPORT_FIX_PROMISE =
  "If you tell us something's broken, we write back when it's fixed, not just when we've read it.";

/**
 * How many recent client errors travel with a report.
 *
 * Six because a mailto body has real length limits in some mail clients (the
 * shortest documented ceiling is around 2000 characters), and a truncated body
 * is a support request with NO diagnostics rather than fewer. Six lines of the
 * newest failures is what a person actually needed anyway — the one that made
 * them write in is always at the top.
 */
export const SUPPORT_ERROR_LINES = 6;

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
  /**
   * #253: what the person was looking at when they hit Report.
   *
   * A sentence, not a code. The reader of the email is a human triaging on a
   * phone, and "US registration is pending approval" is immediately actionable
   * in a way `registration_pending` is not — while still being stable enough to
   * search the inbox for.
   */
  situation?: string | null;
  /**
   * #253: recent client errors, newest first, already scrubbed by the caller.
   *
   * The acceptance criterion is that a report carries these "without the user
   * assembling them". Capped at SUPPORT_ERROR_LINES — see the constant for why
   * more would be fewer.
   */
  recentErrors?: readonly string[];
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
  // The situation goes ABOVE the error list: it is the one line that says what
  // the person was trying to do, and it is true even when nothing errored.
  if (ctx.situation) lines.push(`Screen: ${ctx.situation}`);
  const errors = (ctx.recentErrors ?? []).filter((line) => line.trim() !== "");
  if (errors.length > 0) {
    lines.push("Recent errors on this device (newest first):");
    for (const line of errors.slice(0, SUPPORT_ERROR_LINES)) {
      lines.push(`  ${line}`);
    }
  }
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

/**
 * #253 — the feedback channel that is NOT a bug report.
 *
 * "Feature requests from a working contractor are the highest-signal product
 * input available to us, and there is currently no way for one to arrive." The
 * separation is the whole feature: somebody with an idea does not write to an
 * address labelled support, because they correctly read that as being for
 * things that are broken, and their idea is not a complaint.
 *
 * Same inbox, different subject. A second address would be a second thing to
 * monitor, and [[observability-state]] is already the lesson about channels
 * nobody watches.
 */
export function feedbackMailto(ctx: SupportContext): string {
  return supportMailto({ ...ctx, subject: "Idea for Loonext" });
}

/**
 * #253 — what a failure banner should put in the subject line.
 *
 * Keyed on the banner kind so the three clients cannot describe the same
 * failure three ways. A subject that varies by platform makes the support inbox
 * unsearchable exactly when a pattern matters most: five reports of the same
 * carrier suspension in one morning is a signal, and it is invisible if they
 * arrive under five different names.
 */
const SITUATIONS: Record<string, string> = {
  registration_pending: "US registration is pending approval",
  registration_suspended: "the carrier suspended our US registration",
  us_texting_off: "US texting is off for this workspace",
  usage_cap: "sending is paused at the spending cap",
  subscription: "the subscription is not active",
  opted_out: "this customer is opted out",
  opt_out_hint: "an opt-out was detected in the thread",
  number_access: "I do not have texting access to this number",
  read_only: "I have view-only access",
};

/**
 * The human sentence for a banner kind, or null for one we do not know.
 *
 * Null rather than a guessed fallback: an invented sentence in a support email
 * is worse than none, because the reader trusts it and it came from nowhere.
 */
export function supportSituation(kind: string): string | null {
  return SITUATIONS[kind] ?? null;
}

/** The subject a report from a failure banner carries. */
export function supportSubjectFor(kind: string): string {
  const situation = supportSituation(kind);
  return situation === null
    ? "Help with my Loonext workspace"
    : `Problem: ${situation}`;
}

/**
 * #253 — the questions that generate the most confusion, answered inside.
 *
 * All four already have honest answers somewhere: in a banner somebody has to
 * hit, or on a legal page somebody has to leave the app to find. Neither is
 * findable by a person who has the question and is not currently staring at the
 * failure. That is the whole gap — the answers exist, the index does not.
 *
 * Deliberately not a help centre. Four questions that actually get asked, in
 * the product's own voice, kept in the repo so they cannot drift from the
 * banner copy the way a hosted article would.
 */
export interface SupportTopic {
  question: string;
  answer: string;
}

export const SUPPORT_TOPICS: readonly SupportTopic[] = [
  {
    question: "Why won't my text to a US number send?",
    answer:
      "US carriers require every business number to be registered before it can text US phones. " +
      "Approval usually takes 3 to 7 business days, and there is nothing to do while it runs. " +
      "Calls to US numbers work the whole time, and Canadian texts are unaffected.",
  },
  {
    question: "What does “registration pending” actually mean?",
    answer:
      "We have submitted your business to the carriers and they have not answered yet. " +
      "It is a queue, not a review of anything you did. You will get an email the moment it clears.",
  },
  {
    question: "Why did my number stop sending after it was working?",
    answer:
      "Two things do that. A carrier can suspend an approved registration, which we are told about and act on " +
      "without you doing anything. Or your workspace has hit the spending cap the owner set, which is " +
      "protection rather than a quota and an owner can raise it in Settings.",
  },
  {
    question: "A customer says they never got my text. What now?",
    answer:
      "Check whether they ever texted STOP: a carrier opt-out blocks us and only the customer can lift it, " +
      "by texting START. If that is not it, email us the customer's number and roughly when you sent it, " +
      "and we can trace the message with the carrier.",
  },
  {
    question: "How long does moving my existing number take?",
    answer:
      "Porting takes 7 to 10 business days once the carrier accepts the request, and your old number keeps " +
      "working the entire time. Nothing goes dark at any point.",
  },
];
