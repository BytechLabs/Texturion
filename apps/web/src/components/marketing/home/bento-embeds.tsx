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

import { homeCopy, type HomeCopy } from "@/i18n/marketing/home";
import type { MarketingLocale } from "@/i18n/marketing/footer";
import { Lock, Slash } from "lucide-react";

import {
  DemoAvatar,
  DemoStatusPill,
} from "@/components/marketing/thread-demo/thread-primitives";

/**
 * The demo customers and teammates. Names, not copy: they read the same in
 * both languages, and translating a person is not a thing. They live in a
 * constant so no bilingual file holds a bare literal.
 */
const PEOPLE = {
  karen: "Karen M",
  theo: "Theo B",
  morgan: "Morgan W",
  dale: "Dale",
  priya: "Priya",
} as const;

/** Cell 1: one owner and one status per conversation, at a glance. */
export function AssignTrackEmbed({
  locale = "en",
}: {
  locale?: MarketingLocale;
} = {}) {
  const copy = homeCopy(locale);
  return (
    <div className="flex flex-col gap-1 p-3">
      <div className="flex items-center gap-2.5 rounded-app-card bg-app-tint/60 px-3 py-2.5">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold text-app-ink">
            {PEOPLE.karen}
          </span>
          <span className="block truncate text-[12px] text-app-muted">
            {copy.embedTomorrow}
          </span>
        </span>
        <DemoStatusPill status="waiting" />
        <DemoAvatar name={PEOPLE.dale} className="size-6 text-[10px]" />
      </div>
      <div className="flex items-center gap-2.5 rounded-app-card px-3 py-2.5">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold text-app-ink">
            {PEOPLE.theo}
          </span>
          <span className="block truncate text-[12px] text-app-muted">
            {copy.embedComingToday}
          </span>
        </span>
        <DemoStatusPill status="new" />
      </div>
      <div className="flex items-center gap-2.5 rounded-app-card px-3 py-2.5">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold text-app-ink">
            {PEOPLE.morgan}
          </span>
          <span className="block truncate text-[12px] text-app-muted">
            {copy.embedAllDone}
          </span>
        </span>
        <DemoStatusPill status="closed" />
        <DemoAvatar name={PEOPLE.priya} className="size-6 text-[10px]" />
      </div>
    </div>
  );
}

/** Cell 2: the amber locked note, marked and never sent to the customer. */
export function NotesEmbed({
  locale = "en",
}: {
  locale?: MarketingLocale;
} = {}) {
  const copy = homeCopy(locale);
  return (
    <div className="p-3">
      <div className="rounded-app-bub border border-app-amber-line bg-app-amber-bg px-3.5 py-2.5 text-[13px] leading-[1.5] text-app-amber-ink [border-bottom-right-radius:5px]">
        {/* #320: this label read `text-app-amber`, which is the MARK colour —
            11px semibold at 2.66:1 on the note fill. The ink is the text
            colour, and it was sitting right there on the parent. */}
        <span className="mb-1 flex items-center gap-1 text-[11px] font-semibold text-app-amber-ink">
          <Lock className="size-3 text-app-amber" strokeWidth={1.75} aria-hidden />
          {copy.embedNoteLabel}
        </span>
        {copy.embedNoteBody}
      </div>
      <p className="mt-1.5 text-right text-[11px] text-app-muted-2">
        {copy.embedNoteOnlyTeam}
      </p>
    </div>
  );
}

/** Cell 3: the "/" saved-reply picker resting on the composer. */
export function SavedRepliesEmbed({
  locale = "en",
}: {
  locale?: MarketingLocale;
} = {}) {
  const copy = homeCopy(locale);
  return (
    <div className="p-3">
      <div className="rounded-app-card border border-app-line bg-app-paper p-1.5">
        <div className="flex flex-col gap-0.5">
          <div className="rounded-app-ctrl bg-app-tint px-2.5 py-1.5">
            <span className="block text-[12.5px] font-semibold text-app-ink">
              {copy.embedTemplateOnMyWay}
            </span>
            <span className="block truncate text-[11.5px] text-app-muted">
              {copy.embedTemplateOnMyWayBody}
            </span>
          </div>
          <div className="rounded-app-ctrl px-2.5 py-1.5">
            <span className="block text-[12.5px] font-semibold text-app-ink">
              {copy.embedTemplateFollowUp}
            </span>
            <span className="block truncate text-[11.5px] text-app-muted">
              {copy.embedTemplateFollowUpBefore} {"{first_name}"}
              {copy.embedTemplateFollowUpAfter}
            </span>
          </div>
          <div className="rounded-app-ctrl px-2.5 py-1.5">
            <span className="block text-[12.5px] font-semibold text-app-ink">
              {copy.embedTemplateBooking}
            </span>
            <span className="block truncate text-[11.5px] text-app-muted">
              {copy.embedTemplateBookingBody}
            </span>
          </div>
        </div>
      </div>
      <div className="mt-2 flex items-center gap-2 rounded-app-ctrl border border-app-line bg-app-paper px-3 py-2">
        <Slash className="size-3.5 shrink-0 text-app-muted-2" strokeWidth={1.75} aria-hidden />
        <span className="text-[13px] text-app-muted-2">
          Type / for saved replies
        </span>
      </div>
    </div>
  );
}
