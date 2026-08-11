"use client";

import { DEFAULT_LOCALE } from "@loonext/shared";

import type { MessageKey, Translate } from "@/i18n/provider";
import { makeTranslate, useT } from "@/i18n/provider";
import type { ConversationStatus } from "@/lib/api/types";
import { cn } from "@/lib/utils";

/**
 * Status pills (G4): 11px, sentence case, tinted bg + text. New = petrol
 * tint, Open = sky, Waiting = amber, Closed = plain stone-100.
 *
 * Light-mode text uses deeper shades of each tint hue than the semantic
 * tokens (teal-800, sky-700, amber-800, stone-600): G11 requires 4.5:1 on
 * the tinted backgrounds and the token shades (teal-700 4.50 over stone-50,
 * sky-600 3.5, amber-600 2.9, stone-500 4.4) sit at or below the line at
 * 11px. Dark mode keeps the tokens — the 500-shades on dark tints measure
 * 5.2–7.4:1.
 */
const PILL_STYLES: Record<ConversationStatus, string> = {
  new: "bg-primary/10 text-teal-800 dark:bg-primary/15 dark:text-primary",
  open: "bg-info/10 text-sky-700 dark:bg-info/15 dark:text-info",
  waiting: "bg-warning/10 text-amber-800 dark:bg-warning/15 dark:text-warning",
  closed: "bg-secondary text-stone-600 dark:text-muted-foreground",
};

/** English, for a caller that cannot reach a provider. See `statusLabel`. */
const EN = makeTranslate(DEFAULT_LOCALE);

const PILL_LABEL_KEYS: Record<ConversationStatus, MessageKey> = {
  new: "inbox.pillNew",
  open: "inbox.pillOpen",
  waiting: "inbox.pillWaiting",
  closed: "inbox.pillClosed",
};

/**
 * The same four statuses as they read INSIDE a sentence — "Sam marked this
 * waiting", the thread's system line.
 *
 * A separate map rather than `statusLabel(...).toLowerCase()`, which is a rule
 * about English written into a helper: French does not lowercase the same way,
 * and lowercasing translated copy is how a catalogue quietly grows a second
 * source of truth.
 */
const PILL_SENTENCE_KEYS: Record<ConversationStatus, MessageKey> = {
  new: "inbox.pillNewInSentence",
  open: "inbox.pillOpenInSentence",
  waiting: "inbox.pillWaitingInSentence",
  closed: "inbox.pillClosedInSentence",
};

/**
 * One status as a label.
 *
 * Returns the empty string for a status this build does not know — the callers
 * pass an unsafe cast of an untrusted event payload, and an undefined label
 * that reaches `.toLowerCase()` tears down a whole thread render.
 */
export function statusLabel(
  status: ConversationStatus,
  t: Translate = EN,
): string {
  const key = PILL_LABEL_KEYS[status] as MessageKey | undefined;
  return key ? t(key) : "";
}

/** The same, for a status named in the middle of a sentence. */
export function statusInSentence(
  status: ConversationStatus,
  t: Translate = EN,
): string {
  const key = PILL_SENTENCE_KEYS[status] as MessageKey | undefined;
  return key ? t(key) : "";
}

export function StatusPill({
  status,
  className,
}: {
  status: ConversationStatus;
  className?: string;
}) {
  const t = useT();
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium leading-4",
        PILL_STYLES[status],
        className,
      )}
    >
      {statusLabel(status, t)}
    </span>
  );
}
