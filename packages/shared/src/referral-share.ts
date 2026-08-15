import type { SayKey } from "./support";

/**
 * #288 — one tap, a pre-written message they can edit, sent from the phone they
 * are already holding.
 *
 * # What this is NOT, and why the distinction is the whole design
 *
 * {@link ./referrals.ts} refuses to distribute anything, and that refusal
 * stands: the product will never text a crew's customer list on their behalf,
 * because D4 and D11 exclude blasts and the AUP forbids purchased lists.
 *
 * This module does not weaken that. It hands the OWNER a draft and the OS share
 * sheet takes it from there — their Messages app, their thumb, their choice of
 * recipient, their own number. We never see who it went to and nothing leaves
 * through the carrier. That is what "sent from the phone they are already
 * holding" means, and it is the opposite of an acquisition funnel pointed at
 * somebody else's consented contacts.
 *
 * # Why the link is not inside the editable text
 *
 * The obvious build puts the whole message in one text box. Then the first
 * person who rewrites it in their own words deletes the link, sends it, and the
 * referral they meant to make is untraceable — they have done us a favour and
 * get nothing for it, with no way to find out why.
 *
 * So the message is editable and the link is appended. {@link referralShareText}
 * is the only thing that assembles the two, so no client can forget.
 *
 * # Why the copy is here rather than three times over
 *
 * A draft that reads differently on the phone than on the laptop is a draft an
 * owner stops trusting to say what they meant. Every sentence a crew might send
 * lives in this file and the three clients assert against it.
 */

/**
 * The default message, before the owner touches it.
 *
 * FIRST PERSON, and plain. This is a contractor writing to another contractor,
 * not us writing on their behalf: "we run our business line through X" is a
 * sentence somebody says at a supply counter, and "streamline your customer
 * communications" is not. Every claim in it is one BRAND-MESSAGING already
 * makes — the shared inbox, the flat price, no per-seat fee.
 *
 * The reward is stated rather than implied. A referrer who has to explain later
 * that they got something out of it looks like they were hiding it; a referrer
 * whose first message says "we both get a free month" is just being straight.
 */
export const REFERRAL_SHARE_NOTE =
  "domain.referralNote";

/** The heading over the share control, on all three clients. */
export const REFERRAL_SHARE_TITLE = "domain.referralTitle";

/**
 * What the referrer gets, and when.
 *
 * SAYS WHAT THE PAYOUT ACTUALLY WAITS FOR. This used to read "when they sign up
 * and send their first text", which was true of the old rule and stopped being
 * true the moment the reward began requiring D12 activation — the referee has to
 * send AND be answered. A reward line that names the wrong condition is worse
 * than a vague one: the referrer watches their friend send a text, expects a
 * month, and concludes we did not pay.
 *
 * Web appends the actual figure, because it is the only client with the price
 * book and the workspace's currency loaded. The phones say "a month free" and
 * quote no number rather than hardcoding one that would be wrong in Canada.
 */
export const REFERRAL_REWARD_LINE =
  "domain.referralRewardLine";

/**
 * The four states a referral passes through, in the words the referrer reads.
 *
 * Here rather than three times over because a crew comparing a laptop and a phone
 * is comparing these exact strings, and because they had to change with the
 * payout rule: "Texting now" described the old gate, where one outbound send was
 * enough. It is not.
 */
export const REFERRAL_STAGE_LABELS: Record<
  "invited" | "signed_up" | "active" | "rewarded" | "voided",
  string
> = {
  invited: "domain.referralStageInvited",
  signed_up: "domain.referralStageSignedUp",
  active: "domain.referralStageActive",
  rewarded: "domain.referralStageRewarded",
  voided: "domain.referralStageVoided",
};

/** The one tap. */
export const REFERRAL_SHARE_ACTION = "domain.referralAction";

/**
 * The fallback, where no share sheet exists — a desktop browser, mostly.
 *
 * Kept as a SECOND action rather than a replacement: an owner at a laptop who
 * wants the text in their own email client is not a degraded case.
 */
export const REFERRAL_SHARE_COPY = "domain.referralCopy";

/** Confirmation after the copy. */
export const REFERRAL_SHARE_COPIED = "domain.referralCopied";

/** The label on the editable draft. */
export const REFERRAL_SHARE_DRAFT_LABEL = "domain.referralDraftLabel";

/**
 * Said out loud, because an editable box next to a fixed link invites the
 * question of whether the link is going too.
 */
export const REFERRAL_SHARE_LINK_NOTE = "domain.referralLinkNote";

/**
 * The message as it will actually be sent: the owner's words, then the link.
 *
 * `link` is null when SITE_ORIGIN is unset, in which case the code carries the
 * referral on its own — read aloud at a counter is how half of these will
 * travel anyway. A blank line between the two so the URL is tappable in every
 * messaging app rather than running into the last word.
 */
export function referralShareText(
  note: string,
  link: string | null,
  code: string,
): string {
  const written = note.trim();
  const tail = link ? link : `Use my code ${code} when you sign up.`;
  return written.length === 0 ? tail : `${written}\n\n${tail}`;
}

// ---------------------------------------------------------------------------
// When to ask
// ---------------------------------------------------------------------------

/**
 * How long the workspace must have been working before we ask.
 *
 * #288: "Asking at signup is asking someone to vouch for something they have
 * not used, which costs credibility and converts badly." Counted from the day
 * the product first WORKED — D12 activation, when they sent and somebody
 * answered — rather than from the day they paid, because a month spent waiting
 * on carrier registration is not a month of use.
 */
export const REFERRAL_ASK_MIN_DAYS = 30;

