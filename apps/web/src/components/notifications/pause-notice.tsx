import type { AlertPause } from "@/lib/api/types";
import { formatAbsoluteDateTime, formatRelativeTime } from "@/lib/format/time";

/**
 * #343 — "your notifications are paused", said to the crew rather than only to
 * the owner.
 *
 * At the daily ceiling, alerts stop reaching every member and an email goes to
 * the owner alone. A tech's phone simply goes quiet, and the reasonable
 * inference from the other side is that the business had a slow afternoon. It
 * is the same failure shape as a spam thread absorbing messages (#342) and a
 * queue count that stopped at the page size (#306): the product stops
 * reporting and says nothing.
 *
 * Renders nothing on the overwhelming majority of days. It is a notice, not an
 * alarm — muted, inside a panel you opened, never a badge of its own — because
 * a workspace at its ceiling is already getting fewer notifications and does
 * not need a new one about it.
 *
 * Applying: Zen of Clarity (absent unless it has something to say) and the
 * repo's standing rule that a limited view says it is limited.
 */
export function NotificationPauseNotice({ pause }: { pause?: AlertPause }) {
  if (!pause || (!pause.email_paused && !pause.push_paused)) return null;

  const what =
    pause.email_paused && pause.push_paused
      ? "Notifications are paused"
      : pause.email_paused
        ? "Email alerts are paused"
        : "Push alerts are paused";
  // Both channels rarely go together, and when only one has, saying which is
  // the difference between "we are broken" and "you are still covered".
  const still =
    pause.email_paused && !pause.push_paused
      ? " You're still getting push."
      : "";

  return (
    <div className="border-b border-border bg-amber-50 px-4 py-2.5 dark:bg-amber-950/30">
      <p className="text-[12.5px] text-amber-900 dark:text-amber-200">
        {what} for today — this workspace hit its daily limit.{still} They
        resume{" "}
        <time dateTime={pause.resets_at} title={formatAbsoluteDateTime(pause.resets_at)}>
          {formatRelativeTime(pause.resets_at)}
        </time>
        . Your messages are all still here.
      </p>
    </div>
  );
}
