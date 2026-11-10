"use client";

import { ListFilter } from "lucide-react";
import { forwardRef } from "react";

import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/provider";
import { cn } from "@/lib/utils";

/**
 * #711: the Filter button every list puts beside its Views menu. It opens the
 * list's own filter popover and says how many filters are on.
 *
 * The count is read out rather than hidden, so the button's visible words stay
 * inside its accessible name (WCAG 2.5.3).
 */
export const FilterButton = forwardRef<
  HTMLButtonElement,
  React.ComponentProps<typeof Button> & {
    /** Filters applied now; the badge hides at zero. */
    count: number;
    /** An icon button for a narrow list column; the label shows otherwise. */
    compact?: boolean;
  }
>(function FilterButton({ count, compact = false, className, ...props }, ref) {
  const t = useT();
  const compactName =
    count > 0 ? t("inbox.filterActionCount", { count }) : t("inbox.filterAction");
  return (
    <Button
      ref={ref}
      type="button"
      variant="ghost"
      size={compact ? "icon-sm" : "sm"}
      aria-label={compact ? compactName : undefined}
      title={compact ? compactName : undefined}
      className={cn(
        "relative shrink-0 text-muted-foreground",
        count > 0 && "text-app-ink",
        className,
      )}
      {...props}
    >
      <ListFilter className="size-4" strokeWidth={1.75} aria-hidden />
      {!compact && t("inbox.filterAction")}
      {count > 0 && (
        <>
          {!compact && " "}
          <span
            className={cn(
              "grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] font-semibold tabular-nums text-primary-foreground",
              compact && "absolute -right-0.5 -top-0.5",
            )}
          >
            {count}
          </span>
        </>
      )}
    </Button>
  );
});
