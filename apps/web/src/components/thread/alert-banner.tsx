"use client";

import { BellRing } from "lucide-react";
import { toast } from "sonner";

import { ALERT_BANNER_COPY, alertTakenLine } from "@loonext/shared";

import { ApiError } from "@/lib/api/error";
import { useAcknowledgeAlert } from "@/lib/api/on-call";
import { cn } from "@/lib/utils";

/**
 * #244 — the strip on a thread nobody has picked up.
 *
 * Design notes, and the principles behind them:
 *
 * - **The point is the NAME.** "When everyone is notified, no one is
 *   accountable. An emergency call at midnight gets seen by four people who
 *   each assume another is handling it." This turns "somebody should call these
 *   people" into "I have this", visible to everybody else who opens the thread.
 *   *Applying: Prioritize Intent — the core action first, and there is exactly
 *   one.*
 *
 * - **It shows on every route into the thread, not just the notification's
 *   deep link.** The person best placed to claim it is often not the one who
 *   was paged — they are asleep, which is the whole reason this strip exists.
 *
 * - **It disappears the moment it is claimed.** A banner that lingers after
 *   somebody took it teaches the crew to ignore banners, and the timeline
 *   already records who took it. *Applying: Zen of Clarity.*
 *
 * - **No confirmation on the claim.** Taking responsibility for a callback is
 *   reversible by telling the crew, and the cost of a mis-tap is one person
 *   driving out unnecessarily — far cheaper than a dialog between a woken
 *   tradesperson and the job. *Applying: Ethical Friction, on the irreversible
 *   edge only.*
 */
export function AlertBanner({
  conversationId,
  alert,
  viewerId,
}: {
  conversationId: string;
  alert: {
    id: string;
    kind: string;
    on_call_user_id: string | null;
    /** Resolved server-side (#482) — a bare uuid is not worth reading. */
    on_call_name: string | null;
  } | null;
  viewerId: string | null;
}) {
  const acknowledge = useAcknowledgeAlert(conversationId);

  // Absent on nearly every thread, and reserving space for it would be a
  // permanent cost paid for a rare event.
  if (!alert) return null;

  async function claim() {
    if (!alert) return;
    try {
      const result = await acknowledge.mutateAsync(alert.id);
      // The second tapper learns a NAME rather than being told they claimed it
      // too — two people each believing they own it is the original failure
      // with extra steps.
      toast.success(
        result.outcome === "already_acknowledged"
          ? alertTakenLine("Somebody else")
          : ALERT_BANNER_COPY.yours,
      );
    } catch (cause) {
      toast.error(
        cause instanceof ApiError ? cause.message : "Could not claim that",
      );
    }
  }

  const paged = alert.on_call_user_id;
  const pagedName = alert.on_call_name;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 border-b border-app-line bg-app-tint px-4 py-2.5",
      )}
    >
      <BellRing
        className="size-4 shrink-0 text-app-olive-deep"
        strokeWidth={1.75}
        aria-hidden
      />
      <p className="flex-1 text-[13px] text-app-ink">
        {ALERT_BANNER_COPY.waiting}
        {pagedName && paged !== viewerId ? (
          <span className="text-app-muted-2"> · {pagedName} was told first</span>
        ) : null}
      </p>
      <button
        type="button"
        onClick={claim}
        disabled={acknowledge.isPending}
        className="tap-target rounded-app-input bg-app-ink px-3 py-1 text-[13px] font-semibold text-app-paper transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {ALERT_BANNER_COPY.claim}
      </button>
    </div>
  );
}
