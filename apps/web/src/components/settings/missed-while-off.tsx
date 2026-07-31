"use client";

import { PhoneMissed } from "lucide-react";

import { useMissedWhileOff } from "@/lib/api/billing";

/**
 * #490 — how many customers rang while the line could not take them.
 *
 * Shown only on a workspace whose subscription is not active, and only when
 * the number is greater than zero. It is the argument for coming back with
 * evidence attached: before this, the business was never told those calls had
 * happened at all, so the case for reinstating was a feeling rather than a
 * count.
 *
 * WHAT THIS IS NOT. It is not a scare banner and it does not use the word
 * "lost". The reader has almost certainly stopped paying because money is
 * tight, and a product that shouts about what their lapse has cost them is
 * kicking somebody who is already down. So: the number, when it last happened,
 * and nothing else. Loss aversion works here precisely because the fact is
 * plain — a tradesperson reading "7 people called" does the arithmetic
 * themselves, and it is more persuasive than any sentence we could write about
 * it.
 *
 * Zero renders NOTHING rather than "0 calls". An empty state here would be an
 * argument against reinstating, and a screen that volunteers that is a screen
 * nobody needed to build.
 */
export function MissedWhileOff({ show }: { show: boolean }) {
  const missed = useMissedWhileOff(show);

  // Never a skeleton or an error: this is a supporting fact on somebody else's
  // screen, and a billing page that renders a broken box where a count should
  // be looks like the billing itself is broken.
  if (!show || !missed.data || missed.data.count === 0) return null;

  const { count, last_at: lastAt } = missed.data;
  const last = lastAt ? new Date(lastAt) : null;

  return (
    <div className="rounded-lg border border-border bg-muted/40 px-4 py-3">
      <div className="flex items-start gap-3">
        <PhoneMissed
          className="mt-0.5 size-4 shrink-0 text-muted-foreground"
          strokeWidth={1.75}
          aria-hidden
        />
        <div className="space-y-1">
          <p className="text-sm font-medium">
            {count === 1
              ? "1 customer called while your number was off"
              : `${count} customers called while your number was off`}
          </p>
          <p className="text-sm text-muted-foreground">
            {last
              ? `They heard that the number isn't taking calls. The most recent was ${relativeDay(last)}.`
              : "They heard that the number isn't taking calls."}
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * "today" / "yesterday" / "on 12 July".
 *
 * A relative day rather than a timestamp: the reader's question is "is this
 * still happening?", and "yesterday" answers it where "2026-07-30T18:04Z" makes
 * them work it out. Beyond a couple of days the exact date is the more useful
 * answer, because by then the question has become "how long has this been
 * going on".
 */
function relativeDay(when: Date): string {
  const startOfDay = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round(
    (startOfDay(new Date()) - startOfDay(when)) / 86_400_000,
  );
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `on ${when.toLocaleDateString(undefined, { day: "numeric", month: "long" })}`;
}
