"use client";

import Link from "next/link";

import { AiStatus } from "@/components/ui/ai-orb";

/**
 * AI-drafted replies, offered above the pill. Each is a full message: tapping
 * one loads it into the composer to read and edit. NOTHING here sends — the
 * person still presses send, every time, which is the whole safety model of
 * the feature.
 */
export function ReplySuggestionChips({
  suggestions,
  loading,
  businessUnknown,
  onUse,
  onDismiss,
}: {
  suggestions: string[];
  /** Drafting is in flight — show the placeholders rather than an empty strip. */
  loading?: boolean;
  /** Lou has not been told what this business does (see ReplySuggestions). */
  businessUnknown?: boolean;
  onUse: (suggestion: string) => void;
  onDismiss: () => void;
}) {
  return (
    <div className="mx-auto max-w-[42rem] px-1 pb-2">
      <div className="mb-1 flex items-center gap-2">
        <AiStatus
          state={loading ? "thinking" : "done"}
          label={loading ? "Drafting…" : "Lou's drafts"}
        />
        <div className="ml-auto flex items-center gap-1">
          {/* No re-ask. Every ask is a real AI call, and re-rolling until a
              draft reads nicely is what turns a bounded per-message cost into
              an unbounded one — for an answer that is a starting point you
              edit anyway. The next set comes when the conversation moves. */}
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
          >
            Dismiss
          </button>
        </div>
      </div>
      <div
        className="flex flex-col gap-1.5"
        role="group"
        aria-label="Suggested replies"
      >
        {loading
          ? // Three placeholders, because three is what comes back: the strip
            // keeps its shape instead of jumping when the drafts land.
            [0, 1, 2].map((row) => (
              <div
                key={row}
                className="h-[38px] animate-pulse rounded-app-card border border-app-line bg-app-inset"
                aria-hidden
              />
            ))
          : suggestions.map((suggestion, index) => (
              <button
                key={index}
                type="button"
                onClick={() => onUse(suggestion)}
                className="rounded-app-card border border-app-line bg-app-paper px-3 py-2 text-left text-[13px] leading-[1.45] text-app-ink transition-colors duration-150 ease-out hover:border-app-olive hover:bg-app-tint/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                {suggestion}
              </button>
            ))}
      </div>
      {/* Offered here rather than only in Settings, because this is the moment
          the gap is felt: the drafts are on screen and they are vaguer than
          they need to be. The setting exists either way; almost nobody goes
          looking for it. */}
      {!loading && businessUnknown ? (
        <p className="mt-1.5 px-0.5 text-[11px] text-muted-foreground">
          Lou doesn&rsquo;t know what you do yet.{" "}
          <Link
            href="/settings/ai"
            className="font-medium text-app-olive underline-offset-4 hover:underline"
          >
            Tell it, and drafts get specific
          </Link>
          .
        </p>
      ) : null}
    </div>
  );
}
