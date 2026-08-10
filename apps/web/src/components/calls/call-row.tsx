"use client";

/**
 * #129/#205 — the ONE call-log row, extracted verbatim from calls-view so the
 * /calls log and the contact detail's call history render the identical row
 * grammar: 38px tinted-initial avatar, 14px name, 11.5px tabular time, a muted
 * direction glyph, the outcome pill (inbound missed = the row's ONE tinted
 * element, accent budget #64), inline voicemail playback, and tap-through to
 * the conversation (unthreaded rows never dead-link).
 */
import { PhoneIncoming, PhoneMissed, PhoneOutgoing } from "lucide-react";
import Link from "next/link";

import {
  screeningLabel,
  VoicemailPlayer,
} from "@/components/calls/voicemail-player";
import { VoicemailIntakeSummary } from "@/components/calls/voicemail-intake-summary";
import { VoicemailTranscript } from "@/components/calls/voicemail-transcript";
import { avatarColorClass } from "@/components/shell/avatar-color";
import { useT, type Translate } from "@/i18n/provider";
import type { Call } from "@/lib/api/types";
import { callOutcomeLabel } from "@/lib/format/call";
import { formatPhone } from "@/lib/format/phone";
import { formatRelativeTime } from "@/lib/format/time";
import { cn } from "@/lib/utils";
import { avatarInitials } from "@loonext/shared";

/** The one caller-identity resolution (#210 reuses it on the Ongoing card):
 *  linked contact name, else the CNAM dip, else the formatted number. */
export function callerName(call: Call, t: Translate): string {
  if (call.contact_name) return call.contact_name;
  // D43: the CNAM-dipped carrier name, when the owner enabled the lookup.
  if (call.caller_name) return call.caller_name;
  if (call.caller_e164) return formatPhone(call.caller_e164);
  return t("shell.unknownCaller");
}

/** #133: a small muted direction glyph on the meta line — at a glance,
 *  who called whom. Inbound misses get PhoneMissed, every other inbound
 *  call PhoneIncoming, outbound calls PhoneOutgoing. Muted always; the
 *  warning tint stays the OutcomePill's alone (accent budget #64). */
function DirectionIcon({ call }: { call: Call }) {
  const Icon =
    call.direction === "outbound"
      ? PhoneOutgoing
      : call.outcome === "missed"
        ? PhoneMissed
        : PhoneIncoming;
  return (
    <Icon
      aria-hidden
      className="size-3.5 shrink-0 text-app-muted-2"
      strokeWidth={1.75}
    />
  );
}

/** The one tinted element per row (accent budget): INBOUND misses only —
 *  an outbound no-answer is not crew-actionable urgency. */
function OutcomePill({ call }: { call: Call }) {
  const label = callOutcomeLabel(call);
  if (call.outcome === "missed" && call.direction !== "outbound") {
    // "Missed" / "No answer" — fixed and short, so it never yields. `shrink-0`
    // matters even here: a pill that shrinks breaks its text at the space and
    // becomes a two-line rounded rect, which is worse than anything it saves.
    return (
      <span className="inline-flex shrink-0 items-center whitespace-nowrap rounded-full bg-warning/10 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-warning/15 dark:text-warning">
        {label}
      </span>
    );
  }
  // #566: THE one flexible element on this line, and the only one that can be
  // long — `callOutcomeLabel` renders "Answered by <display_name> · 4m 32s", and
  // display_name is capped at 80 characters (routes/me.ts), so this string
  // reaches ~100. Unconstrained it wrapped between words, grew the row, and
  // starved the screening chip beside it. `title` keeps the full text reachable
  // now that it ellipsizes.
  return (
    <span
      className="min-w-0 truncate text-[12.5px] text-muted-foreground"
      title={label}
    >
      {label}
    </span>
  );
}

