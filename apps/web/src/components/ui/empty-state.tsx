import { cn } from "@/lib/utils";

/**
 * #733: the one empty state. A quiet icon in a disc, one warm line, an optional
 * second line, and at most one outline action, centred with room to breathe.
 * Never "No data", never an illustration (APP-UI-ELEVATION §5).
 *
 * `page` fills a page or a list area; `panel` sits inside a card or a side
 * pane. Not for the inbox's activation moment, which is its own peak
 * (`components/inbox/empty-states.tsx`).
 *
 * `empty-state.test.ts` fails on a hand-rolled centred empty column elsewhere.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  size = "page",
  className,
}: {
  /** A lucide icon, drawn muted at 20px in a disc; decorative. */
  icon?: React.ReactNode;
  /** The one sentence a person reads first. */
  title: string;
  /** An optional plain second line. */
  description?: React.ReactNode;
  /** At most one next step, an outline button. */
  action?: React.ReactNode;
  size?: "page" | "panel";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center",
        size === "page" ? "gap-3 px-6 py-14" : "gap-2 px-4 py-10",
        className,
      )}
    >
      {icon ? (
        <div
          aria-hidden
          className="flex size-11 items-center justify-center rounded-full bg-app-inset text-app-muted [&_svg]:size-5"
        >
          {icon}
        </div>
      ) : null}
      <div className="space-y-1.5">
        <p className="text-[15px] font-medium text-app-ink">{title}</p>
        {description ? (
          <p className="mx-auto max-w-xs text-sm text-app-muted">{description}</p>
        ) : null}
      </div>
      {action ? <div className="pt-1">{action}</div> : null}
    </div>
  );
}
