"use client";

import { THREAD_SUMMARY_ATTRIBUTION } from "@loonext/shared";
import { useRef, useState } from "react";

import { AiOrb, AiStatus } from "@/components/ui/ai-orb";
import { useT } from "@/i18n/provider";
import { reportAiOutcome } from "@/lib/api/conversations";
import {
  canRetryThreadSummary,
  groupThreadSummary,
  threadSummaryFailureMessage,
  threadSummaryRequestFailure,
  useThreadSummary,
  type ThreadSummaryResult,
} from "@/lib/api/thread-summary";
import { isCarrierEnforcedOptOut } from "@/lib/api/types";
import { useCompanyId } from "@/lib/company/provider";
import { formatAbsoluteDateTime, formatRelativeTime } from "@/lib/format/time";

/**
 * #247 — the catch-up card, above the thread stream.
 *
 * A crew member opens a long thread cold and presses one control. Lou reads the
 * recent conversation and answers three questions: what they asked, what we
 * said, what is still open. Every line taps through to the message it came from.
 *
 * WHAT THE SHAPE OF THIS COMPONENT IS DEFENDING, since none of it is decoration:
 *
 *   IT IS NOT ON BY DEFAULT. The resting state is one row, and the summary is
 *   what a press produces. A card that read the thread on mount would spend a
 *   metered AI call on every thread anybody opened — the most expensive call
 *   this product makes, fired by scrolling. It also would not be wanted: a
 *   catch-up is for coming back, and most opens are not that.
 *
 *   NOTHING RENDERS WITHOUT A CITATION. Every line here is a <button> that jumps
 *   to `line.message_id`. There is no branch that draws a line as plain text, so
 *   an uncited claim has nowhere to appear even if one ever reached the client.
 *   That is what makes the attribution sentence true rather than a disclaimer.
 *
 *   CARRIER TRUTH IS ABOVE THE SUMMARY, NOT INSIDE IT. The opt-out strip is
 *   rendered from `opt_out` / `opt_out_hint_at` — facts the server read from
 *   `opt_outs`, never model output — and it renders on EVERY response including
 *   all eight refusals. A summary line can never occupy that slot, because the
 *   slot is drawn before `lines` is looked at.
 *
 *   AND IT DOES NOT BLINK. `useMutation` builds a fresh mutation on every
 *   `mutate`, so `data` is gone from the first frame of a re-ask until the
 *   answer lands. A strip rendered from the live response alone therefore left
 *   the screen for the whole width of that request: a thread the carrier is
 *   blocking stopped saying so at exactly the moment somebody pressed the
 *   button, and said it again a second later. {@link ThreadSummaryCard} holds
 *   the last standing the server stated for this thread, and a fresher answer
 *   always replaces it. What is never held is one nobody was told — this card
 *   still states a standing it was given, and never one it assumed.
 *
 *   A REFUSAL IS SILENCE; A FAILED REQUEST IS NOT. Those are different events
 *   and they got the same treatment until they didn't: a refusal is the server
 *   answering "no lines, here is why", while a rejected request is no answer at
 *   all. This card used to fall back to its resting row on the second one, which
 *   is a button that appears to do nothing. `summary.isError` is read here and
 *   {@link threadSummaryRequestFailure} supplies the sentence.
 *
 *   IT DECIDES NOTHING. No badge, no score, no reordering, nothing hidden. The
 *   inbox is still the inbox; this is a reading aid sitting on top of a thread
 *   that is completely readable without it.
 *
 * *Applying: Zen of Clarity (the resting state is one row, not a permanent card
 * eating the 42rem reading track) and Prioritize Intent (built around the one
 * action, with the sections as its result rather than as the frame).*
 */
