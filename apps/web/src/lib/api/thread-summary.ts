"use client";

import { useMutation } from "@tanstack/react-query";
import {
  DEFAULT_LOCALE,
  shouldOfferThreadSummary,
  THREAD_SUMMARY_SECTIONS,
  type ThreadSummarySection,
} from "@loonext/shared";

import { makeTranslate, type Translate } from "@/i18n/provider";
import { useCompanyId } from "@/lib/company/provider";

import { apiFetch } from "./client";
import { ApiError } from "./error";
import type { MessageDirection, OptOutSource } from "./types";

/**
 * #247 — the catch-up, client side.
 *
 * A tech comes off a roof at 4pm to a thread nobody has read since Tuesday.
 * `POST /v1/conversations/:id/summary` answers three questions — what they
 * asked, what we said, what is still open — and every line it returns carries
 * the id of a real message in this thread.
 *
 * THE THREE THINGS THIS MODULE EXISTS TO PROTECT, in the order #247 puts them:
 *
 *   1. It never invents a fact. Not because the copy promises it doesn't, but
 *      because the server drops any line it cannot ground in a message it fed
 *      the model, and this client renders nothing that did not arrive with a
 *      `message_id`. There is no branch here that displays an uncited line.
 *
 *   2. It never buries an opt-out. `opt_out` and `opt_out_hint_at` are read
 *      deterministically from `opt_outs` and `conversations.opt_out_hint_at` and
 *      ride on EVERY response shape — the successes, the cache hits and all
 *      eight refusals. {@link ThreadSummaryResult} makes them non-optional so a
 *      renderer cannot forget one, which is the whole reason they are typed
 *      that way rather than as `?:` like everything else here. Riding on every
 *      response still leaves the gaps BETWEEN responses, and this is a mutation
 *      that clears `data` the moment it is asked again — so the card holds the
 *      last standing it was told across a re-ask (`thread-summary-card.tsx`)
 *      rather than dropping it for the width of the request.
 *
 *   3. It is not a decision. Nothing in this module or the card that consumes
 *      it reorders the inbox, badges a row, or hides a thread. Urgency triage
 *      that hides a thread loses somebody a job; the ranking that does exist is
 *      deterministic and lives in `api_for_you`.
 *
 * PERMISSIVE GATE, like reply drafting. This never reads the workspace's AI
 * settings to decide whether to offer the control — the server decides, and a
 * refusal comes back as a `reason` with a sentence attached. A client that
 * gated itself would need a second copy of the rule, and the two would drift.
 */

/**
 * Why no lines came back. Everything except `too_short` originates in the
 * shared AI gate (`apps/api/src/ai/run.ts`) or the route's own free checks; a
 * busy inbox gets one plain sentence and a thread it can still read, never an
 * error box.
 */
export type ThreadSummaryReason =
  /** The workspace turned catch-ups off in Settings, Lou. */
  | "disabled"
  /** A HUMAN marked this thread spam (#250) — never the classifier's suspicion. */
  | "spam"
  /** The free pre-filter said reading beats summarising. Costs nothing. */
  | "too_short"
  | "rate_limited"
  | "over_cap"
  | "model_error"
  /**
   * The model answered and NOTHING survived the citation rules. Its own reason
   * because it is the one failure that is about this thread rather than about
   * the service, and the honest sentence for it is different.
   */
  | "unusable_output"
  /** #581: Lou stopped spending because the workspace stopped paying. */
  | "subscription_inactive"
  | "unavailable";

/**
 * One line of the catch-up. Mirrors `SummaryLine`
 * (apps/api/src/messaging/thread-summary.ts) exactly.
 *
 * `message_id` and `at` are the guarantee, not decoration: the line exists only
 * because a real message in this thread grounds it, and both fields come from
 * the server's copy of that message rather than from anything the model said.
 */
export interface ThreadSummaryLine {
  section: ThreadSummarySection;
  text: string;
  /** The message this line came from. Always one still in the thread. */
  message_id: string;
  /** That message's timestamp, so a reader can see how old the claim is. */
  at: string;
}

/** A live opt-out on this thread's contact, as a fact from `opt_outs`. */
export interface ThreadSummaryOptOut {
  source: OptOutSource;
  at: string;
}

