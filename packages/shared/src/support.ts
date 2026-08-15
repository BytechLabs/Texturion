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
 * Resolves a catalogue key to a sentence.
 *
 * #228: this module composes text out of keys and does not own a catalogue, so
 * the caller supplies the lookup. Each client passes its own — `t` on web,
 * `AppStrings.translate` on the phones — and the same function is handed an
 * ENGLISH resolver where the words must not vary by reader. See
 * [supportSubjectFor] for the one place that matters.
 */
export type SayKey = (key: string) => string;

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
export const SUPPORT_RESPONSE_TIME_KEY = "settings.helpResponseTime";

/**
 * The same promise in English, for the one caller that cannot take a resolver
 * yet.
 *
 * `cancellation-offers.ts` builds a sentence around this, and that module is
 * still composing English for all three clients — its own conversion is the
 * next one. Until then it reads THIS rather than typing the words again,
 * because the whole reason this constant exists is that a response time typed
 * out twice is a promise somebody made without knowing they were making it.
 *
 * Goes away with that conversion. It is the English half of
 * [SUPPORT_RESPONSE_TIME_KEY] and must stay identical to the `en` entry the
 * three catalogues hold — `support.test.ts` asserts that.
 *
 * @internal
 */
export const SUPPORT_RESPONSE_TIME_EN = "within two business days, usually sooner";

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
export const SUPPORT_FIX_PROMISE_KEY = "settings.helpFixPromise";

/**
 * The English half of [SUPPORT_FIX_PROMISE_KEY], for the same one caller and
 * the same reason as [SUPPORT_RESPONSE_TIME_EN]. Goes away with it.
 *
 * @internal
 */
export const SUPPORT_FIX_PROMISE_EN =
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
 *
 * #228: [say] resolves a catalogue key in THE CUSTOMER'S language, because they
 * read this in their mail client before they send it. The subject does the
 * opposite — see [supportSubjectFor].
 *
 * The field labels stay English on purpose. `Workspace:` and `App:` are how
 * the inbox is read, not sentences addressed to anybody, and a diagnostics
 * block that changes shape by locale is one nobody can grep.
 */
export function supportBody(ctx: SupportContext, say: SayKey): string {
  const lines = [
    "",
    "",
    "---",
    say("settings.supportBodyLeadIn"),
    `Workspace: ${ctx.companyName ?? "(unnamed)"} (${ctx.companyId})`,
  ];
  if (ctx.plan) lines.push(`Plan: ${ctx.plan}`);
  lines.push(`App: ${ctx.platform}${ctx.appVersion ? ` ${ctx.appVersion}` : ""}`);
  // The situation goes ABOVE the error list: it is the one line that says what
  // the person was trying to do, and it is true even when nothing errored.
  if (ctx.situation) lines.push(`Screen: ${ctx.situation}`);
  const errors = (ctx.recentErrors ?? []).filter((line) => line.trim() !== "");
  if (errors.length > 0) {
    lines.push(say("settings.supportBodyErrors"));
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
export function supportMailto(ctx: SupportContext, say: SayKey, sayEnglish: SayKey): string {
  const subject = ctx.subject ?? sayEnglish("settings.supportSubjectDefault");
  return (
    `mailto:${SUPPORT_EMAIL}` +
    `?subject=${encodeURIComponent(subject)}` +
    `&body=${encodeURIComponent(supportBody(ctx, say))}`
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
export function feedbackMailto(ctx: SupportContext, say: SayKey, sayEnglish: SayKey): string {
  return supportMailto(
    { ...ctx, subject: sayEnglish("settings.supportSubjectIdea") },
    say,
    sayEnglish,
  );
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
const SITUATION_KEYS: Record<string, string> = {
  registration_pending: "settings.supportSituationRegistrationPending",
  registration_suspended: "settings.supportSituationRegistrationSuspended",
  us_texting_off: "settings.supportSituationUsTextingOff",
  usage_cap: "settings.supportSituationUsageCap",
  subscription: "settings.supportSituationSubscription",
  opted_out: "settings.supportSituationOptedOut",
  opt_out_hint: "settings.supportSituationOptOutHint",
  number_access: "settings.supportSituationNumberAccess",
  read_only: "settings.supportSituationReadOnly",
};

/**
 * The human sentence for a banner kind, or null for one we do not know.
 *
 * Null rather than a guessed fallback: an invented sentence in a support email
 * is worse than none, because the reader trusts it and it came from nowhere.
 */
export function supportSituationKey(kind: string): string | null {
  return SITUATION_KEYS[kind] ?? null;
}

/**
 * The subject a report from a failure banner carries — IN ENGLISH, always.
 *
 * #228: the two readers of this key want different languages and both are
 * right. The body renders it for the person, in whatever they read; the subject
 * renders it against the English table on purpose. A subject line is the
 * inbox's index, and one carrier suspension reported from Montreal and from
 * Calgary has to arrive under one heading — or the pattern that matters most,
 * five reports of one failure in a morning, is the one that stops being
 * visible.
 *
 * So [sayEnglish] must resolve against the English catalogue whatever the
 * reader's own language is. It is a separate parameter from [supportBody]'s
 * `say` for exactly that reason.
 */
export function supportSubjectFor(kind: string, sayEnglish: SayKey): string {
  const key = supportSituationKey(kind);
  return key === null
    ? sayEnglish("settings.supportSubjectDefault")
    : `Problem: ${sayEnglish(key)}`;
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
  questionKey: string;
  answerKey: string;
}

/**
 * #228: pairs of KEYS, in the order they are read.
 *
 * The order is the content. These are not sorted or ranked — they run from the
 * question most people arrive with to the one fewest do, and a client that
 * reordered them would be answering a different person first.
 */
export const SUPPORT_TOPICS: readonly SupportTopic[] = [
  { questionKey: "settings.helpFaqUsSendQ", answerKey: "settings.helpFaqUsSendA" },
  { questionKey: "settings.helpFaqPendingQ", answerKey: "settings.helpFaqPendingA" },
  { questionKey: "settings.helpFaqStoppedQ", answerKey: "settings.helpFaqStoppedA" },
  { questionKey: "settings.helpFaqNotGotQ", answerKey: "settings.helpFaqNotGotA" },
  { questionKey: "settings.helpFaqPortQ", answerKey: "settings.helpFaqPortA" },
];
