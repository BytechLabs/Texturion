"use client";

/**
 * Text-length explainer + counter (COPY §PR "Text-length explainer + counter").
 * A trust demo, not a toy: it counts with the EXACT `estimateSegments` code from
 * @jobtext/shared that the app uses for its send-time segment pre-check — the same
 * package the product bills against (Telnyx's finalized parts stay authoritative
 * for the invoice; this is the app-side estimate, per SPEC §2). Copy verbatim
 * from §PR: "Type your usual message — we'll count it with the same code that
 * does our billing."
 *
 * Client island (BLUEPRINT §11.4: below-fold island < 15KB gz; the only JS the
 * counter needs is a controlled textarea + the pure estimator). aria-live on the
 * output; keyboard-accessible by construction (native textarea).
 */

import { useId, useState } from "react";

import { estimateSegments } from "@jobtext/shared";

const DEFAULT_MESSAGE =
  "Hi Karen, it's Dale from Reyes Plumbing. I can come by tomorrow between 9 and 11 to look at the water heater. Does that work?";

export function SegmentCounter() {
  const [text, setText] = useState(DEFAULT_MESSAGE);
  const id = useId();

  const { segments, unitsUsed, encoding } = estimateSegments(text);
  // UCS-2 is triggered by ANY character outside GSM-7 — emoji, but also an
  // em-dash, curly quotes, or accents — so we never claim "emoji" when the real
  // cause might be a dash. "Special characters or emoji" is true for every UCS-2
  // case and matches SPEC §2's own tooltip wording.
  const isUnicode = encoding === "UCS-2";
  const chars = [...text].length; // code points, matching the app's meter

  // §PR widget output: "{n} text{s} ({chars} characters, {plain | special/emoji})
  // {, splits into n parts if >1}".
  const textWord = segments === 1 ? "text" : "texts";
  const kindLabel = isUnicode ? "special characters or emoji" : "plain";
  const splitNote =
    segments > 1 ? `, splits into ${segments} parts behind the scenes` : "";

  return (
    <div className="rounded-[10px] border border-border bg-card p-6 shadow-[0_24px_64px_-32px_rgba(28,25,23,0.25)]">
      <label
        htmlFor={id}
        className="text-[14px] font-medium text-foreground"
      >
        Type your usual message — we&apos;ll count it with the same code that
        does our billing.
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
        <span className="text-[14px] tabular-nums text-muted-foreground">
          ({chars} characters, {kindLabel}
          {splitNote})
        </span>
      </div>

      {/* The one honest technical footnote — segments demoted to a tooltip-level
          aside exactly like the app's own UI copy rule (SPEC §2, BLUEPRINT §13.8:
          lead with "texts," never "segments"). */}
      <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">
        {isUnicode
          ? "Emoji and some special characters (like a curly quote or an em-dash) switch the message to a format that fits fewer characters per part, so it can count as more than one."
          : `A plain text fits up to 160 characters in one; you've used ${unitsUsed}.`}
      </p>
    </div>
  );
}
