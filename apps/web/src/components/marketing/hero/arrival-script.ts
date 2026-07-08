/**
 * The Arrival Field's scripted content (P5-SPEC v1 §"Scripted content").
 *
 * One source of truth shared by the p5 sketch (timestamps drawn beside the
 * wandering bubbles) and the hero inbox (the matching conversation rows the
 * docked particles prepend). Timestamps are drawn in this exact order and
 * loop seamlessly. Everything here is fictional-but-plausible conversation
 * content: no invented product stats, no names implying real customers.
 */

export interface ArrivalScriptItem {
  /** Contact display name on the inbox row (fictional). */
  name: string;
  /** The row's snippet (the customer's text). */
  snippet: string;
  /** The mono timestamp, drawn on the field and shown on the row. */
  time: string;
}

/** P5-SPEC order: 9:04 PM, 6:48 AM, 12:15 PM, 5:31 PM, 8:47 AM. */
export const ARRIVAL_SCRIPT: readonly ArrivalScriptItem[] = [
  {
    name: "Karen M",
    snippet: "Water heater leaking, error E110",
    time: "9:04 PM",
  },
  {
    name: "Dan R",
    snippet: "No heat this morning, thermostat blank",
    time: "6:48 AM",
  },
  {
    name: "Alicia G",
    snippet: "Can you add the back beds this week?",
    time: "12:15 PM",
  },
  {
    name: "Morgan W",
    snippet: "Running 15 late, still ok?",
    time: "5:31 PM",
  },
  {
    name: "Theo B",
    snippet: "Is he coming today?",
    time: "8:47 AM",
  },
] as const;

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
