/**
 * Inbox-list visual (features track), the shared-inbox flagship product visual.
 *
 * A live-DOM render of the app's conversation list (DESIGN.md G4 row anatomy):
 * unread dot, contact name/number, one-line snippet, relative time, assignee
 * avatar, status pill. It shows the whole point of a SHARED inbox, many
 * conversations, different owners, different statuses, all visible to the crew
 * at once, using the same seed company (Reyes Plumbing) and the same tokens as
 * the thread primitives, so the two visual sets are identical (BLUEPRINT §1.3).
 *
 * Server component, pure DOM, no interactivity, part of the static render.
 */

import { StickyNote } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  DemoAvatar,
  DemoStatusPill,
} from "@/components/marketing/thread-demo/thread-primitives";

interface Row {
  name: string;
  number: string;
  snippet: string;
  time: string;
  status: "new" | "open" | "waiting" | "closed";
  assignee?: string;
  unread?: boolean;
  outbound?: boolean;
  note?: boolean;
}

/** Seed rows. Reyes Plumbing crew (Priya/Dale/Marcus), 555-01XX safe range. */
const ROWS: Row[] = [
  {
    name: "Karen M",
    number: "(416) 555-0187",
    snippet: "Tomorrow 9–11 works. Thank you so much",
    time: "2m",
    status: "waiting",
    assignee: "Dale",
    unread: true,
  },
  {
    name: "Nguyen family",
    number: "(647) 555-0143",
    snippet: "You: Here's the quote for the water heater swap ,",
    time: "18m",
    status: "open",
    assignee: "Priya",
    outbound: true,
  },
  {
    name: "Marcus T",
    number: "(647) 555-0121",
    snippet: "Basement floor drain is backing up again",
    time: "1h",
    status: "new",
    unread: true,
  },
  {
    name: "The Hendersons",
    number: "(416) 555-0166",
    snippet: "Gate code is 4482, dog is friendly",
    time: "3h",
    status: "open",
    assignee: "Marcus",
    note: true,
  },
  {
    name: "Rivera, D.",
    number: "(905) 555-0109",
    snippet: "You: All done, you're good to run the washer.",
    time: "Tue",
    status: "closed",
    assignee: "Dale",
    outbound: true,
  },
];

function Row({ row }: { row: Row }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <span
        className={cn(
          "size-2 shrink-0 rounded-full",
          row.unread ? "bg-[color:var(--porch-amber)]" : "bg-transparent",
        )}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p
            className={cn(
              "truncate text-[14px] text-[color:var(--day-ink)]",
              row.unread ? "font-semibold" : "font-medium",
            )}
          >
            {row.name}
          </p>
          <span className="shrink-0 text-[11px] tabular-nums text-[color:var(--ink-55)]">
            {row.number}
          </span>
        </div>
        <p className="mt-0.5 flex items-center gap-1 truncate text-[13px] text-[color:var(--ink-55)]">
          {row.note && (
            <StickyNote
              className="size-3 shrink-0 text-[color:var(--ink-55)]"
              strokeWidth={1.75}
              aria-hidden
            />
          )}
          {row.snippet}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <span className="text-[11px] tabular-nums text-[color:var(--ink-55)]">
          {row.time}
        </span>
        <div className="flex items-center gap-1.5">
          {row.assignee && (
            <DemoAvatar name={row.assignee} className="size-[18px]" />
          )}
          <DemoStatusPill status={row.status} />
        </div>
      </div>
    </div>
  );
}

export function InboxListVisual({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-[10px] border border-[color:var(--hairline)] bg-white shadow-[0_24px_64px_-32px_rgba(28,25,23,0.25)]",
        className,
      )}
    >
      {/* Browser-chrome hint, "it's just the web" (BLUEPRINT §1.3). */}
      <div className="flex items-center gap-2 border-b border-[color:var(--hairline)] bg-[color:var(--paper-2)] px-3 py-2">
        <div className="flex gap-1.5" aria-hidden>
          <span className="size-2.5 rounded-full bg-[rgba(11,43,38,0.18)]" />
          <span className="size-2.5 rounded-full bg-[rgba(11,43,38,0.18)]" />
          <span className="size-2.5 rounded-full bg-[rgba(11,43,38,0.18)]" />
        </div>
        {/* --ink-55 (4.9:1 on white) so this quiet URL hint clears WCAG AA and
            reads petrol-cast, matching the corrected thread-frame.tsx primitive.
            A muted chrome hint, not body text. */}
        <div className="mx-auto flex max-w-[60%] items-center rounded-md bg-white px-3 py-0.5 text-[11px] text-[color:var(--ink-55)]">
          loonext.app/inbox
        </div>
      </div>

      {/* Filter segments, matches G4 "Open | Mine | All | Closed". */}
      <div className="flex items-center gap-1 border-b border-[color:var(--hairline)] px-3 py-2">
        {["Open", "Mine", "All", "Closed"].map((seg, i) => (
          <span
            key={seg}
            className={cn(
              "rounded-md px-2.5 py-1 text-[12px] font-medium",
              i === 0
                ? "bg-[#F0F4F2] text-[color:var(--day-ink)]"
                : "text-[color:var(--ink-55)]",
            )}
          >
            {seg}
          </span>
        ))}
        <span className="ml-auto text-[12px] text-[color:var(--ink-55)]">
          3 open · 1 waiting
        </span>
      </div>

      <div className="divide-y divide-[color:var(--hairline)]">
        {ROWS.map((row) => (
          <Row key={row.number} row={row} />
        ))}
      </div>
    </div>
  );
}
