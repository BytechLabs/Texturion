import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * #733: the one loading skeleton for a list. Rows of an optional avatar and one
 * or two lines, pulsing where the content will land so the page does not
 * reflow. First load only, never on a realtime update. Pass `label` when the
 * loading state should be announced; otherwise it is hidden from assistive
 * tech. Space and flex it from outside with `className`.
 *
 * A skeleton shaped like a grid, a board or a thread is not a list and keeps
 * its own markup.
 */
export function ListSkeleton({
  rows,
  avatar = false,
  lines = 1,
  label,
  className,
}: {
  rows: number;
  avatar?: boolean;
  lines?: 1 | 2;
  label?: string;
  className?: string;
}) {
  return (
    <div
      role={label ? "status" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn("space-y-3", className)}
    >
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-3">
          {avatar && <Skeleton className="size-9 shrink-0 rounded-xl" />}
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-3.5 w-40 max-w-full" />
            {lines === 2 && <Skeleton className="h-3 w-24 max-w-full" />}
          </div>
        </div>
      ))}
    </div>
  );
}
