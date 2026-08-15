"use client";

import { Moon } from "lucide-react";

import { CLOCK_AREA_CODE_NOTE } from "@loonext/shared";

import { useT } from "@/i18n/provider";
import type { DestinationClock } from "@/lib/api/types";

/**
 * #225 — "9:42pm their time", above the composer, and only when it matters.
 *
 * A reply inside a thread the customer started is reply-exempt and we do not
 * block it: a trade owner texting their own customer back at 9:15pm is their
 * call, and refusing would be us overriding a judgement that is theirs to
 * make. But they should know they are doing it. Most people have no idea what
 * time it is in a 613 area code, and finding out from an annoyed customer is
 * the expensive way.
 *
 * SHOWN ONLY WHEN IT IS ACTUALLY QUIET THERE. A clock that sits on screen all
 * day is furniture, and furniture is not read. This appears when the answer
 * would change what somebody does, and is absent the rest of the time.
 *
 * The provenance matters as much as the time. "From their area code" is a
 * guess that can be wrong — a mobile keeps its code when its owner moves — so
 * the line says which rung answered rather than presenting an inference as a
 * fact, and the contact screen is where somebody corrects it.
 */
export function TheirTime({ clock }: { clock: DestinationClock | null }) {
  const t = useT();
  if (!clock || !clock.quiet) return null;

  const hour = clock.local_hour;
  const suffix = hour < 12 ? "am" : "pm";
  const twelve = hour % 12 === 0 ? 12 : hour % 12;

  const provenance =
    clock.source === "contact"
      ? "set on their contact"
      : clock.source === "area_code"
        ? "from their area code"
        : // The weakest rung: a non-geographic number with no override, so we
          // are showing the shop's own clock and should say so plainly rather
          // than let it read as the customer's.
          "your workspace's timezone — we don't know theirs";

  return (
    <p className="flex items-start gap-1.5 px-1 pb-1.5 text-xs text-muted-foreground">
      <Moon
        className="mt-0.5 size-3.5 shrink-0"
        strokeWidth={1.75}
        aria-hidden
      />
      <span>
        It&apos;s about {twelve}
        {suffix} where they are ({provenance}).{" "}
        {/* #539: WHY theirs is the clock that counts, and that a wrong guess is
            correctable. The issue asked "why are we deriving time from customers
            area codes even? what if i bought my phone number in quebec but now
            live in alberta?" and the answer was on no screen — the line said
            where the guess came from without saying what it decides or how to
            fix it.

            Only on the GUESSED rung. Somebody who already set the zone on the
            contact does not need telling they can, and offering to correct a
            non-geographic number would be offering to fix an inference we never
            made. */}
        {clock.source === "area_code" && <span>{t(CLOCK_AREA_CODE_NOTE)}</span>}
      </span>
    </p>
  );
}
