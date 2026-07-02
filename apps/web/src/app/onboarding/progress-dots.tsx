import { cn } from "@/lib/utils";

/**
 * G7 progress dots: current step filled petrol, done steps tinted, upcoming
 * outlined. Screen readers get the position as text instead of dots (G11).
 */
export function ProgressDots({
  index,
  total,
}: {
  /** 1-based position within the applicable steps. */
  index: number;
  total: number;
}) {
  return (
    <div
      role="img"
      aria-label={`Step ${index} of ${total}`}
      className="flex items-center gap-2"
    >
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={cn(
            "size-2 rounded-full transition-colors duration-150 ease-out",
            i + 1 === index
              ? "bg-primary"
              : i + 1 < index
                ? "bg-primary/40"
                : "border border-border bg-transparent",
          )}
        />
      ))}
    </div>
  );
}
