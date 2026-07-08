/**
 * Tags + done-mark embed (features crew), /features/templates-and-tags.
 *
 * Two real app behaviors in one embed:
 *  1. The pre-seeded sell-pipeline tags (Quote sent → Scheduled → Won /
 *     Lost) drawn with the real TagChip anatomy (conversation-row.tsx: the
 *     applied tag is the tinted emphasis chip, the rest are quiet chips).
 *  2. The D14 done-mark: tap any message to check it off, drawn exactly as
 *     the thread does it (message-bubble.tsx: strikethrough at 55% opacity,
 *     the petrol check badge, "Done · Priya · 2:14 PM").
 *
 * Law 2: PRODUCT content, app tokens only; mount inside <PanelFrame>.
 * Server component, static DOM.
 */

import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

const PIPELINE = ["Quote sent", "Scheduled", "Won", "Lost"] as const;

export function TagsDoneVisual({ className }: { className?: string }) {
  return (
    <div className={cn("space-y-4 p-4 sm:p-5", className)}>
      {/* Pipeline tag chips, the real TagChip anatomy. */}
      <div className="rounded-app-card border border-app-line bg-app-white p-4">
        <p className="text-[13px] font-medium text-app-muted">
          Tags on this conversation
        </p>
        <div className="mt-2.5 flex flex-wrap gap-[5px]">
          {PIPELINE.map((tag, i) => (
            <span
              key={tag}
              className={cn(
                "inline-flex items-center rounded-full border px-2 py-[2.5px] text-[11px] font-semibold leading-none",
                i === 1
                  ? "border-app-tint-line bg-app-tint text-app-petrol-deep"
                  : "border-transparent bg-app-line-soft text-app-muted",
              )}
            >
              {tag}
            </span>
          ))}
        </div>
        <p className="mt-2.5 text-[12px] text-app-muted">
          Scheduled is applied. Rename any of them to match how you sell.
        </p>
      </div>

      {/* Done-mark on a message: strikethrough + the petrol check badge. */}
      <div className="rounded-app-card border border-app-line bg-app-white p-4">
        <p className="text-[13px] font-medium text-app-muted">
          Mark a text done
        </p>
        <div className="mt-2.5 space-y-1.5">
          <div className="flex items-start gap-2">
            <span
              className="mt-1 flex size-4 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"
              aria-hidden
            >
              <Check className="size-2.5" strokeWidth={3} />
            </span>
            <div className="max-w-[85%] rounded-app-bub border border-app-line bg-app-white px-3.5 py-2.5 [border-top-left-radius:5px]">
              <p className="text-[14px] leading-normal text-app-ink line-through opacity-55">
                Can you send someone to look at the water heater this week?
              </p>
            </div>
          </div>
          <p className="pl-6 text-[11px] text-app-muted-2">
            Done · Priya · 2:14 PM
          </p>
        </div>
        <p className="mt-2.5 text-[12px] text-app-muted">
          Checked off right in the thread. The whole crew sees it&apos;s
          handled.
        </p>
      </div>
    </div>
  );
}
