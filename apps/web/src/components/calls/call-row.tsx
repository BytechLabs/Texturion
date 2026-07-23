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
import { avatarColorClass, avatarInitials } from "@/components/shell/avatar-color";
import type { Call } from "@/lib/api/types";
import { callOutcomeLabel } from "@/lib/format/call";
import { formatPhone } from "@/lib/format/phone";
import { formatRelativeTime } from "@/lib/format/time";
import { cn } from "@/lib/utils";

/** The one caller-identity resolution (#210 reuses it on the Ongoing card):
 *  linked contact name, else the CNAM dip, else the formatted number. */
export function callerName(call: Call): string {
  if (call.contact_name) return call.contact_name;
  // D43: the CNAM-dipped carrier name, when the owner enabled the lookup.
  if (call.caller_name) return call.caller_name;
  if (call.caller_e164) return formatPhone(call.caller_e164);
  return "Unknown caller";
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
    return (
      <span className="inline-flex items-center rounded-full bg-warning/10 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-warning/15 dark:text-warning">
        {label}
      </span>
    );
  }
  return <span className="text-[12.5px] text-muted-foreground">{label}</span>;
}

export function CallRow({ call }: { call: Call }) {
  const name = callerName(call);
  const body = (
    <>
      <span
        aria-hidden
        className={cn(
          "grid size-[38px] shrink-0 place-items-center rounded-xl text-[13px] font-semibold text-app-petrol-deep",
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
        <span className="mt-0.5 flex items-center gap-2">
          <DirectionIcon call={call} />
          <OutcomePill call={call} />
          {/* D43: honest carrier-screening label — quiet, never a color
              scream; the verdict itself came from the network. */}
          {screeningLabel(call.screening_result) && (
            <span className="inline-flex items-center rounded-full bg-app-stone-1 px-2 py-0.5 text-[11px] font-medium text-app-muted dark:bg-white/5">
              {screeningLabel(call.screening_result)}
            </span>
          )}
          {/* #133: an unthreaded row (anonymous caller / no open thread) is
              deliberately not a link — say why, quietly. */}
          {!call.conversation_id && (
            <span className="ml-auto shrink-0 text-[12px] text-app-muted-2">
              Not linked to a conversation
            </span>
          )}
        </span>
        {/* D43: the message itself, playable in place. */}
        {call.outcome === "voicemail" && call.voicemail_seconds ? (
          <span className="mt-1.5 block">
            <VoicemailPlayer
              callSessionId={call.call_session_id}
              seconds={call.voicemail_seconds}
            />
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
        aria-label={`Call from ${name}, ${callOutcomeLabel(call).toLowerCase()}`}
        className={cn(
          rowClass,
          "transition-colors duration-150 hover:bg-app-stone-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        )}
      >
        {body}
      </Link>
    );
  }
  return <div className={rowClass}>{body}</div>;
}