export function CallRow({ call }: { call: Call }) {
  const t = useT();
  const name = callerName(call, t);
  const screening = screeningLabel(call.screening_result, t);
  const body = (
    <>
      <span
        aria-hidden
        className={cn(
          "grid size-[38px] shrink-0 place-items-center rounded-xl text-[13px] font-semibold text-app-olive-deep",
          avatarColorClass(call.contact_id || name),
        )}
      >
        {avatarInitials(name)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className="truncate text-[14px] font-medium text-app-ink">
            {name}
          </span>
          <span className="shrink-0 text-[11.5px] tabular-nums text-app-muted-2">
            {formatRelativeTime(call.started_at)}
          </span>
        </span>
        {/* #566: `min-w-0` so this line may be narrower than its content —
            without it the line's automatic minimum is its widest child and the
            whole row overflowed, silently clipped by the card's `overflow-hidden`
            rather than scrolling. Exactly one child is allowed to yield, and it
            is the outcome label. */}
        <span className="mt-0.5 flex min-w-0 items-center gap-2">
          <DirectionIcon call={call} />
          {/* D43: honest carrier-screening label — quiet, never a color
              scream; the verdict itself came from the network.

              #566: FIRST on the line, and immovable. It used to sit after the
              outcome label, so a long answerer name squeezed it past its own
              minimum and broke "Spam likely" into a two-line pill — a mark that
              changes shape depending on whose name is beside it is a mark people
              stop reading. It is also a judgement about the CALLER, not about how
              the call went, so it belongs before the outcome rather than after
              it: it tells you whether the rest of the line is worth reading. */}
          {screening && (
            <span className="inline-flex shrink-0 items-center whitespace-nowrap rounded-full bg-app-inset px-2 py-0.5 text-[11px] font-medium text-app-muted dark:bg-white/5">
              {screening}
            </span>
          )}
          <OutcomePill call={call} />
          {/* #133: an unthreaded row (anonymous caller / no open thread) is
              deliberately not a link — say why, quietly.

              #566: it hard-reserved ~155px on a line that has ~287px at 390px,
              forcing the entire deficit onto the two elements that carry the
              call itself. Below `sm` it is the thing that yields — but only
              visually: the sentence stays in the DOM for a screen reader, which
              is the reader most likely to be asking why a row does nothing. */}
          {!call.conversation_id && (
            <>
              <span className="sr-only">
                {t("shell.notLinkedToConversation")}
              </span>
              <span
                aria-hidden
                className="ml-auto hidden shrink-0 text-[12px] text-app-muted-2 sm:inline"
              >
                {t("shell.notLinkedToConversation")}
              </span>
            </>
          )}
        </span>
        {/* D43: the message itself, playable in place. */}
        {call.outcome === "voicemail" && call.voicemail_seconds ? (
          <span className="mt-1.5 block">
            <VoicemailPlayer
              callSessionId={call.call_session_id}
              seconds={call.voicemail_seconds}
              // Only when this row has no words of its own, or the same
              // transcript would appear twice.
              showTranscript={!call.voicemail_transcript}
            />
            {/* #367: the two lines that answer "do I need to call back", above
                the transcript they were read out of. */}
            <VoicemailIntakeSummary
              intake={call.voicemail_intake}
              className="mt-1.5"
            />
            {/* What it says, for the times playing it is not an option: on a
                roof, in a truck, next to a running compressor. The player
                stays: the recording is the record, this is the shortcut. */}
            {call.voicemail_transcript && (
              <VoicemailTranscript
                text={call.voicemail_transcript}
                // Tight to the summary above when there is one — they are the
                // same fact twice, and the gap should say so.
                className={call.voicemail_intake ? "mt-1" : "mt-1.5"}
              />
            )}
          </span>
        ) : null}
      </span>
    </>
  );

  const rowClass =
    "flex items-start gap-[11px] border-b border-app-line-soft p-[11px] last:border-b-0";
  // Threaded calls open their conversation; an unthreaded row (anonymous
  // caller, or an answered call with no open thread) is plain — no dead link.
  if (call.conversation_id) {
    return (
      <Link
        href={`/inbox/${call.conversation_id}`}
        aria-label={t("shell.callFromAria", {
          name,
          outcome: callOutcomeLabel(call).toLowerCase(),
        })}
        className={cn(
          rowClass,
          "transition-colors duration-150 hover:bg-app-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        )}
      >
        {body}
      </Link>
    );
  }
  return <div className={rowClass}>{body}</div>;
}
