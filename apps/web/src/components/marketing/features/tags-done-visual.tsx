/**
 * Tags + done-mark visual (features track), /features/templates-and-tags.
 *
 * Two live-DOM proofs in one card:
 *  1. The pre-seeded sell pipeline tags (Quote sent → Scheduled → Won / Lost,
 *     COPY §H6) rendered as the app's tag chips, editable to fit how you sell.
 *  2. The D14 "mark a text done" behavior: tap any message to check it off,
 *     right in the thread, rendered as a strikethrough message + a petrol
 *     check, described accurately as a per-MESSAGE done-mark (NOT a job or a
 *     separate to-do app, per BLUEPRINT §4 templates-and-tags honesty rule).
 *
 * Server component, static DOM, matches the tag-chip + message tokens.
 */

import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

const PIPELINE = ["Quote sent", "Scheduled", "Won", "Lost"] as const;

export function TagsDoneVisual({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "space-y-4 rounded-[10px] border border-border bg-card p-5 shadow-[0_24px_64px_-32px_rgba(28,25,23,0.25)]",
        className,
      )}
    >
      {/* Pipeline tag chips. */}
      <div>
        <p className="text-[13px] font-medium text-muted-foreground">
          Tags on this conversation
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {PIPELINE.map((tag, i) => (
            <span
              key={tag}
              className={cn(
                "rounded-full px-2.5 py-1 text-[12px] font-medium",
                i === 1
                  ? "bg-primary/10 text-teal-800 dark:bg-primary/15 dark:text-primary"
                  : "border border-dashed border-border text-muted-foreground",
              )}
            >
              {tag}
            </span>
          ))}
        </div>
        <p className="mt-2 text-[12px] text-muted-foreground">
          Scheduled is applied. The rest are one tap, rename them to match how
          you sell.
        </p>
      </div>

      <hr className="border-border" />

      {/* Done-mark on a message (D14). Struck-through + petrol check. */}
      <div>
        <p className="text-[13px] font-medium text-muted-foreground">
          Mark a text done
        </p>
        <div className="mt-2 space-y-2">
          <div className="flex items-start gap-2">
            <span
              className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"
              aria-hidden
            >
              <Check className="size-2.5" strokeWidth={3} />
            </span>
            <div className="max-w-[85%] rounded-[10px] border border-border bg-card px-3 py-2">
              <p className="text-[14px] leading-normal text-muted-foreground line-through decoration-muted-foreground/50">
                Can you send someone to look at the water heater this week?
              </p>
            </div>
          </div>
          <p className="pl-6 text-[11px] text-muted-foreground">
            Done · Priya · 2:14 PM
          </p>
        </div>
        <p className="mt-2 text-[12px] text-muted-foreground">
          Checked off right in the thread, the whole crew sees it&apos;s
          handled. No separate to-do app.
        </p>
      </div>
    </div>
  );
}
