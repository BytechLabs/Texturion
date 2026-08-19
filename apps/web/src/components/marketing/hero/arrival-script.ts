/**
 * The Arrival Field's scripted content (P5-SPEC v1 §"Scripted content").
 *
 * One source of truth shared by the p5 sketch (timestamps drawn beside the
 * wandering bubbles) and the hero inbox (the matching conversation rows the
 * docked particles prepend). Timestamps are drawn in this exact order and
 * loop seamlessly. Everything here is fictional-but-plausible conversation
 * content: no invented product stats, no names implying real customers.
 */

import type { MarketingLocale } from "@/i18n/marketing/footer";
import { homeCopy } from "@/i18n/marketing/home";

export interface ArrivalScriptItem {
  /** Contact display name on the inbox row (fictional). */
  name: string;
  /** The row's snippet (the latest message in that conversation). */
  snippet: string;
  /** The mono timestamp, drawn on the field and shown on the row. */
  time: string;
  /**
   * Direction of the snippet, which the row prefixes exactly the way the
   * app's own conversation-row does ("You: " on an outbound). Defaults to
   * inbound.
   *
   * #491: one row is a CALL. The field draws the moment a customer reached
   * the business; the row shows what the inbox holds afterwards, and when
   * that moment was a call nobody could take, what it holds is the automatic
   * text-back. Without it the first product surface on the site is five
   * texts, which is the impression this issue exists to correct.
   */
  direction?: "inbound" | "outbound";
}

/** P5-SPEC order: 9:04 PM, 6:48 AM, 12:15 PM, 5:31 PM, 8:47 AM. */
export const arrivalScript = (
  locale: MarketingLocale = "en",
): readonly ArrivalScriptItem[] => {
  const copy = homeCopy(locale);
  return [
  {
    name: "Karen M",
    snippet: copy.arrivalWaterHeater,
    time: "9:04 PM",
  },
  {
    name: "Dan R",
    snippet: copy.arrivalNoHeat,
    time: "6:48 AM",
  },
  {
    name: "Alicia G",
    snippet: copy.arrivalBackBeds,
    time: "12:15 PM",
  },
  {
    name: "Morgan W",
    snippet: copy.arrivalTextBack,
    time: "5:31 PM",
    direction: "outbound",
  },
  {
    name: "Theo B",
    snippet: copy.arrivalComingToday,
    time: "8:47 AM",
  },
  ] as const;
};

/** The English rows, for tests and any English-only surface. */
export const ARRIVAL_SCRIPT: readonly ArrivalScriptItem[] = arrivalScript("en");

/**
 * The dock event (P5-SPEC §"Coupling to the real DOM"): the sketch dispatches
 * this (bubbling) CustomEvent with `detail: { scriptIndex }` when a particle
 * docks; the hero inbox listens and prepends the matching row.
 */
export const HERO_ARRIVAL_EVENT = "loonext:arrival";

/** The dock target marker: the sketch steers particles toward the element
 *  carrying this attribute (the hero inbox card). */
export const ARRIVAL_DOCK_ATTR = "data-arrival-dock";

/** The inbox shows at most this many rows (P5-SPEC: "cap at 4 rows"). */
export const INBOX_ROW_CAP = 4;
