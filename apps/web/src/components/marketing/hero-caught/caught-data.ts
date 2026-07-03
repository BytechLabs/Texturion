/**
 * The "caught" thread seed (DESIGN-DIRECTION §3 Signature). The single, specific
 * incoming customer message that lands and gets claimed by a crew member's name.
 * Nothing invented: the safe 555-01XX range, the Reyes Plumbing crew (Priya /
 * Dale / Marcus, BLUEPRINT §10.1), real trade copy. No em-dashes (§0).
 *
 * Shared in substance with the deep-dive so the hero and the deep-dive are one
 * story (the water-heater emergency).
 */

export const CAUGHT = {
  /** The customer who texted the business number. */
  customer: {
    name: "New customer",
    number: "(416) 555-0142",
    initials: "NC",
  },
  /** The crew member who catches it. */
  crew: { name: "Dale", initials: "DA" },

  /** The real, specific incoming message (the star of the page). */
  inbound:
    "hi, water heater's leaking all over the garage, can someone come today??",
  inboundTime: "2:14 PM",

  /** The crew reply, delivered. */
  reply:
    "Hi, it's Dale from Reyes Plumbing. Shut the water off at the valve for now. I can be there within the hour, on my way.",
  replyTime: "2:16 PM",

  /** The quiet caption. No fake proof, no "live" costume. */
  caption: "A text that would have been missed. Caught, and claimed by a name.",

  /** The word the marker highlights in the hero H1 (the promise word). */
  promiseWord: "caught",
} as const;
