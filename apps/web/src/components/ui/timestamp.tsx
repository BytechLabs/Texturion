"use client";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useT } from "@/i18n/provider";
import {
  formatAbsoluteDateTime,
  formatTimestamp,
  type TimestampStyle,
} from "@/lib/format/time";
import { cn } from "@/lib/utils";

/**
 * #720: every date the product shows. The label follows the shared rule
 * ("3:42 PM", "Yesterday", "Sep 9"); hovering shows the exact date and time
 * with its zone, and a screen reader hears that exact time after the label.
 *
 * The exact time is read AFTER the visible label, not instead of it, so a row
 * link that contains a timestamp keeps its visible words in its accessible
 * name (WCAG 2.5.3).
 */
export function Timestamp({
  at,
  style = "short",
  elsewhere,
  className,
}: {
  /** ISO 8601. A bad or absent value renders nothing. */
  at: string | null | undefined;
  style?: TimestampStyle;
  /** The same instant on another clock, said under the exact time when its
   * wall clock differs: the customer's, or the workspace's. */
  elsewhere?: { timeZone: string; whose: string };
  className?: string;
}) {
  const t = useT();
  if (!at) return null;
  const label = formatTimestamp(at, { style, t });
  if (label === "") return null;
  const exact = formatAbsoluteDateTime(at, undefined, t.locale);
  const otherClock =
    elsewhere && wallClock(at, elsewhere.timeZone) !== wallClock(at)
      ? t("misc.timeElsewhere", {
          time: formatAbsoluteDateTime(at, elsewhere.timeZone, t.locale),
          whose: elsewhere.whose,
        })
      : null;

  // Its own provider: a timestamp sits in rows, portals and public pages that
  // no app-level provider is guaranteed to wrap.
  return (
    <TooltipProvider delayDuration={200}>
    <Tooltip>
      <TooltipTrigger asChild>
        <time dateTime={at} className={cn("tabular-nums", className)}>
          {label}
          <span className="sr-only">
            {" "}
            ({exact}
            {otherClock ? `; ${otherClock}` : ""})
          </span>
        </time>
      </TooltipTrigger>
      <TooltipContent>
        <span className="block">{exact}</span>
        {otherClock && <span className="block opacity-80">{otherClock}</span>}
      </TooltipContent>
    </Tooltip>
    </TooltipProvider>
  );
}

/** Hours and minutes on a zone's clock, or the reader's own. */
function wallClock(iso: string, timeZone?: string): string {
  return new Intl.DateTimeFormat("en", {
    hour: "numeric",
    minute: "2-digit",
    ...(timeZone ? { timeZone } : {}),
  }).format(new Date(iso));
}
