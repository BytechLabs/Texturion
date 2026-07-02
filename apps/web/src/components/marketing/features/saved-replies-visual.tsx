/**
 * Saved-replies picker visual (features track) — /features/templates-and-tags.
 *
 * A live-DOM render of the app's composer with the template picker open
 * (DESIGN.md G5: template picker, "/" also opens it inline). Shows real plumbing
 * saved replies — the ones that ship as the trade's pre-seeded pack (COPY §P
 * saved-replies pack) — so the "type /, tap, sent" claim is concrete. The first
 * template is keyboard-highlighted to read as a live picker.
 *
 * Server component — static DOM, matches the composer + popover tokens.
 */

import { CornerDownLeft, Slash } from "lucide-react";

import { cn } from "@/lib/utils";

interface Template {
  name: string;
  preview: string;
}

/** The plumbing pack that pre-seeds a new plumbing workspace (COPY §P). */
const TEMPLATES: Template[] = [
  { name: "On my way", preview: "On my way — should be with you in about 20…" },
  { name: "Photo request", preview: "Can you text us a photo of the problem, and…" },
  { name: "Quote follow-up", preview: "Hi, just checking you received our quote…" },
  { name: "Booking confirmation", preview: "You're booked for {day} between {time}…" },
  { name: "Job done", preview: "All done. We've cleared the line and tested…" },
];

export function SavedRepliesVisual({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "rounded-[10px] border border-border bg-card p-4 shadow-[0_24px_64px_-32px_rgba(28,25,23,0.25)]",
        className,
      )}
    >
      {/* Template popover — anchored above the composer, like the app's picker. */}
      <div className="overflow-hidden rounded-lg border border-border bg-popover shadow-lg">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-[12px] text-muted-foreground">
          <Slash className="size-3.5" strokeWidth={1.75} aria-hidden />
          Saved replies
          <span className="ml-auto tabular-nums">5 templates</span>
        </div>
        <ul className="max-h-[220px] py-1">
          {TEMPLATES.map((t, i) => (
            <li
              key={t.name}
              className={cn(
                "flex flex-col gap-0.5 px-3 py-2",
                i === 0 && "bg-accent",
              )}
            >
              <span className="text-[14px] font-medium text-foreground">
                {t.name}
              </span>
              <span className="truncate text-[12px] text-muted-foreground">
                {t.preview}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {/* Composer with the "/" typed to open the picker. */}
      <div className="mt-2 flex items-center gap-2 rounded-lg border border-input bg-background px-3 py-2">
        <span className="flex-1 text-[15px] text-foreground">
          /on
          <span className="ml-0.5 inline-block h-4 w-px animate-pulse bg-primary align-middle motion-reduce:animate-none" />
        </span>
        <span className="inline-flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-[12px] font-medium text-primary-foreground">
          Send
          <CornerDownLeft className="size-3" strokeWidth={2} aria-hidden />
        </span>
      </div>
      <p className="mt-2 px-1 text-[12px] text-muted-foreground">
        Type <span className="font-medium text-foreground">/</span> to open your
        saved replies. Pick one, send it in two taps.
      </p>
    </div>
  );
}
