"use client";

/**
 * Text-length counter (COPY-DECK v2 /pricing: "Type your usual message. We
 * count it with the same code that does our billing."). A trust demo, not a
 * toy: it counts with the EXACT `estimateSegments` code from @loonext/shared
 * that the app uses for its send-time segment pre-check, the same package the
 * product bills against (Telnyx's finalized parts stay authoritative for the
 * invoice; this is the app-side estimate, per SPEC §2).
 *
 * Law 2 staging: this renders INSIDE a <PanelFrame>, i.e. in an `.app-scope`
 * region, so every token class below (bg-primary, text-primary, border-input,
 * text-muted-foreground) resolves to the app's own petrol theme. Marketing
 * cobalt stays outside the frame; do not restyle these to --fr-* tokens.
 *
 * Client island (below-fold; the only JS is a controlled textarea + the pure
 * estimator). aria-live on the output; native textarea for keyboard access.
 */

import { useId, useState } from "react";

import { estimateSegments } from "@loonext/shared";

const DEFAULT_MESSAGE =
  "Hi Karen, it's Dale from Reyes Plumbing. I can come by tomorrow between 9 and 11 to look at the water heater. Does that work?";

export function SegmentCounter() {
  const [text, setText] = useState(DEFAULT_MESSAGE);
  const id = useId();

  const { segments, unitsUsed, encoding } = estimateSegments(text);
  // UCS-2 is triggered by ANY character outside GSM-7: emoji, but also curly
  // quotes or accents, so we never claim "emoji" when the real cause might be
  // punctuation. "Special characters or emoji" is true for every UCS-2 case
  // and matches SPEC §2's own tooltip wording.
  const isUnicode = encoding === "UCS-2";
  const chars = [...text].length; // code points, matching the app's meter

  const textWord = segments === 1 ? "text" : "texts";
  const kindLabel = isUnicode ? "special characters or emoji" : "plain";
  const splitNote =
    segments > 1 ? `, splits into ${segments} parts behind the scenes` : "";

  return (
    <div className="bg-background p-5 text-foreground sm:p-6">
      <label htmlFor={id} className="text-sm font-medium text-foreground">
        Type your usual message. We count it with the same code that does our
        billing.
      </label>
      <textarea
        id={id}
        rows={4}
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
        className="mt-3 w-full resize-y rounded-md border border-input bg-background px-3 py-2.5 text-[15px] leading-relaxed text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      />

      <div
        aria-live="polite"
        className="mt-4 flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-lg bg-primary/5 px-4 py-3"
      >
        <span className="text-[17px] font-semibold tabular-nums text-primary">
          {segments === 0 ? "0 texts" : `${segments} ${textWord}`}
        </span>
        <span className="text-sm tabular-nums text-muted-foreground">
          ({chars} characters, {kindLabel}
          {splitNote})
        </span>
      </div>

      {/* The one technical footnote: "segments" demoted to a tooltip-level
          aside exactly like the app's own UI copy rule (SPEC §2: lead with
          "texts," never "segments"). */}
      <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">
        {isUnicode
          ? "Emoji and some special characters (like a curly quote) switch the message to a format that fits fewer characters per part, so it can count as more than one."
          : `A plain text fits up to 160 characters in one; you've used ${unitsUsed}.`}
      </p>
    </div>
  );
}
