/**
 * <SegmentCounterStatic>, the segment counter at its default message, as pure
 * server DOM. The no-JS / pre-hydration frame so the trust demo shows a real,
 * correct count before (and without) the interactive island. It computes the
 * default with the SAME pure `estimateSegments` (@loonext/shared) the
 * interactive island and the app's billing use, so the count is real, not a
 * placeholder, and the swap to the typable textarea is seamless.
 *
 * Renders inside the same <PanelFrame> `.app-scope` region as the island
 * (Law 2): the token classes below resolve to the app's own petrol theme.
 * <LazyIsland> loads the interactive counter on viewport approach.
 */

import type { MarketingLocale } from "@/i18n/marketing/footer";
import { fill } from "@/i18n/marketing/home";
import { pricingCopy } from "@/i18n/marketing/pricing";
import { estimateSegments } from "@loonext/shared";

const DEFAULT_MESSAGE =
  "Hi Karen, it's Dale from Reyes Plumbing. I can come by tomorrow between 9 and 11 to look at the water heater. Does that work?";

export function SegmentCounterStatic({
  locale = "en",
}: {
  locale?: MarketingLocale;
} = {}) {
  const copy = pricingCopy(locale);
  const DEFAULT_MESSAGE = copy.counterSample;
  const { segments, unitsUsed, encoding } = estimateSegments(DEFAULT_MESSAGE);
  const isUnicode = encoding === "UCS-2";
  const chars = [...DEFAULT_MESSAGE].length;
  const textWord = segments === 1 ? copy.counterOne : copy.counterMany;
  const kindLabel = isUnicode ? copy.counterSpecial : copy.counterPlain;
  const splitNote =
    segments > 1 ? fill(copy.counterSplit, { parts: String(segments) }) : "";

  return (
    <div className="bg-background p-5 text-foreground sm:p-6">
      <p className="text-sm font-medium text-foreground">
        {copy.counterHint}
      </p>
      {/* Inert preview; the interactive island replaces this with a textarea. */}
      <div className="mt-3 min-h-[6.5rem] w-full rounded-md border border-input bg-background px-3 py-2.5 text-[15px] leading-relaxed text-foreground">
        {DEFAULT_MESSAGE}
      </div>

      <div className="mt-4 flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-lg bg-primary/5 px-4 py-3">
        <span className="text-[17px] font-semibold tabular-nums text-primary">
          {segments === 0 ? copy.counterZero : `${segments} ${textWord}`}
        </span>
        <span className="text-sm tabular-nums text-muted-foreground">
          {fill(copy.counterChars, {
            chars: String(chars),
            kind: kindLabel,
            split: splitNote,
          })}
        </span>
      </div>

      <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">
        {isUnicode
          ? copy.counterUnicodeNote
          : fill(copy.counterPlainNote, { used: String(unitsUsed) })}
      </p>
    </div>
  );
}