/**
 * How many customers they must have replied to in the last month.
 *
 * A crew answering two customers a month is a crew the product is barely doing
 * anything for, and #288's own devil's advocate is explicit about what happens
 * then: "the ask reads as needy and the incentive as a bribe". This is the line
 * between a working business and a trial that has not ended yet.
 */
export const REFERRAL_ASK_MIN_CUSTOMERS = 20;

/**
 * How long "Not now" lasts.
 *
 * A quarter, not a week. The prompt has one job and asking again next Tuesday
 * would teach an owner to dismiss things on sight, which is the cost #225
 * already paid once on quiet-hours confirmations.
 */
export const REFERRAL_ASK_QUIET_DAYS = 90;

/** Why we are not asking. Never shown to anybody — this is for us. */
export type ReferralAskRefusal =
  | "not_activated"
  | "too_new"
  | "too_quiet"
  | "dismissed"
  | "capped";

export interface ReferralAskFacts {
  /** D12: they sent a text through the carrier and somebody answered. */
  activated: boolean;
  /** When that first answer landed. Null when it never has. */
  activatedAt: string | null;
  /** Distinct customers they have replied to in the last 30 days. */
  repliedCustomers: number;
  /** When they last said "Not now". */
  dismissedAt: string | null;
  /** Rewards already earned in the rolling year, against the cap. */
  rewardsThisYear: number;
  /** The yearly cap, passed in so this file has one source for it. */
  rewardCap: number;
}

export interface ReferralAskDecision {
  ask: boolean;
  refusal?: ReferralAskRefusal;
  /** The number the headline quotes. Present only when we are asking. */
  customers?: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Has this workspace earned the right to be asked?
 *
 * Every branch is a way of getting the moment wrong, and they are ordered from
 * the most embarrassing down:
 *
 * NOT ACTIVATED. The product has not worked for them once. Asking here is the
 * failure the issue names by name.
 *
 * TOO NEW. Thirty days of the thing actually working. #288 asks for "a month of
 * use" and this is it, measured from the day it started working.
 *
 * TOO QUIET. See {@link REFERRAL_ASK_MIN_CUSTOMERS}.
 *
 * DISMISSED. They said no. That answer holds for a quarter.
 *
 * CAPPED — and this one is about honesty rather than timing. A referrer already
 * at the yearly cap cannot earn another month, and `decideReferral` will refuse
 * the claim their friend makes. Asking anyway would be offering a reward we have
 * already decided not to pay, and the person who finds out is the one who did us
 * the favour.
 */
export function referralAskDecision(
  facts: ReferralAskFacts,
  now: Date,
): ReferralAskDecision {
  if (!facts.activated || !facts.activatedAt) {
    return { ask: false, refusal: "not_activated" };
  }
  const activated = Date.parse(facts.activatedAt);
  // An unparseable timestamp is treated as "we do not know when this started",
  // which is not the same as "long enough ago". Refusing is the safe direction:
  // the cost of asking too early is credibility, and the cost of asking a month
  // late is a month.
  if (!Number.isFinite(activated)) {
    return { ask: false, refusal: "too_new" };
  }
  if (now.getTime() - activated < REFERRAL_ASK_MIN_DAYS * DAY_MS) {
    return { ask: false, refusal: "too_new" };
  }
  if (facts.repliedCustomers < REFERRAL_ASK_MIN_CUSTOMERS) {
    return { ask: false, refusal: "too_quiet" };
  }
  if (facts.dismissedAt) {
    const dismissed = Date.parse(facts.dismissedAt);
    // An unreadable dismissal counts as a dismissal. Somebody pressed "Not
    // now"; a parsing problem on our side must not turn that into a yes.
    if (!Number.isFinite(dismissed)) {
      return { ask: false, refusal: "dismissed" };
    }
    if (now.getTime() - dismissed < REFERRAL_ASK_QUIET_DAYS * DAY_MS) {
      return { ask: false, refusal: "dismissed" };
    }
  }
  if (facts.rewardsThisYear >= facts.rewardCap) {
    return { ask: false, refusal: "capped" };
  }
  return { ask: true, customers: facts.repliedCustomers };
}

/**
 * The headline, in their numbers.
 *
 * *Applying: Meaningful Highlights & Context* — the ask opens with what THEY
 * did, not with what we want. An owner who reads "you replied to 37 customers
 * this month" has been handed a fact about their own business before being
 * asked for anything, and that ordering is the difference between a prompt that
 * feels earned and one that feels like a pop-up.
 */
export function referralAskHeadline(customers: number, say: SayKey): string {
  /*
   * #228: singular and plural are SEPARATE KEYS, not one sentence with the
   * number swapped in. French agrees "client" and its article with the count,
   * and the one-customer case does not carry a numeral at all in either
   * language — "1 client" reads as a form field, not as a sentence about
   * somebody's month.
   */
  return customers === 1
    ? say("domain.referralAskHeadlineOne")
    : say("domain.referralAskHeadlineMany").replace("{count}", String(customers));
}

/**
 * The ask itself.
 *
 * Points at the problem the product solves rather than at the product, because
 * the reader is being asked to picture a specific person — and every contractor
 * knows one who is still running the business off their own cell.
 */
export const REFERRAL_ASK_BODY =
  "domain.referralAskBody";

/** The primary action on the ask. */
export const REFERRAL_ASK_ACTION = "domain.referralAskAction";

/**
 * The way out.
 *
 * *Applying: Ethical Friction, in reverse* — the dismissal is a plain button of
 * equal weight, not a greyed-out afterthought. A prompt asking for a favour has
 * no business making "no" hard to find.
 */
export const REFERRAL_ASK_DISMISS = "domain.referralAskDismiss";
