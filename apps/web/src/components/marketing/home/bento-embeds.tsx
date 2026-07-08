/**
 * S6 bento anchor embeds (COPY-DECK v2 §S6): the real product patterns in
 * miniature, rendered with the APP'S OWN tokens (Law 2; every component here
 * must sit inside a PanelFrame's `.app-scope` region wrapped in <AppSurface>).
 * Marketing cobalt never appears in this file.
 *
 * Cell 1: assign and track — two conversation rows with the app's status
 *         pills and the assignee avatar (inbox/status-pill.tsx grammar).
 * Cell 2: internal notes — the app's amber locked note card.
 * Cell 3: saved replies — the "/" picker resting on the composer, the app's
 *         template-menu grammar.
 *
 * All static, no tab stops, no false affordances, nothing that pretends to be
 * live (Law 11): these are resting states, not activity.
 */

import { Lock, Slash } from "lucide-react";

import {
  DemoAvatar,
  DemoStatusPill,
} from "@/components/marketing/thread-demo/thread-primitives";

/** Cell 1: one owner and one status per conversation, at a glance. */
export function AssignTrackEmbed() {
  return (
    <div className="flex flex-col gap-1 p-3">
      <div className="flex items-center gap-2.5 rounded-app-card bg-app-tint/60 px-3 py-2.5">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold text-app-ink">
            Karen M
          </span>
          <span className="block truncate text-[12px] text-app-muted">
            Tomorrow between 9 and 11 works
          </span>
        </span>
        <DemoStatusPill status="waiting" />
        <DemoAvatar name="Dale" className="size-6 text-[10px]" />
      </div>
      <div className="flex items-center gap-2.5 rounded-app-card px-3 py-2.5">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold text-app-ink">
            Theo B
          </span>
          <span className="block truncate text-[12px] text-app-muted">
            Is he coming today?
          </span>
        </span>
        <DemoStatusPill status="new" />
      </div>
      <div className="flex items-center gap-2.5 rounded-app-card px-3 py-2.5">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold text-app-ink">
            Morgan W
          </span>
          <span className="block truncate text-[12px] text-app-muted">
            All done, invoice when ready
          </span>
        </span>
        <DemoStatusPill status="closed" />
        <DemoAvatar name="Priya" className="size-6 text-[10px]" />
      </div>
    </div>
  );
}

/** Cell 2: the amber locked note, marked and never sent to the customer. */
export function NotesEmbed() {
  return (
    <div className="p-3">
      <div className="rounded-app-bub border border-app-amber-line bg-app-amber-bg px-3.5 py-2.5 text-[13px] leading-[1.5] text-app-amber-ink [border-bottom-right-radius:5px]">
        <span className="mb-1 flex items-center gap-1 text-[11px] font-semibold text-app-amber">
          <Lock className="size-3" strokeWidth={1.75} aria-hidden />
          Internal note · Priya
        </span>
        Sounds like the Navien on Delaware Ave. Dale, you&apos;re two streets
        over this afternoon
      </div>
      <p className="mt-1.5 text-right text-[11px] text-app-muted-2">
        Only your team sees this
      </p>
    </div>
  );
}

/** Cell 3: the "/" saved-reply picker resting on the composer. */
export function SavedRepliesEmbed() {
  return (
    <div className="p-3">
      <div className="rounded-app-card border border-app-line bg-app-white p-1.5">
        <div className="flex flex-col gap-0.5">
          <div className="rounded-app-ctrl bg-app-tint px-2.5 py-1.5">
            <span className="block text-[12.5px] font-semibold text-app-ink">
              On my way
            </span>
            <span className="block truncate text-[11.5px] text-app-muted">
              On my way. Should be with you in about 20 minutes.
            </span>
          </div>
          <div className="rounded-app-ctrl px-2.5 py-1.5">
            <span className="block text-[12.5px] font-semibold text-app-ink">
              Quote follow-up
            </span>
            <span className="block truncate text-[11.5px] text-app-muted">
              Hi {"{first_name}"}, checking in on the quote we sent over.
            </span>
          </div>
          <div className="rounded-app-ctrl px-2.5 py-1.5">
            <span className="block text-[12.5px] font-semibold text-app-ink">
              Booking confirmation
            </span>
            <span className="block truncate text-[11.5px] text-app-muted">
              You&apos;re booked. We&apos;ll text you when we&apos;re on the
              way.
            </span>
          </div>
        </div>
      </div>
      <div className="mt-2 flex items-center gap-2 rounded-app-ctrl border border-app-line bg-app-white px-3 py-2">
        <Slash className="size-3.5 shrink-0 text-app-muted-2" strokeWidth={1.75} aria-hidden />
        <span className="text-[13px] text-app-muted-2">
          Type / for saved replies
        </span>
      </div>
    </div>
  );
}
