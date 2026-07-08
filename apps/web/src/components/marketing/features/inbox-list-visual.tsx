/**
 * Inbox-list embed (features crew), the /features/shared-inbox flagship
 * product visual: the app's conversation list staged MID-TASK, with the
 * assign menu open over the newest conversation (coverage map: "the real
 * inbox staged mid-task (assign + status change)").
 *
 * Law 2 (DESIGN-DIRECTION v4): this is PRODUCT content, so every color is an
 * APP token (bg-primary, app-tint, app-line, app-muted...), and it must be
 * mounted inside <PanelFrame> (which provides the `.app-scope` token region).
 * Marketing cobalt never appears in here. The anatomy mirrors the real
 * ConversationRow (components/inbox/conversation-row.tsx: 38px tinted
 * avatar, name + 2-line snippet + tabular time, unread petrol dot, tag and
 * assignee chips) and the real FilterBar segments (Open | Mine | All |
 * Closed with the quiet open count).
 *
 * Server component, pure DOM, no interactivity. Reyes Plumbing seed data,
 * 555-01XX safe fictional range.
 */

import { Check, Lock } from "lucide-react";

import { cn } from "@/lib/utils";

interface Row {
  name: string;
  initials: string;
  snippet: string;
  time: string;
  unread?: boolean;
  noteSnippet?: boolean;
  tag?: string;
  assignee?: string;
}

/** Seed rows: the Reyes Plumbing crew (Priya/Dale/Marcus) mid-morning. */
const ROWS: Row[] = [
  {
    name: "Marcus T",
    initials: "MT",
    snippet: "Basement floor drain is backing up again",
    time: "2m",
    unread: true,
  },
  {
    name: "Karen M",
    initials: "KM",
    snippet: "Tomorrow between 9 and 11 works. Thank you so much",
    time: "18m",
    tag: "Scheduled",
    assignee: "D",
  },
  {
    name: "Nguyen family",
    initials: "NF",
    snippet: "You: Here's the quote for the water heater swap",
    time: "1h",
    tag: "Quote sent",
    assignee: "P",
  },
  {
    name: "The Hendersons",
    initials: "TH",
    snippet: "Gate code is 4482, dog is friendly",
    time: "3h",
    noteSnippet: true,
    assignee: "M",
  },
  {
    name: "Rivera, D.",
    initials: "RD",
    snippet: "You: All done, you're good to run the washer.",
    time: "Tue",
    assignee: "D",
  },
];

/** The real inbox segments (FilterBar): a pill track, selected tab lifted. */
function Segments() {
  return (
    <div className="flex gap-0.5 rounded-full bg-app-line-soft p-[3px]">
      {["Open", "Mine", "All", "Closed"].map((label, i) => (
        <span
          key={label}
          className={cn(
            "flex flex-1 items-center justify-center gap-1.5 rounded-full px-3 py-1 text-[12.5px]",
            i === 0
              ? "bg-app-white font-semibold text-app-ink"
              : "font-medium text-app-muted",
          )}
        >
          {label}
          {i === 0 && (
            <span className="grid h-4 min-w-4 place-items-center rounded-full bg-app-line-soft px-1 text-[10.5px] font-semibold tabular-nums text-app-muted">
              3
            </span>
          )}
        </span>
      ))}
    </div>
  );
}

function InboxRow({ row, active }: { row: Row; active?: boolean }) {
  return (
    <div
      className={cn(
        "relative flex items-start gap-[11px] rounded-app-card border p-[11px]",
        active ? "border-app-line bg-app-white" : "border-transparent",
      )}
    >
      {/* Tinted-initial avatar (ConversationRow anatomy). */}
      <span
        aria-hidden
        className="grid size-[38px] shrink-0 place-items-center rounded-xl bg-app-tint text-[13px] font-semibold text-app-petrol-deep"
      >
        {row.initials}
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span
            className={cn(
              "truncate text-[14px] text-app-ink",
              row.unread ? "font-semibold" : "font-medium",
            )}
          >
            {row.name}
          </span>
          <span className="shrink-0 text-[11.5px] tabular-nums text-app-muted-2">
            {row.time}
          </span>
        </span>

        <span className="mt-[3px] flex items-start gap-1 text-[12.5px] leading-[1.45] text-app-muted">
          {row.noteSnippet && (
            <Lock
              className="mt-0.5 size-3 shrink-0 text-app-amber"
              strokeWidth={1.75}
              aria-hidden
            />
          )}
          <span className="line-clamp-1 min-w-0 break-words">{row.snippet}</span>
        </span>

        {(row.tag || row.assignee) && (
          <span className="mt-[7px] flex flex-wrap items-center gap-[5px]">
            {row.tag && (
              <span className="inline-flex items-center rounded-full border border-app-tint-line bg-app-tint px-2 py-[2.5px] text-[11px] font-semibold leading-none text-app-petrol-deep">
                {row.tag}
              </span>
            )}
            {row.assignee && (
              <span className="inline-flex items-center gap-1 rounded-full border border-app-line bg-app-stone-0 px-2 py-[2.5px] text-[11px] font-semibold leading-none text-app-muted">
                {row.assignee}
              </span>
            )}
          </span>
        )}
      </span>

      {/* Unread petrol dot, top-right. */}
      {row.unread && (
        <span
          aria-hidden
          className="absolute right-3 top-[14px] size-2 rounded-full bg-primary"
        />
      )}
    </div>
  );
}

/**
 * The mid-task moment: the assign menu open over the new conversation, with
 * Dale about to get it (one owner, no double replies).
 */
function AssignMenu() {
  const members = ["Priya R", "Dale K", "Marcus O"];
  return (
    <div className="absolute right-3 top-[4.25rem] z-10 w-44 rounded-app-card border border-app-line bg-popover p-1 shadow-[var(--app-sh-float)]">
      <p className="px-2 pb-1 pt-1.5 text-[11px] font-semibold text-app-muted-2">
        Assign to
      </p>
      {members.map((member) => (
        <span
          key={member}
          className={cn(
            "flex items-center justify-between rounded-app-ctrl px-2 py-1.5 text-[13px]",
            member === "Dale K"
              ? "bg-app-tint font-medium text-app-petrol-deep"
              : "text-app-ink",
          )}
        >
          {member}
          {member === "Dale K" && (
            <Check className="size-3.5" strokeWidth={2.5} aria-hidden />
          )}
        </span>
      ))}
    </div>
  );
}

export function InboxListVisual({ className }: { className?: string }) {
  return (
    <div className={cn("relative p-3 sm:p-4", className)}>
      <Segments />
      <AssignMenu />
      <div className="mt-2.5 space-y-0.5">
        {ROWS.map((row, i) => (
          <InboxRow key={row.name} row={row} active={i === 0} />
        ))}
      </div>
    </div>
  );
}
