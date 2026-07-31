/**
 * Contact-timeline embed (features crew), the /features/contacts product
 * visual: one customer's history with texts, a call and a voicemail mixed into
 * a single time-ordered stream (#491).
 *
 * THE MIXING IS THE POINT (D99). Three separate lists a person merges by eye
 * is not a history; a screenshot showing only messages would have illustrated
 * the problem rather than the fix. So the entries deliberately alternate
 * channel, and the year labels are far enough apart to show that this spans
 * conversations rather than sitting inside one.
 *
 * Law 2 (DESIGN-DIRECTION v4): PRODUCT content, so every colour is an APP
 * token and it must be mounted inside <PanelFrame>. Marketing cobalt never
 * appears here.
 *
 * Server component, pure DOM, no interactivity. Reyes Plumbing seed data.
 */

import { CheckSquare, MessageSquare, Phone, Voicemail } from "lucide-react";

import { cn } from "@/lib/utils";

type Kind = "text" | "call" | "voicemail" | "task";

interface Entry {
  kind: Kind;
  when: string;
  body: string;
}

const ENTRIES: Entry[] = [
  { kind: "text", when: "Mar 2026", body: "New tap for the ensuite, quoted $340" },
  { kind: "task", when: "Oct 2025", body: "Furnace service, done by Dale" },
  { kind: "voicemail", when: "Oct 2025", body: "“It is making that noise again”" },
  { kind: "call", when: "Aug 2024", body: "12 minutes, Priya, booked the install" },
  { kind: "text", when: "Aug 2024", body: "Photo of the old unit" },
];

const ICONS: Record<Kind, typeof Phone> = {
  text: MessageSquare,
  call: Phone,
  voicemail: Voicemail,
  task: CheckSquare,
};

export function ContactTimelineVisual({ className }: { className?: string }) {
  return (
    <div className={cn("p-3 sm:p-4", className)}>
      {/* The identity line: who, where, and the crew-only note. */}
      <div className="flex items-center gap-[11px]">
        <span
          aria-hidden
          className="grid size-[38px] shrink-0 place-items-center rounded-xl bg-app-tint text-[13px] font-semibold text-app-olive-deep"
        >
          KM
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-semibold text-app-ink">
            Karen Mullins
          </span>
          <span className="block truncate text-[12px] text-app-muted">
            41 Warbler Lane · dog in the crate, key under the mat
          </span>
        </span>
      </div>

      <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.07em] text-app-muted-2">
        History
      </p>

      <div className="mt-2 space-y-0">
        {ENTRIES.map((entry, i) => {
          const Icon = ICONS[entry.kind];
          return (
            <div key={`${entry.when}-${entry.body}`} className="flex gap-2.5">
              {/* The rail: a dot per entry, joined by a hairline, so the
                  entries read as one stream rather than a list of cards. */}
              <div className="flex flex-col items-center">
                <span
                  aria-hidden
                  className="mt-1.5 grid size-[18px] shrink-0 place-items-center rounded-full border border-app-line bg-app-ground text-app-muted-2"
                >
                  <Icon className="size-2.5" strokeWidth={2} />
                </span>
                {i < ENTRIES.length - 1 && (
                  <span
                    aria-hidden
                    className="w-px flex-1 bg-app-line"
                  />
                )}
              </div>
              <div className="min-w-0 flex-1 pb-3">
                <p className="text-[12.5px] leading-[1.4] text-app-ink">
                  {entry.body}
                </p>
                <p className="mt-0.5 text-[11px] tabular-nums text-app-muted-2">
                  {entry.when}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
