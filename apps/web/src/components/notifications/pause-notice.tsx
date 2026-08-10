import { useT } from "@/i18n/provider";
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
  // Before the early return: a hook cannot sit behind a condition, and this
  // component returns null on almost every day it renders.
  const t = useT();
  if (!pause || (!pause.email_paused && !pause.push_paused)) return null;

  const what =
    pause.email_paused && pause.push_paused
      ? t("misc.alertsPausedAll")
      : pause.email_paused
        ? t("misc.alertsPausedEmail")
        : t("misc.alertsPausedPush");
  // Both channels rarely go together, and when only one has, saying which is
  // the difference between "we are broken" and "you are still covered".
  //
  // The joining space is built HERE rather than carried inside the phrase: a
  // leading space in a catalogue entry is the first thing a translator's editor
  // trims, and the sentence would silently close up against the full stop.
  const still =
    pause.email_paused && !pause.push_paused
      ? ` ${t("misc.alertsPausedStillPush")}`
      : "";

  return (
    <div className="border-b border-border bg-amber-50 px-4 py-2.5 dark:bg-amber-950/30">
      <p className="text-[12.5px] text-amber-900 dark:text-amber-200">
        {t("misc.alertsPausedBody", { what, still })}{" "}
        <time dateTime={pause.resets_at} title={formatAbsoluteDateTime(pause.resets_at)}>
          {formatRelativeTime(pause.resets_at)}
        </time>
        {t("misc.alertsPausedBodyEnd")}
      </p>
    </div>
  );
}
