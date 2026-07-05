/**
 * <SegmentCounterStatic>, the §PR segment counter at its default message, as
 * pure server DOM. The no-JS / pre-hydration frame so the trust demo shows a
 * real, correct count before (and without) the interactive island. It computes
 * the default with the SAME pure `estimateSegments` (@loonext/shared) the
 * interactive island and the app's billing use, so the count is real, not a
 * placeholder, and the swap to the typable textarea is seamless.
 *
 * <LazyIsland> loads the interactive counter on viewport approach.
 */

import { estimateSegments } from "@loonext/shared";

const DEFAULT_MESSAGE =
  "Hi Karen, it's Dale from Reyes Plumbing. I can come by tomorrow between 9 and 11 to look at the water heater. Does that work?";

export function SegmentCounterStatic() {
  const { segments, unitsUsed, encoding } = estimateSegments(DEFAULT_MESSAGE);
  const isUnicode = encoding === "UCS-2";
  const chars = [...DEFAULT_MESSAGE].length;
  const textWord = segments === 1 ? "text" : "texts";
  const kindLabel = isUnicode ? "special characters or emoji" : "plain";
  const splitNote =
    segments > 1 ? `, splits into ${segments} parts behind the scenes` : "";

  return (
    <div className="rounded-[10px] border border-border bg-card p-6 shadow-[0_24px_64px_-32px_rgba(28,25,23,0.25)]">
      <p className="text-[14px] font-medium text-foreground">
        Type your usual message, we&apos;ll count it with the same code that
        does our billing.
      </p>
      {/* Inert preview, the interactive island replaces this with a textarea. */}
      <div className="mt-3 min-h-[6.5rem] w-full rounded-md border border-input bg-background px-3 py-2.5 text-[15px] leading-relaxed text-foreground">
        {DEFAULT_MESSAGE}
      </div>

      <div className="mt-4 flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-lg bg-primary/5 px-4 py-3">
        <span className="text-[17px] font-semibold tabular-nums text-primary">
          {segments === 0 ? "0 texts" : `${segments} ${textWord}`}
        </span>
        <span className="text-[14px] tabular-nums text-muted-foreground">
          ({chars} characters, {kindLabel}
          {splitNote})
        </span>
      </div>

      <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">
        {isUnicode
          ? "Emoji and some special characters (like a curly quote or an em-dash) switch the message to a format that fits fewer characters per part, so it can count as more than one."
          : `A plain text fits up to 160 characters in one; you've used ${unitsUsed}.`}
      </p>
    </div>
  );
}
