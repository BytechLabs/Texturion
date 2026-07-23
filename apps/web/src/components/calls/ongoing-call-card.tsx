"use client";

/**
 * #210 — the Ongoing card: who is holding the line, right now. A live call is
 * a GET /v1/calls row with outcome=null (D43 mints the row at call.initiated);
 * post-#208 `state` distinguishes the mirror phases and answered_by_user_id
 * stamps who picked up. The founder's gap: the log said "In progress" but
 * never WHO was on the busy line.
 *
 * Grammar: pinned above the call log in the app card shape (uppercase 11px
 * header, one bordered card, hairline row separators — the Recent calls
 * grammar verbatim). Each ongoing call is one row; simultaneous calls stack
 * as rows in the same card. The card clears when the row resolves — the
 * existing call.updated realtime invalidation of the [companyId, "calls"]
 * prefix refetches the query and the row leaves the outcome-null set.
 *
 * Member display names resolve from the roster the app already fetches
 * (useMembers — the same source the call bar's transfer menu reads); the
 * business line resolves from useNumbers and only shows when the company
 * owns more than one line. No new API joins.
 *
 * The mm:ss ticker is ISOLATED in LiveOngoingDuration — one interval per
 * ongoing row re-renders a single <span>, never the card or the list.
 */
import { useEffect, useState } from "react";

import { callerName } from "@/components/calls/call-row";
import {
  avatarColorClass,
  avatarInitials,
} from "@/components/shell/avatar-color";
import { useNumbers } from "@/lib/api/numbers";
import { useMembers } from "@/lib/api/team";
import type { Call } from "@/lib/api/types";
import { formatPhone } from "@/lib/format/phone";
import { cn } from "@/lib/utils";

/** outcome=null IS the live-call signal (D43/#208 — binding for readers). */
export function isOngoingCall(call: Pick<Call, "outcome">): boolean {
  return call.outcome === null;
}

/** "0:07" / "4:32" / "61:05" — the live mm:ss tick. Pure: (anchor, now) in,
 *  label out; clamped so clock skew never renders a negative. */
export function liveDurationLabel(sinceIso: string, nowMs: number): string {
  const elapsed = Math.max(
    0,
    Math.floor((nowMs - Date.parse(sinceIso)) / 1000),
  );
  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/**
 * The row's live phase. answered_by_user_id is the strongest signal (state
 * can lag a beat behind the answer stamp); the voicemail mirror states mean
 * the caller is IN the voicemail flow — the line is busy but nobody is on
 * it; everything else pre-answer is ringing. Outbound rows (state null
 * forever, no answered_by) are the crew's own outgoing call.
 */
export function ongoingPhase(
  call: Pick<Call, "direction" | "state" | "answered_by_user_id">,
): "ringing" | "answered" | "voicemail" | "outbound" {
  if (call.direction === "outbound") return "outbound";
  if (call.answered_by_user_id || call.state === "answered") return "answered";
  if (
    call.state === "voicemail_greeting" ||
    call.state === "voicemail_recording"
  ) {
    return "voicemail";
  }
  return "ringing";
}

/**
 * The isolated ticker: one interval, one <span> re-render per second. The
 * card, the list, and every sibling row are untouched by the tick.
 */
function LiveOngoingDuration({ since }: { since: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return <span className="tabular-nums">{liveDurationLabel(since, now)}</span>;
}

function OngoingCallRow({
  call,
  memberName,
  line,
}: {
  call: Call;
  memberName: string | null;
  line: string | null;
}) {
  const name = callerName(call);
  const phase = ongoingPhase(call);
  // #210: the duration anchors on the answer stamp; until the api_list_calls
  // projection carries answered_at, started_at keeps the ticker honest-ish
  // (it can only over-count by the ring window, never under-count).
  const since = call.answered_at ?? call.started_at;

  return (
    <div className="flex items-center gap-[11px] border-b border-app-line-soft p-[11px] last:border-b-0">
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
        <span className="block truncate text-[14px] font-medium text-app-ink">
          {name}
        </span>
        <span className="mt-0.5 flex items-center gap-2 text-[12.5px] text-app-muted">
          {/* The call bar's live-dot grammar: warning pulse pre-answer,
              primary pulse once someone is on the line. */}
          <span
            aria-hidden
            className={cn(
              "size-2 shrink-0 rounded-full animate-pulse",
              phase === "answered" || phase === "outbound"
                ? "bg-primary"
                : "bg-warning",
            )}
          />
          {phase === "ringing" ? (
            <span>Ringing…</span>
          ) : phase === "voicemail" ? (
            <span>Going to voicemail</span>
          ) : phase === "outbound" ? (
            <span>
              Outgoing call · <LiveOngoingDuration since={since} />
            </span>
          ) : (
            <span>
              With {memberName ?? "a teammate"} ·{" "}
              <LiveOngoingDuration since={since} />
            </span>
          )}
          {line && (
            <span className="ml-auto shrink-0 text-[12px] text-app-muted-2">
              on {line}
            </span>
          )}
        </span>
      </span>
    </div>
  );
}

/**
 * The Ongoing section: absent entirely when nothing is live (it never
 * occupies space at rest — the call bar's posture).
 */
export function OngoingCalls({ calls }: { calls: Call[] }) {
  const members = useMembers();
  const numbers = useNumbers();
  if (calls.length === 0) return null;

  const memberName = (userId: string | null): string | null =>
    userId
      ? (members.data?.data.find((m) => m.user_id === userId)?.display_name ??
        null)
      : null;

  // "Which line is busy" only means something when the company owns more
  // than one live line; a one-number company already knows.
  const activeLines = (numbers.data?.data ?? []).filter(
    (n) => n.number_e164 && !n.released_at,
  );
  const lineLabel = (phoneNumberId: string | null): string | null => {
    if (activeLines.length < 2 || !phoneNumberId) return null;
    const match = activeLines.find((n) => n.id === phoneNumberId);
    return match?.number_e164 ? formatPhone(match.number_e164) : null;
  };

  return (
    <section aria-label="Ongoing calls">
      <h2 className="flex items-baseline gap-2 px-1 pb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-app-muted-2">
        Ongoing
      </h2>
      <div className="overflow-hidden rounded-app-card border border-app-line bg-app-white">
        {calls.map((call) => (
          <OngoingCallRow
            key={call.id}
            call={call}
            memberName={memberName(call.answered_by_user_id)}
            line={lineLabel(call.phone_number_id)}
          />
        ))}
      </div>
    </section>
  );
}
