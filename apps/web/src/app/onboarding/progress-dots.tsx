import { cn } from "@/lib/utils";

/**
 * G7 progress dots: current step filled petrol, done steps tinted, upcoming
 * outlined. Screen readers get the position as text instead of dots (G11).
 *
 * #381 — THE ACCOUNT COUNTS. Anyone seeing these has already created an
 * account, and that step was uncredited: the first wizard screen read "Step 1
 * of 5", which announces five things still to do rather than one thing already
 * done. So a completed dot for the account leads the row, and the label counts
 * it.
 *
 * This is crediting a real action, not manufacturing progress — the account
 * exists, the user made it, and the bar would otherwise be telling them less
 * than the truth in the direction that discourages them.
 * *Applying: the Goal Gradient Effect — effort rises with perceived proximity
 * to the goal, so a bar that starts at the true non-zero point is both more
 * honest and more motivating than one that resets at the door.*
 */
export function ProgressDots({
  index,
  total,
}: {
  /** 1-based position within the applicable steps. */
  index: number;
  total: number;
}) {
  // The account is a real completed step, so it shifts both numbers by one.
  const shownIndex = index + 1;
  const shownTotal = total + 1;
  return (
    <div
      role="img"
      aria-label={`Step ${shownIndex} of ${shownTotal}`}
      className="flex items-center gap-2"
    >
      {Array.from({ length: shownTotal }, (_, i) => (
        <span
          key={i}
          className={cn(
            "size-2 rounded-full transition-colors duration-150 ease-out",
            i + 1 === shownIndex
              ? "bg-primary"
              : i + 1 < shownIndex
                ? "bg-primary/40"
                : "border border-border bg-transparent",
          )}
        />
      ))}
    </div>
  );
}