/**
 * The whole response, every shape.
 *
 * `opt_out` and `opt_out_hint_at` are REQUIRED rather than optional, unlike the
 * other fields, and the difference is deliberate: carrier truth outranks a tidy
 * paragraph, so a renderer that forgets to read them should not typecheck.
 */
export interface ThreadSummaryResult {
  /** Empty whenever `reason` is set. Never contains an uncited line. */
  lines: ThreadSummaryLine[];
  reason?: ThreadSummaryReason;
  /** Served from `conversation_summaries` — the thread has not moved since. */
  cached?: boolean;
  /** The thread is longer than the window the server read. */
  truncated?: boolean;
  opt_out: ThreadSummaryOptOut | null;
  opt_out_hint_at: string | null;
  /**
   * Which rule discarded how many candidate lines. Counts only, never any text.
   *
   * Deliberately NOT rendered. It is diagnostic — "uncited: 3" tells a plumber
   * nothing they can act on, and the sentence that replaces it ("Lou couldn't
   * point at the messages behind what it read") is the same news in a language
   * the reader speaks. It is typed here so the shape is not lost, and so the
   * next person to want it knows it already arrives.
   */
  dropped?: Record<string, number>;
  /** The model envelope's key names when nothing parsed. Diagnostic, as above. */
  envelope?: string[];
}

/**
 * The reader's words, for the callers that have not been handed a lookup yet
 * and for the tests that call these bare. English, which is what every reader
 * saw before #228 — a wrong language is a worse failure than a familiar one.
 */
const EN = makeTranslate(DEFAULT_LOCALE);

/**
 * The one sentence shown when a catch-up produces nothing.
 *
 * Every branch says what happened AND leaves the reader holding the thing that
 * always works — the thread itself, which is unchanged and completely readable.
 * "Nothing to show" for all eight would hide a workspace-wide toggle behind the
 * same shrug as a model timeout, and only one of those is worth a second press.
 *
 * #228: the sentences live in `i18n/sections/thread.ts` with the rest of the
 * catch-up card, and `t` arrives from the card that renders them.
 */
export function threadSummaryFailureMessage(
  reason: ThreadSummaryReason | undefined,
  t: Translate = EN,
): string {
  switch (reason) {
    case "disabled":
      return t("thread.catchUpDisabled");
    case "spam":
      return t("thread.catchUpSpam");
    case "too_short":
      return t("thread.catchUpTooShort");
    case "rate_limited":
      return t("thread.catchUpRateLimited");
    case "over_cap":
      return t("thread.catchUpOverCap");
    case "model_error":
    case "unavailable":
      return t("thread.louUnreachable");
    case "unusable_output":
      // Names the citation rule as the cause, because that is what happened and
      // because it is the one sentence here that tells the reader something
      // true about how this feature works: nothing shows unless Lou can point
      // at the message it came from.
      return t("thread.catchUpUnusable");
    case "subscription_inactive":
      // Billing, not breakage — so it must not say "try again", which is not
      // what fixes it. Names the one place that does, and does it with the KEY
      // the send paths use for a lapsed subscription rather than a second copy
      // of the sentence, so a crew meeting both in one afternoon reads one
      // story rather than two.
      return t("thread.louPausedForBilling");
    default:
      return t("thread.catchUpNone");
  }
}

/**
 * Is pressing again worth anything?
 *
 * A retry control under "catch-ups are turned off for this workspace" is a
 * button that cannot succeed however many times it is pressed, and a person who
 * presses it twice learns the product is lying to them. The three that stay
 * false are the three a second press cannot change from this screen.
 */
export function canRetryThreadSummary(
  reason: ThreadSummaryReason | undefined,
): boolean {
  switch (reason) {
    case "disabled":
    case "spam":
    case "too_short":
    case "over_cap":
      return false;
    default:
      // Includes `undefined` — a summary that came back fine can be asked for
      // again once the conversation moves, which is what the staleness notice
      // on the card offers.
      return true;
  }
}

