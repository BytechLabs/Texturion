"use client";

/**
 * #129 Calls — the call-log surface. Composes the shipped vocabulary only:
 * the for-you Section card (uppercase 11px header, one bordered card,
 * hairline row separators), the shared CallRow (call-row.tsx — #205 also
 * renders it on the contact detail's call history), and CalmEmptyState.
 * Missed is the only filter: the weekly
 * question is "who called and do I need to act?". #133 polish: a muted
 * direction glyph per row and a quiet explainer on unthreaded rows.
 * #134/D42: calling is included on every plan, so the old module-off banner
 * is gone — there is no module state to warn about.
 */
import { Grid3x3, PhoneIncoming } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { CallRow } from "@/components/calls/call-row";
import { Dialer } from "@/components/calls/dialer";
import {
  isOngoingCall,
  OngoingCalls,
} from "@/components/calls/ongoing-call-card";
import { SoftphoneStatus } from "@/components/calls/softphone-status";
import { CalmEmptyState } from "@/components/settings/empty-state";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useCalls, useRingMe, type CallOutcomeFilter } from "@/lib/api/calls";
import { useSoftphone } from "@/lib/softphone/provider";
import { cn } from "@/lib/utils";

const FILTERS: { label: string; value: CallOutcomeFilter | undefined }[] = [
  { label: "All", value: undefined },
  { label: "Missed", value: "missed" },
];

export function CallsView() {
  const [outcome, setOutcome] = useState<CallOutcomeFilter | undefined>(
    undefined,
  );
  const calls = useCalls(outcome);
  // #210: the Ongoing card derives from the UNFILTERED query — the same cache
  // entry as the All filter — so a live call stays pinned above the log even
  // while Missed is selected (the missed query can't see outcome-null rows).
  // Live rows are the newest rows, so page 1 always carries them; the
  // call.updated realtime invalidation of the [companyId, "calls"] prefix
  // clears the card the moment a row resolves.
  const allCalls = useCalls(undefined);

  // Push-to-wake (#135 pt.2): opened from an incoming-call push at
  // /calls?call=<session>. Once the softphone is registered, ask the server to
  // ring THIS awake browser for the still-live call — it then surfaces in the
  // call bar to answer. Fire once per session (a re-ring on every render would
  // spam Telnyx).
  const softphone = useSoftphone();
  const ringMe = useRingMe();
  const pendingCall = useSearchParams().get("call");
  const rungRef = useRef<string | null>(null);
  const ready = softphone?.ready ?? false;
  // #170 CALLS-V3 §10.1.3: ring-me only when this device holds no live leg
  // that could belong to the session — the request's `no_local_leg: true` IS
  // that attestation, so it must be true when we fire. A ringing inbound
  // INVITE's customer session is unknowable until answered (the SDK reports
  // the MEMBER leg's session; the customer session resolves via by-leg only
  // after answer), so any un-ended inbound call that is still ringing — or one
  // already resolved to THIS session — blocks the auto-ring: the INVITE path
  // owns presentation. Inbound calls resolved to OTHER sessions (and outbound
  // calls) don't block — ringing this member for a second call is call
  // waiting, not a push-chase.
  const presentingLeg =
    softphone?.calls.some(
      (c) =>
        c.direction === "inbound" &&
        c.phase !== "ended" &&
        (c.phase === "ringing" || c.sessionId === pendingCall),
    ) ?? false;
  useEffect(() => {
    if (!pendingCall || !ready || presentingLeg) return;
    if (rungRef.current === pendingCall) return;
    rungRef.current = pendingCall;
    ringMe.mutate(pendingCall);
  }, [pendingCall, ready, presentingLeg, ringMe]);
  const ongoing = (allCalls.data?.pages[0]?.data ?? []).filter(isOngoingCall);
  // Ongoing rows live in the card above — the log below shows resolved calls
  // only, so a live call never renders twice.
  const rows = (calls.data?.pages.flatMap((page) => page.data) ?? []).filter(
    (call) => !isOngoingCall(call),
  );

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 px-4 py-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <h1 className="text-[17px] font-semibold text-app-ink">Calls</h1>
          <SoftphoneStatus />
          <Dialer
            trigger={
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1.5 px-2.5 text-[12.5px]"
              >
                <Grid3x3 className="size-3.5" strokeWidth={1.75} />
                Dial
              </Button>
            }
          />
        </div>
        {/* The inbox filter-bar segmented control, verbatim shape: a stone
            track with the lifted active pill. */}
        <div
          role="radiogroup"
          aria-label="Filter calls"
          className="flex gap-0.5 rounded-full bg-app-line-soft p-[3px] dark:bg-white/5"
        >
          {FILTERS.map((filter) => {
            const selected = outcome === filter.value;
            return (
              <button
                key={filter.label}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setOutcome(filter.value)}
                className={cn(
                  "rounded-full px-3 py-1 text-[12.5px] font-medium transition-colors duration-150",
                  selected
                    ? "bg-app-white text-app-ink"
                    : "text-app-muted hover:text-app-ink",
                )}
              >
                {filter.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* #210: who is holding the line, pinned above the log. */}
      <OngoingCalls calls={ongoing} />

      <section>
        <h2 className="flex items-baseline gap-2 px-1 pb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-app-muted-2">
          Recent calls
        </h2>
        <div className="overflow-hidden rounded-app-card border border-app-line bg-app-white">
          {calls.isPending ? (
            <div className="space-y-0">
              {Array.from({ length: 4 }, (_, i) => (
                <div
                  key={i}
                  className="flex items-center gap-[11px] border-b border-app-line-soft p-[11px] last:border-b-0"
                >
                  <Skeleton className="size-[38px] rounded-xl" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-3.5 w-36" />
                    <Skeleton className="h-3 w-24" />
                  </div>
                </div>
              ))}
            </div>
          ) : calls.isError ? (
            <CalmEmptyState
              icon={<PhoneIncoming className="size-7" strokeWidth={1.5} />}
              title="Couldn't load your calls."
              description="Check your connection and try again."
              action={
                <Button variant="outline" onClick={() => calls.refetch()}>
                  Try again
                </Button>
              }
            />
          ) : rows.length === 0 ? (
            <CalmEmptyState
              icon={<PhoneIncoming className="size-7" strokeWidth={1.5} />}
              title={
                outcome === "missed"
                  ? "No missed calls. Nice."
                  : "Calls to your business number will show up here."
              }
              description={
                outcome === "missed"
                  ? undefined
                  : // D43: the browser is the phone — say what happens and
                    // where the voicemail/screening knobs live.
                    "Calls ring right here in the app; unanswered ones go to your voicemail and land in this log. Your greeting, call screening, and the missed-call text-back live in Settings › Calling."
              }
              action={
                outcome === "missed" ? undefined : (
                  <Button asChild variant="outline">
                    <Link href="/settings/missed-calls">Set up calls</Link>
                  </Button>
                )
              }
            />
          ) : (
            <>
              {rows.map((call) => (
                <CallRow key={call.id} call={call} />
              ))}
            </>
          )}
        </div>
        {calls.hasNextPage && (
          <div className="flex justify-center pt-3">
            <Button
              variant="ghost"
              onClick={() => calls.fetchNextPage()}
              disabled={calls.isFetchingNextPage}
            >
              {calls.isFetchingNextPage ? "Loading…" : "Load more"}
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}
