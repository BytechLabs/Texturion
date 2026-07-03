import { cn } from "@/lib/utils";

/**
 * The APP-UI-ELEVATION §5 "kind empty state" for the calm surfaces (contacts,
 * settings): one warm human line + at most one petrol action, centered, with
 * generous air — never a generic "No data," never a stock illustration (§1
 * Don't). An optional quiet icon sets a gentle tone; the headline carries the
 * one warm sentence; a single `action` slot holds the lone next step.
 *
 * Not for the inbox activation moment (that is the number-reveal peak, owned by
 * the inbox track in components/inbox/empty-states.tsx) — this is the quieter
 * everyday zero-state used across the editorial-whitespace screens.
 */
export function CalmEmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  /** A quiet lucide icon, ~28px, muted — optional and decorative. */
  icon?: React.ReactNode;
  /** The one warm sentence, near-black, the reader's anchor. */
  title: string;
  /** Optional plain second line in secondary body (AA-safe — it's essential). */
  description?: string;
  /** At most one action — the single petrol (or ghost) next step. */
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        // Editorial whitespace: the zero-state breathes (§2.3).
        "flex flex-col items-center justify-center gap-3 px-6 py-14 text-center",
        className,
      )}
    >
      {icon ? (
        <div
          aria-hidden
          className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground [&_svg]:size-6"
        >
          {icon}
        </div>
      ) : null}
      <div className="space-y-1.5">
        <p className="text-[15px] font-medium text-foreground">{title}</p>
        {description ? (
          <p className="mx-auto max-w-xs text-sm text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {action ? <div className="pt-1">{action}</div> : null}
    </div>
  );
}