/**
 * What to say when the REQUEST failed, which is not the same event as a refusal.
 *
 * A refusal is an answer: the server considered this thread and returned
 * `lines: []` with a reason, carrier truth attached. Silence is the right
 * degradation for that, because the reader is holding a readable thread and
 * nothing is wrong. A rejected request is the opposite — `apiFetch` throws, no
 * answer exists, and the card that stays quiet is indistinguishable from a
 * button that does nothing. So this branch says something, always.
 *
 * THE TWO REFUSALS IT KEEPS APART, because they are different news:
 *
 *   ABOUT THE WORKSPACE (`forbidden`) — this person's standing here, not this
 *   conversation. No thread would work, a second press cannot change it, and the
 *   remedy is somebody else's to apply. Two gates raise it on this route: the
 *   `conversations.note` capability check (whose only failing role that can see
 *   a thread at all is `read_only` — the accountant or consultant, and the case
 *   H4 names), and `companyContext` refusing a membership that has ended. The
 *   sentence names NEITHER, because the client cannot tell them apart from a
 *   403: it says what is true of both, and points at the owner who can fix
 *   either.
 *
 *   ABOUT THIS THREAD (`not_found`) — this conversation, right now, cannot be
 *   opened. Another thread would work fine. Also unretryable, and the useful act
 *   is reloading rather than pressing again.
 *
 * WHAT IT DOES NOT DO: it does not guess. Codes this route does not raise fall
 * through to the server's OWN customer-facing sentence (SPEC §7 writes one for
 * every code) and to `ApiError.retryable`, rather than to copy invented here for
 * a state nobody has seen. `retry` departs from `retryable` in exactly one
 * place, and it is the one this route knows better: `service_unavailable` is an
 * operator's temporary kill switch, so it IS worth a second press. The two
 * refusals above agree with `retryable` and are spelled out anyway, because
 * their SENTENCES are the point.
 *
 * THERE IS NO `unauthorized` CASE, and its absence is deliberate. One was
 * written, and deleting it left every guard green — because the default already
 * answers it perfectly: the client throws that code with "You're signed out. Log
 * in again." (see `core.ts`) and `retryable` is already false. A case that only
 * reworded a sentence the product had already written would have been a second
 * vocabulary for one fact, which is the thing the `rate_limited` case exists to
 * avoid.
 */
export interface ThreadSummaryRequestFailure {
  /** The one sentence for the card body. Never empty. */
  message: string;
  /** Could a second press succeed? Drives whether a retry control is offered. */
  retry: boolean;
}

/**
 * Map a thrown request into that sentence.
 *
 * Takes `unknown` because that is what a mutation's `error` is, and because the
 * non-ApiError case is the common one on a phone in a basement: `fetch` itself
 * rejects, nothing reached the server, nothing was spent. That error's own
 * message is "Failed to fetch" — developer text — so it is never shown.
 */
export function threadSummaryRequestFailure(
  error: unknown,
  t: Translate = EN,
): ThreadSummaryRequestFailure {
  if (!(error instanceof ApiError)) {
    return { message: t("thread.catchUpOffline"), retry: true };
  }
  switch (error.code) {
    case "forbidden":
      return { message: t("thread.catchUpForbidden"), retry: false };
    case "not_found":
      return { message: t("thread.catchUpGone"), retry: false };
    case "rate_limited":
      // The same sentence as the gate's own `rate_limited`, on purpose: one
      // fact, one wording. An edge 429 and the AI gate's refusal mean the same
      // thing to the person holding the phone. Routed through the function
      // rather than the key so the two cannot be separated by an edit here.
      return {
        message: threadSummaryFailureMessage("rate_limited", t),
        retry: true,
      };
    case "service_unavailable":
      // #283: switched off at the runtime kill switch during an incident — not
      // this workspace's fault and not permanent, which is why it retries where
      // the two refusals above do not.
      return { message: t("thread.catchUpPaused"), retry: true };
    default:
      return {
        // The SERVER's own sentence, untranslated on purpose: SPEC §7 writes
        // one per code and translating it belongs there, not in a second copy
        // that drifts. An envelope with an empty message is a server bug, and
        // rendering it would put us straight back in the silence this function
        // exists to end — so that one case falls to our words.
        message:
          error.message.trim().length > 0
            ? error.message
            : t("thread.catchUpFailed"),
        retry: error.retryable,
      };
  }
}

