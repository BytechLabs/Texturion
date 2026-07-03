/**
 * Dispatch-desk seed data (iteration 5, HERO-CONCEPT §1, §7).
 *
 * The single job ticket the visitor files — the water-heater emergency, shared
 * with the §3.4 deep-dive so the hero and deep-dive are ONE story (§6 honesty
 * guard). Nothing is invented: names, the 555-01XX safe range, the ticket id
 * `#0119`, and every line of copy come from HERO-CONCEPT §7 / COPY.md and the
 * Reyes Plumbing seed (BLUEPRINT §10.1).
 */

export interface Assignee {
  /** First name shown on the chip + the resolved meta line. */
  name: string;
  /** Two-letter initials for the avatar (matches the app's member-avatar rule). */
  initials: string;
}

/** The three real assignee chips (HERO-CONCEPT §1: Priya / Dale / Marcus). */
export const ASSIGNEES: Assignee[] = [
  { name: "Priya", initials: "PR" },
  { name: "Dale", initials: "DA" },
  { name: "Marcus", initials: "MA" },
];

/** The one the ghost demo picks, and the pre-seeded default (§3, §7). */
export const DEFAULT_ASSIGNEE = ASSIGNEES[1]; // Dale

export const DISPATCH = {
  /** The raw, panicked customer text — State A (HERO-CONCEPT §7 desk raw bubble). */
  rawBubble:
    "Hi — my water heater's leaking everywhere, can someone come today?? 😰",
  photoLabel: "Leaking water heater",
  /** The tabular ticket id, reusing the seed range (§2.1). */
  ticketId: "#0119",
  filedTime: "2:14 PM",
  /** The seeded internal note that drops if the visitor added none (§7). */
  seededNote: "heard a hiss — send Dale, it's the tankless",
  /** Dale's teal reply in the resolved conversation (§1 State B). */
  reply:
    "Hi — it's Dale from Reyes Plumbing. Shutting the water off at the valve now helps; I can be there within the hour. On my way.",
  replyTime: "2:16 PM",
  /** The contact shown on the resolved conversation header. */
  contact: { name: "New customer", number: "(416) 555-0142" },
  /** The resolved caption (§7). */
  resolvedCaption: "That's a job now — your whole crew can see it.",
  hint: "tap to file →",
} as const;
