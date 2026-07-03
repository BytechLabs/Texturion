/**
 * Thread-demo script model (Track B).
 *
 * The shared live-thread component (BLUEPRINT §0.1, §3.1) is parameterized by
 * a script: an ordered list of beats that replicate the app's real inbox
 * thread in the marketing site's own DOM. It uses the exact visual language of
 * the app's thread primitives (DESIGN.md G5, inbound white card, outbound
 * teal-50, amber internal notes, delivery states, centered system lines) but
 * carries no app runtime (no TanStack Query, no Supabase) so it can render on
 * a static marketing route and hydrate as a tiny island.
 *
 * Every script here is drawn verbatim from COPY.md (§H4 water-heater thread is
 * the canonical one, shared by the hero §3.1 and the deep-dive §3.4). Nothing
 * is invented: names, numbers (555-01XX safe fictional range, G10), and copy
 * all match the seed company "Reyes Plumbing & Heating" (BLUEPRINT §10.1).
 */

export type DeliveryState = "sending" | "sent" | "delivered";

/** A person in the demo, the crew avatars use initials, exactly like G4. */
export interface DemoActor {
  /** Display name, e.g. "Priya" or "Karen M". */
  name: string;
}

interface BaseBeat {
  /** Stable key for React lists and step highlighting. */
  id: string;
  /**
   * Caption index (1-based) this beat corresponds to in the §3.4 deep-dive
   * step captions, or null if it is not a highlighted step. Lets the deep-dive
   * sync its left-column captions with the right-column thread.
   */
  step?: number;
}

/** Inbound customer text (white card, left). */
export interface InboundBeat extends BaseBeat {
  kind: "inbound";
  from: string;
  body: string;
  /** Optional MMS photo, rendered as a neutral thumbnail placeholder. */
  photo?: { label: string };
  time: string;
}

/** Outbound business reply (teal-50, right) with a delivery state. */
export interface OutboundBeat extends BaseBeat {
  kind: "outbound";
  by: string;
  body: string;
  photo?: { label: string };
  time: string;
  /** Terminal delivery state after the sending animation resolves. */
  delivered: DeliveryState;
}

/** Amber internal note (dashed border, lock icon, "Internal note"). */
export interface NoteBeat extends BaseBeat {
  kind: "note";
  by: string;
  body: string;
  time: string;
}

/** Centered system/event line (assignment, tag, status). */
export interface EventBeat extends BaseBeat {
  kind: "event";
  text: string;
}

export type ThreadBeat = InboundBeat | OutboundBeat | NoteBeat | EventBeat;

export interface ThreadScript {
  /** Contact shown in the thread header. */
  contact: { name: string; number: string };
  /** Status shown as the header pill; advances as the thread plays. */
  finalStatus: "new" | "open" | "waiting" | "closed";
  /** The assignee once the assignment event fires. */
  assignee?: string;
  /** Ordered beats. */
  beats: ThreadBeat[];
}

/**
 * §H4 / §3.1 canonical thread, the water-heater emergency. Shared by the hero
 * (autoplays once) and the §3.4 deep-dive (steppable, annotated). Copy is
 * verbatim from COPY.md §H4.
 */
export const WATER_HEATER_SCRIPT: ThreadScript = {
  contact: { name: "Karen M", number: "(416) 555-0187" },
  finalStatus: "waiting",
  assignee: "Dale",
  beats: [
    {
      id: "in-1",
      kind: "inbound",
      from: "Karen M",
      body:
        "Hi, do you service tankless water heaters? Ours is showing error E110 and there's water pooling underneath",
      photo: { label: "Leaking tankless heater" },
      time: "2:41 PM",
      step: 1,
    },
    {
      id: "note-1",
      kind: "note",
      by: "Priya",
      body:
        "Sounds like the Navien on Delaware Ave. Dale, you're two streets over this afternoon",
      time: "2:43 PM",
      step: 2,
    },
    {
      id: "event-1",
      kind: "event",
      text: "Priya assigned this conversation to Dale",
      step: 3,
    },
    {
      id: "out-1",
      kind: "outbound",
      by: "Dale",
      body:
        "Hi Karen, it's Dale from Reyes Plumbing. E110 with pooling water usually means a heat exchanger leak, please don't run hot water for now. I can come by tomorrow between 9 and 11. Does that work?",
      time: "2:52 PM",
      delivered: "delivered",
      step: 4,
    },
    {
      id: "in-2",
      kind: "inbound",
      from: "Karen M",
      body: "Tomorrow 9–11 works. Thank you so much",
      time: "2:58 PM",
    },
    {
      id: "event-2",
      kind: "event",
      text: "Dale added the tag Scheduled",
      step: 5,
    },
  ],
};

/**
 * §3.7 dark-band thread, one-handed, from the job site. A shorter after-hours
 * exchange that reads well in dark mode on a phone frame. Trade-plausible
 * one-liners (BLUEPRINT §10.1 permits these for seed threads), attributed to
 * the same Reyes crew.
 */
export const DARK_BAND_SCRIPT: ThreadScript = {
  contact: { name: "Marcus T", number: "(647) 555-0121" },
  finalStatus: "open",
  assignee: "Dale",
  beats: [
    {
      id: "d-in-1",
      kind: "inbound",
      from: "Marcus T",
      body: "No hot water since this morning, any chance someone could come by today?",
      time: "6:12 AM",
    },
    {
      id: "d-out-1",
      kind: "outbound",
      by: "Dale",
      body: "On my way, should be with you in about 20 minutes.",
      time: "6:14 AM",
      delivered: "delivered",
    },
    {
      id: "d-in-2",
      kind: "inbound",
      from: "Marcus T",
      body: "You're a lifesaver, thank you",
      time: "6:15 AM",
    },
  ],
};

/**
 * §3.6 bento tile 1, "Assign & track". A compact thread fragment showing the
 * assignment event and status, used inside the large live-DOM tile.
 */
export const ASSIGN_TILE_SCRIPT: ThreadScript = {
  contact: { name: "Karen M", number: "(416) 555-0187" },
  finalStatus: "waiting",
  assignee: "Dale",
  beats: [
    {
      id: "a-in-1",
      kind: "inbound",
      from: "Karen M",
      body: "Ours is showing error E110 and there's water pooling underneath",
      time: "2:41 PM",
    },
    {
      id: "a-event-1",
      kind: "event",
      text: "Priya assigned this conversation to Dale",
    },
    {
      id: "a-out-1",
      kind: "outbound",
      by: "Dale",
      body: "I can come by tomorrow between 9 and 11. Does that work?",
      time: "2:52 PM",
      delivered: "delivered",
    },
  ],
};

/**
 * §3.6 bento tile 5, "Photos, both ways". Customer sends a problem photo,
 * business sends back a finished-job photo.
 */
export const PHOTOS_TILE_SCRIPT: ThreadScript = {
  contact: { name: "Karen M", number: "(416) 555-0187" },
  finalStatus: "closed",
  beats: [
    {
      id: "p-in-1",
      kind: "inbound",
      from: "Karen M",
      body: "Here's the unit",
      photo: { label: "Leaking tankless heater" },
      time: "2:41 PM",
    },
    {
      id: "p-out-1",
      kind: "outbound",
      by: "Dale",
      body: "All swapped and tested, you're good to run hot water again.",
      photo: { label: "New heater installed" },
      time: "4:20 PM",
      delivered: "delivered",
    },
  ],
};