/** A section with its heading and the lines that landed in it, ready to render. */
export interface ThreadSummaryGroup {
  id: ThreadSummarySection;
  label: string;
  lines: ThreadSummaryLine[];
}

/**
 * Group the lines under the three shared headings, in the shared order.
 *
 * EMPTY SECTIONS ARE DROPPED, and that is a correctness rule rather than a
 * tidiness one. A rendered "What they asked" with nothing under it reads as
 * "they asked nothing" — a claim about the conversation that Lou never made and
 * that is very often false. Saying less is the honest failure here.
 *
 * Order comes from THREAD_SUMMARY_SECTIONS rather than from the server's array,
 * so a model that emitted its lines out of order still reads asked → said →
 * open. Within a section the server's order is kept: it sorts by the cited
 * message's timestamp so the later word reads last.
 */
export function groupThreadSummary(
  lines: readonly ThreadSummaryLine[],
): ThreadSummaryGroup[] {
  return THREAD_SUMMARY_SECTIONS.map((section) => ({
    id: section.id,
    label: section.label,
    lines: lines.filter((line) => line.section === section.id),
  })).filter((group) => group.lines.length > 0);
}

/**
 * Should this thread be offered a catch-up at all?
 *
 * The rule itself is shared (`shouldOfferThreadSummary`) and the server applies
 * the identical one authoritatively; this only feeds it what a loaded thread
 * knows, so a person is never offered a control whose whole answer is "there was
 * nothing to summarise".
 *
 * NOTES ARE NOT COUNTED, matching the server's filter. A crew's private notes
 * are not part of the conversation and never enter the prompt, so counting them
 * would offer a catch-up on a thread the customer barely spoke in.
 *
 * A PARTIALLY LOADED THREAD IS SAFE, which is why the loaded page is enough.
 * Messages arrive newest-first in pages of 50, so anything with more to load
 * already has 50 in hand — comfortably over the threshold. Where the count is a
 * lower bound it can only make this answer NO too often, never yes wrongly, and
 * an unoffered catch-up costs a scroll while a wrongly offered one costs money.
 */
export function offerThreadSummary(
  messages: readonly { direction: MessageDirection; created_at: string }[],
  now: Date = new Date(),
): boolean {
  const visible = messages.filter(
    (message) => message.direction === "inbound" || message.direction === "outbound",
  );
  const newest = visible.reduce<number>((latest, message) => {
    const at = Date.parse(message.created_at);
    return Number.isNaN(at) || at < latest ? latest : at;
  }, 0);
  if (newest === 0) return false;
  return shouldOfferThreadSummary({
    messageCount: visible.length,
    // Upholds `ThreadSummaryOffer.idleMs`'s documented precondition ("never
    // negative"), which a clock skewed behind a just-arrived message would
    // otherwise break.
    //
    // NOT A GUARD, and deliberately not tested as one: today the shared rule
    // only ever compares idleMs UPWARD against a positive threshold, so a
    // negative value and a clamped zero produce the same answer and no test
    // can tell them apart. It is here to keep the contract true for whatever
    // that rule becomes, and a test asserting it would pass with the clamp
    // deleted — which is a decorative guard, not a check.
    idleMs: Math.max(0, now.getTime() - newest),
  });
}

/**
 * Ask for the catch-up.
 *
 * A MUTATION, not a query, and the distinction is the cost control: each call
 * is a metered AI request somebody asked for by pressing a button, so it must
 * never be refetched on window focus, retried in the background, or warmed on
 * mount the way a query would be. This is the largest input the product sends
 * to a model — a query here would multiply the most expensive call we make by
 * every tab switch.
 *
 * Repeat presses on an unchanged thread are answered from
 * `conversation_summaries` server-side and spend nothing, which is what makes
 * dismissing the card cheap to undo.
 */
export function useThreadSummary(conversationId: string) {
  const companyId = useCompanyId();
  return useMutation({
    mutationFn: () =>
      apiFetch<ThreadSummaryResult>(
        `/v1/conversations/${conversationId}/summary`,
        { method: "POST", companyId },
      ),
  });
}