export function ThreadSummaryCard({
  conversationId,
  /**
   * The shared offer rule's answer for this thread. False renders nothing at
   * all — not a disabled control, which would advertise something the person
   * cannot have and cannot fix.
   */
  offered,
  /**
   * The newest loaded message id, watched for staleness. See {@link askedAt}.
   */
  newestMessageId,
  /** The thread's own jump — resolves through filters and unloaded pages. */
  onJump,
}: {
  conversationId: string;
  offered: boolean;
  newestMessageId: string | undefined;
  onJump: (messageId: string) => void;
}) {
  const t = useT();
  const companyId = useCompanyId();
  const summary = useThreadSummary(conversationId);
  const [dismissed, setDismissed] = useState(false);
  /**
   * The newest message when the catch-up was ASKED FOR, not when it landed.
   *
   * Recorded before the request on purpose. A message that arrives while the
   * request is in flight may or may not have made the server's window, and the
   * two mistakes are not equal: warning about a catch-up that is actually
   * current costs one press, which the server's cache answers for free, while
   * staying quiet about one that is genuinely behind leaves somebody trusting a
   * stale reading of a thread that has moved. Err toward the warning.
   */
  const askedAt = useRef<string | undefined>(undefined);
  /** #431: one `used` per catch-up, however many lines get opened. */
  const reportedUse = useRef(false);
  /**
   * The last standing the SERVER stated for this thread.
   *
   * Read only in the window where there is no response to read instead — see
   * `standing` below, where a live result always wins. Kept in the same
   * component-local storage as the mutation whose gap it covers, and the call
   * site keys this card by conversation (`message-list.tsx`), so a thread
   * switch discards this exactly when it discards `summary.data`.
   */
  const heldStanding = useRef<CarrierStanding | null>(null);

  if (!offered) return null;

  const result = summary.data ?? null;
  // Written during render because it is a cache of what is being rendered
  // right now: idempotent, so a double render stores the same fact twice.
  if (result !== null) heldStanding.current = result;
  /**
   * What the strip states: this response if one exists, the last one otherwise.
   *
   * A live response outranks the hold, and the write above replaces the hold on
   * every response rather than accumulating one. Both halves carry the same
   * rule — a customer who opts back in clears the strip on the very answer that
   * says so — and a hold kept from the FIRST answer and read ahead of the
   * response would leave a lifted STOP standing for as long as the card lived.
   * A strip that says the opposite of the truth is worse than no strip.
   *
   * Read second, the hold covers only the window where there is no response to
   * read at all: a request in flight, or one that was rejected outright.
   */
  const standing = result ?? heldStanding.current;
  /**
   * The request itself was rejected — nothing came back to render.
   *
   * `result` still wins wherever both could be read: a mutation that failed and
   * was then retried successfully leaves `isError` false and `data` set, but
   * ordering the branches this way means no future combination of the two can
   * show a stale failure over a real answer.
   */
  const failure =
    result === null && summary.isError
      ? threadSummaryRequestFailure(summary.error)
      : null;
  const showCard =
    summary.isPending || ((result !== null || failure !== null) && !dismissed);

  function ask() {
    if (summary.isPending) return;
    askedAt.current = newestMessageId;
    reportedUse.current = false;
    setDismissed(false);
    summary.mutate();
  }

  function openCited(messageId: string) {
    if (!reportedUse.current) {
      reportedUse.current = true;
      // Fire-and-forget, and never awaited: losing a data point is nothing,
      // and a failed report must never stand between somebody and the message
      // they asked to see.
      reportAiOutcome(companyId, "thread_summary", "used");
    }
    onJump(messageId);
  }

  /**
   * The word on the retry control, or null for no control at all.
   *
   * One function rather than a condition in the markup because the three
   * answers come from three different questions — did the request get through,
   * can this reason be retried, has the thread moved — and picking the wrong one
   * misleads in both directions:
   * a control under "your role can't do this" cannot succeed however often it is
   * pressed, and no control after a request that simply did not get through
   * leaves a person with a card that failed and no way forward.
   *
   * "Catch me up again" is the only one that is not a retry — the catch-up
   * worked and the thread has moved under it, which is a fresh ask.
   */
  function retryLabel(): string | null {
    if (summary.isPending) return null;
    if (result === null) return failure?.retry ? t("common.retry") : null;
    if (!canRetryThreadSummary(result.reason)) return null;
    if (result.lines.length === 0) return t("common.retry");
    return askedAt.current !== newestMessageId
      ? t("thread.catchMeUpAgain")
      : null;
  }
  const retryWord = retryLabel();

  if (!showCard) {
    return (
      <section
        aria-label={t("thread.catchUp")}
        className="overflow-hidden rounded-app-card border border-app-line bg-app-paper"
      >
        <button
          type="button"
          onClick={ask}
          className="tap-target flex w-full items-center gap-1.5 px-3 py-2 text-left transition-colors duration-150 ease-out hover:bg-app-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <AiOrb state="idle" size={14} />
          <span className="text-[13px] font-medium text-app-ink">
            {t("thread.catchMeUp")}
          </span>
          <span className="ml-auto text-[11px] text-app-muted-2">
            {/* Says what it does before it is pressed, because pressing it is
                the thing that costs. "Reads the last stretch" is also the
                honest scope — it is never the whole thread (see `truncated`). */}
            {t("thread.louReadsRecent")}
          </span>
        </button>
      </section>
    );
  }

  return (
    <section
      aria-label={t("thread.catchUp")}
      className="overflow-hidden rounded-app-card border border-app-line bg-app-paper"
    >
      {/* CARRIER TRUTH FIRST — before the header, before anything Lou wrote.
          It appears on refusals and cache hits alike, and it is the one thing
          on this card no model touched.
          The SAME slot in all three branches below (pending, failed, answered)
          on purpose: React keeps one node across the transitions, so the strip
          never unmounts under a re-ask and its announced region never repeats
          news the reader has already been given. */}
      {standing ? <OptOutStrip standing={standing} /> : null}

      <div className="flex items-center gap-2 px-3 pb-1 pt-2">
        <AiStatus
          // `done` is a claim that Lou answered, which a rejected request is
          // exactly what did not happen — the ring rests instead of blooming.
          state={summary.isPending ? "thinking" : failure ? "idle" : "done"}
          label={
            summary.isPending
              ? t("thread.readingThread")
              : t("thread.catchUp")
          }
        />
        {!summary.isPending && (
          <div className="ml-auto flex items-center gap-1">
            {retryWord !== null ? (
              <button
                type="button"
                onClick={ask}
                className="rounded-md px-1.5 py-0.5 text-[11px] font-medium text-app-olive transition-colors hover:underline"
              >
                {retryWord}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setDismissed(true)}
              className="rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
            >
              {t("thread.dismiss")}
            </button>
          </div>
        )}
      </div>

      {summary.isPending ? (
        <div className="px-3 pb-3 pt-1" aria-label={t("thread.readingThreadAria")}>
          {/* Two placeholders, not a spinner: the card keeps roughly the shape
              the sections will take instead of jumping when they land. */}
          {[0, 1].map((row) => (
            <div
              key={row}
              className="mb-1.5 h-[34px] animate-pulse rounded-app-card bg-app-inset"
              aria-hidden
            />
          ))}
        </div>
      ) : result === null ? (
        failure === null ? null : (
          // ANNOUNCED, where the refusal sentence below is not, and the
          // asymmetry is deliberate rather than an oversight. This is the only
          // branch where somebody pressed a control and the product produced
          // nothing — the one moment a screen reader cannot be left to infer
          // the outcome from a silent re-render.
          // A rejected RE-ask can now sit under a held standing, and the two do
          // not read over each other: that strip is the same node carrying the
          // same words it carried before the press, so this sentence is the
          // only thing on the card that changed.
          <p
            role="status"
            className="px-3 pb-3 pt-0.5 text-[13px] leading-[1.45] text-app-muted"
          >
            {failure.message}
          </p>
        )
      ) : result.lines.length === 0 ? (
        <p className="px-3 pb-3 pt-0.5 text-[13px] leading-[1.45] text-app-muted">
          {threadSummaryFailureMessage(result.reason)}
        </p>
      ) : (
        <>
          {/* The frame, before the lines rather than as a footnote under them:
              a reader has to know whose reading this is BEFORE they read it,
              and this sentence is also how they learn the lines are tappable.
              One shared string (#437) so three clients cannot word it three
              ways. */}
          <p className="px-3 pb-1.5 text-[11px] leading-[1.4] text-app-muted-2">
            {t(THREAD_SUMMARY_ATTRIBUTION)}
          </p>

          {askedAt.current !== newestMessageId ? (
            // Citation defends against invention and does nothing against
            // staleness: a correctly cited "we'll get someone out Tuesday" can
            // be superseded two messages later, and a receipt makes a crew
            // trust it MORE. This is the client's half of that mitigation —
            // the card says out loud that the thread has moved under it.
            <p
              role="status"
              className="mx-3 mb-1.5 rounded-app-card bg-app-tint px-2 py-1 text-[11px] leading-[1.4] text-app-olive-deep"
            >
              {t("thread.newMessagesSinceCatchUp")}
            </p>
          ) : null}

          <ul className="pb-1">
            {groupThreadSummary(result.lines).map((group) => (
              <li key={group.id} className="pb-1.5">
                {/* Heading and its lines are a tight pair; the gap BETWEEN
                    sections is the wider one, carried by the padding above.
                    *Applying: Relationship Strength.* */}
                <h4 className="px-3 pb-0.5 text-[11px] font-semibold uppercase tracking-wide text-app-muted-2">
                  {t(group.label)}
                </h4>
                <ul>
                  {group.lines.map((line) => (
                    <li key={`${line.section}:${line.message_id}:${line.text}`}>
                      <button
                        type="button"
                        onClick={() => openCited(line.message_id)}
                        aria-label={t("thread.openMessageBehindAria", {
                          text: line.text,
                        })}
                        className="flex w-full items-start gap-2 px-3 py-1 text-left transition-colors duration-150 ease-out hover:bg-app-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                      >
                        <span className="min-w-0 flex-1 text-[13px] leading-[1.45] text-app-ink">
                          {line.text}
                        </span>
                        {/* The cited message's age, not the catch-up's. The
                            server orders by it so the later word reads last;
                            this is what lets a reader see that "Tuesday" was
                            said three weeks ago. */}
                        <span
                          title={formatAbsoluteDateTime(line.at)}
                          className="shrink-0 pt-0.5 text-[11px] tabular-nums text-app-muted-2"
                        >
                          {formatRelativeTime(line.at)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>

          {result.truncated ? (
            // No figure printed. The window size lives in the API package and
            // is not a shared constant, and a number typed into this file would
            // be exactly the kind that quietly becomes last quarter's. The
            // scope is what the reader needs; the count is not.
            <p className="px-3 pb-2.5 text-[11px] leading-[1.4] text-app-muted-2">
              {t("thread.threadLongerThanRead")}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}

/**
 * The two carrier facts, on their own.
 *
 * Derived from {@link ThreadSummaryResult} rather than declared beside it, so
 * the strip reads the wire's own field types and a change to either one is a
 * type error here rather than a divergence. Narrower than the response on
 * purpose: this is the part of an answer that outlives it (see `heldStanding`),
 * and nothing the model wrote may be held that way.
 */
type CarrierStanding = Pick<ThreadSummaryResult, "opt_out" | "opt_out_hint_at">;

/**
 * The opt-out standing for this thread, stated above the catch-up.
 *
 * WHY IT IS REPEATED HERE when the composer already carries it. The composer
 * banner is at the BOTTOM of a thread and speaks about sending; this card sits
 * at the TOP and is, by design, the thing a hurried person reads INSTEAD of the
 * conversation. An opt-out that only exists below the fold is one a catch-up can
 * outrun. Carrier truth outranks a tidy paragraph.
 *
 * The wording is a compression of the composer's own sentences rather than a
 * second vocabulary, and it keeps the distinction that matters: a STOP is the
 * customer's to lift, a hand-recorded opt-out is the crew's.
 */
function OptOutStrip({ standing }: { standing: CarrierStanding }) {
  const t = useT();
  if (standing.opt_out) {
    const carrierBlocked = isCarrierEnforcedOptOut(standing.opt_out.source);
    return (
      <p
        role="status"
        className="border-b border-destructive/30 bg-destructive/10 px-3 py-2 text-[13px] leading-[1.45] text-foreground"
      >
        {carrierBlocked
          ? t("thread.optOutStripCarrier")
          : t("thread.bannerOptedOut")}
      </p>
    );
  }
  if (standing.opt_out_hint_at) {
    return (
      <p
        // #396: a legal obligation rather than a status line — announced, so a
        // screen reader hears it without going looking.
        role="alert"
        className="border-b border-destructive/30 bg-destructive/10 px-3 py-2 text-[13px] leading-[1.45] text-foreground"
      >
        {t("thread.optOutHintShort")}
      </p>
    );
  }
  return null;
}
