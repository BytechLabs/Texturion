import { cn } from "@/lib/utils";

/**
 * #733: the one count pill: a small round token holding a number, such as the
 * inbox's open count, the bell's unread count or a filter's active count.
 * `quiet` is the stone default; `primary` is for a count that asks to be
 * noticed (the bell, an active filter). `md` sits beside a label; `sm` is the
 * corner badge on an icon. Position it with `className`.
 */
export function CountPill({
  tone = "quiet",
  size = "md",
  className,
  children,
  ...props
}: {
  tone?: "quiet" | "primary";
  size?: "sm" | "md";
} & React.ComponentProps<"span">) {
  return (
    <span
      className={cn(
        "grid h-4 min-w-4 place-items-center rounded-full px-1 font-semibold tabular-nums",
        size === "md" ? "text-[10.5px]" : "text-[9px] leading-4",
        tone === "quiet"
          ? "bg-app-line-soft text-app-muted"
          : "bg-primary text-primary-foreground",
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}
