/**
 * Trade thread scripts (trades crew), v4 "FIRST RESPONSE".
 *
 * One genuinely specific scripted conversation per trade page, each staging
 * that trade's worst minute from the COPY-DECK v2 dateline:
 *
 *   plumbers     9:04 PM · BASEMENT DRAIN
 *   hvac         6:48 AM · NO HEAT
 *   landscapers  7:15 AM · GATE LOCKED
 *   cleaners     5:56 PM · KEY UNDER MAT?
 *   salons       11:20 AM · RUNNING LATE
 *   contractors  8:02 AM · CHANGE ORDER
 *
 * The scripts are DATA for the trades-owned static <TradeThread> (which
 * renders them with the app's own tokens inside a marketing <PanelFrame>).
 * Every line is real trade dialogue: the jargon, the prices, the objections,
 * and the flow are specific to that trade and appear on no other page. Crew
 * names differ per trade so no page reads like a find-and-replace of another.
 * Contact numbers use the 555-01XX safe fictional range.
 *
 * Law 6: no em-dashes in any string here; ranges read "between 9 and 11".
 */

export type TradeScriptStatus = "new" | "open" | "waiting" | "closed";

export interface TradeInboundBeat {
  id: string;
  kind: "inbound";
  body: string;
  time: string;
  /** DOM-drawn photo placeholder label (no rasters, Law: live DOM only). */
  photoLabel?: string;
}

export interface TradeNoteBeat {
  id: string;
  kind: "note";
  /** Teammate who left the internal note. */
  by: string;
  body: string;
  time: string;
}

export interface TradeOutboundBeat {
  id: string;
  kind: "outbound";
  body: string;
  time: string;
}

export interface TradeEventBeat {
  id: string;
  kind: "event";
  text: string;
}

export type TradeBeat =
  | TradeInboundBeat
  | TradeNoteBeat
  | TradeOutboundBeat
  | TradeEventBeat;

export interface TradeScript {
  contact: { name: string; number: string };
  status: TradeScriptStatus;
  /** Assignee shown in the thread header after the assignment event. */
  assignee: string;
  beats: TradeBeat[];
  /** Beat ids rendered in the app's D14 done state (strike + petrol pill). */
  doneIds?: readonly string[];
  /** Per-beat done-badge label ("Done · Name · time"). */
  doneLabels?: Readonly<Record<string, string>>;
}

/* -------------------------------------------------------------------------- */
/* Plumbers: the 9:04 PM basement drain, answered the same evening and booked  */
/* for 8am. Outbound wording per COPY-DECK v2 §/for/plumbers.                  */
/* -------------------------------------------------------------------------- */

export const PLUMBERS_SCRIPT: TradeScript = {
  contact: { name: "Marcus T", number: "(647) 555-0121" },
  status: "waiting",
  assignee: "Dale",
  beats: [
    {
      id: "pl-in-1",
      kind: "inbound",
      body:
        "Hey, our basement floor drain is backing up when the washing machine runs. How soon could someone look at it?",
      photoLabel: "Backed-up floor drain",
      time: "9:04 PM",
    },
    {
      id: "pl-note-1",
      kind: "note",
      by: "Priya",
      body:
        "Second backup on that street this month. Dale, bring the auger and the camera",
      time: "9:09 PM",
    },
    {
      id: "pl-event-1",
      kind: "event",
      text: "Priya assigned this conversation to Dale",
    },
    {
      id: "pl-out-1",
      kind: "outbound",
      body:
        "Hi Marcus, Dale from Reyes Plumbing. From your photo that looks like a main line clog, we can be there tomorrow at 8am. It's $180 for the auger service, and we'll quote anything bigger before touching it. Want the 8am?",
      time: "9:14 PM",
    },
    {
      id: "pl-in-2",
      kind: "inbound",
      body: "Booked. See you at 8",
      time: "9:17 PM",
    },
    {
      id: "pl-event-2",
      kind: "event",
      text: "Dale added the tag Scheduled",
    },
  ],
};

/* -------------------------------------------------------------------------- */
/* HVAC: the 6:48 AM no-heat text with a thermostat error photo; the office    */
/* reads the code, the "bring the capacitor" note rides the van (v2 script).   */
/* -------------------------------------------------------------------------- */

export const HVAC_SCRIPT: TradeScript = {
  contact: { name: "Greg P", number: "(613) 555-0143" },
  status: "waiting",
  assignee: "Tariq",
  beats: [
    {
      id: "hv-in-1",
      kind: "inbound",
      body:
        "Furnace's been off since last night and the thermostat is showing E4. It's 12 degrees in the house. Can someone come today?",
      photoLabel: "Thermostat error E4",
      time: "6:48 AM",
    },
    {
      id: "hv-note-1",
      kind: "note",
      by: "Dana",
      body:
        "E4 on that model is almost always the blower capacitor. Tariq, bring the capacitor kit and a filter while you're in there",
      time: "6:52 AM",
    },
    {
      id: "hv-event-1",
      kind: "event",
      text: "Dana assigned this conversation to Tariq",
    },
    {
      id: "hv-out-1",
      kind: "outbound",
      body:
        "Morning Greg, Tariq from Northline Heating. That error usually points to the blower, and I've got the likely part on the van already. I can be there by 9. The diagnostic is $120 and it applies to the repair. In the meantime, leave the system off rather than resetting it. Okay to head over?",
      time: "6:57 AM",
    },
    {
      id: "hv-in-2",
      kind: "inbound",
      body: "Yes please, 9 works. We're bundling up till then",
      time: "7:01 AM",
    },
    {
      id: "hv-event-2",
      kind: "event",
      text: "Tariq added the tag Scheduled",
    },
  ],
};

/* -------------------------------------------------------------------------- */
/* Landscapers: 7:15 AM, the crew is at a locked gate; the code request turns  */
/* into a back-beds upsell (v2 script).                                        */
/* -------------------------------------------------------------------------- */

export const LANDSCAPERS_SCRIPT: TradeScript = {
  contact: { name: "Diane Alvarez", number: "(905) 555-0164" },
  status: "open",
  assignee: "Sofia",
  beats: [
    {
      id: "ls-out-1",
      kind: "outbound",
      body:
        "Morning Diane, it's Greenline. The crew's at your side gate for the mowing and it's locked. Is there a code we should use?",
      time: "7:15 AM",
    },
    {
      id: "ls-in-1",
      kind: "inbound",
      body:
        "So sorry! Code is 2580. While they're there, could you add the back beds this week? They're getting away from us.",
      time: "7:19 AM",
    },
    {
      id: "ls-note-1",
      kind: "note",
      by: "Marco",
      body:
        "Saving 2580 to her contact so nobody's stuck at that gate again. Sofia, walk the back beds after the mow and price the cleanup",
      time: "7:22 AM",
    },
    {
      id: "ls-event-1",
      kind: "event",
      text: "Marco assigned this conversation to Sofia",
    },
    {
      id: "ls-out-2",
      kind: "outbound",
      body:
        "We're in, thanks Diane. I'll look at the back beds once the mowing's done and text you a price this afternoon. If it works for you, we can fold the cleanup into Thursday's visit.",
      time: "7:26 AM",
    },
    {
      id: "ls-event-2",
      kind: "event",
      text: "Sofia added the tag Quote sent",
    },
  ],
};

/* -------------------------------------------------------------------------- */
/* Cleaners: 5:56 PM, new access instructions (key under the mat) plus a       */
/* Friday-to-Monday reschedule (v2 script).                                    */
/* -------------------------------------------------------------------------- */

export const CLEANERS_SCRIPT: TradeScript = {
  contact: { name: "Nadia K", number: "(437) 555-0178" },
  status: "waiting",
  assignee: "Rosa",
  beats: [
    {
      id: "cl-in-1",
      kind: "inbound",
      body:
        "Hi! We're away Friday, so the key will be under the mat, the door code stopped working. And could we move Friday's clean to Monday instead?",
      time: "5:56 PM",
    },
    {
      id: "cl-note-1",
      kind: "note",
      by: "Elena",
      body:
        "Saving the key note to her contact. Rosa, your Friday just opened up. Can you and Ana take her Monday between 10 and noon?",
      time: "6:03 PM",
    },
    {
      id: "cl-event-1",
      kind: "event",
      text: "Elena assigned this conversation to Rosa",
    },
    {
      id: "cl-out-1",
      kind: "outbound",
      body:
        "Hi Nadia, Monday's no problem. Ana and I will be there between 10 and noon, key under the mat, and we'll lock up and text you when we're done. Anything you want us to focus on this visit?",
      time: "6:10 PM",
    },
    {
      id: "cl-in-2",
      kind: "inbound",
      body: "Perfect. Just the oven if you have time. Thank you!",
      time: "6:14 PM",
    },
    {
      id: "cl-event-2",
      kind: "event",
      text: "Rosa added the tag Scheduled",
    },
  ],
};

/* -------------------------------------------------------------------------- */
/* Salons: 11:20 AM, the running-late text, rescued between stylists           */
/* (v2 script: the reschedule is handled by whoever is free).                  */
/* -------------------------------------------------------------------------- */

export const SALONS_SCRIPT: TradeScript = {
  contact: { name: "Bri L", number: "(416) 555-0192" },
  status: "open",
  assignee: "Maya",
  beats: [
    {
      id: "sa-in-1",
      kind: "inbound",
      body:
        "So sorry, I'm stuck at work and running about 30 minutes late for my 11:30 color with Jess. Should I still come in?",
      time: "11:20 AM",
    },
    {
      id: "sa-note-1",
      kind: "note",
      by: "Renee",
      body:
        "Jess has a cut at 12:30, she can't absorb 30 minutes. Maya's open from noon and has done Bri's color before",
      time: "11:22 AM",
    },
    {
      id: "sa-event-1",
      kind: "event",
      text: "Renee assigned this conversation to Maya",
    },
    {
      id: "sa-out-1",
      kind: "outbound",
      body:
        "Hi Bri, no stress, it's Maya. Jess is booked right after you, so I'll take your color at noon instead. Same service, same price, and I've got the notes from your last visit. See you at 12?",
      time: "11:24 AM",
    },
    {
      id: "sa-in-2",
      kind: "inbound",
      body: "You're a lifesaver. See you at 12!",
      time: "11:26 AM",
    },
    {
      id: "sa-event-2",
      kind: "event",
      text: "Maya added the tag Scheduled",
    },
  ],
};

/* -------------------------------------------------------------------------- */
/* Contractors: 8:02 AM, a homeowner change request filed against the job,     */
/* assigned, priced, and approved in writing (v2 script). The original         */
/* request carries the app's D14 done state once it's been written up.        */
/* -------------------------------------------------------------------------- */

export const CONTRACTORS_SCRIPT: TradeScript = {
  contact: { name: "Karen H", number: "(289) 555-0137" },
  status: "open",
  assignee: "Omar",
  beats: [
    {
      id: "co-in-1",
      kind: "inbound",
      body:
        "Morning! We slept on it and we'd like the island in the walnut butcher block after all, not the laminate. Is it too late to change?",
      time: "8:02 AM",
    },
    {
      id: "co-note-1",
      kind: "note",
      by: "Luis",
      body:
        "That's the Fairview kitchen. Filing this against the job before it gets buried. Counters don't template until Thursday, so we're inside the window",
      time: "8:06 AM",
    },
    {
      id: "co-event-1",
      kind: "event",
      text: "Luis assigned this conversation to Omar",
    },
    {
      id: "co-out-1",
      kind: "outbound",
      body:
        "Hi Karen, not too late. Walnut butcher block for the island adds $840 and two days to the counter schedule. Reply approved and I'll write it up as a change order so it's on the record before Thursday's template.",
      time: "8:11 AM",
    },
    {
      id: "co-in-2",
      kind: "inbound",
      body: "Approved! Thank you for making that painless",
      time: "8:15 AM",
    },
    {
      id: "co-event-2",
      kind: "event",
      text: "Omar added the tag Won",
    },
  ],
  doneIds: ["co-in-1"],
  doneLabels: { "co-in-1": "Done · Omar · 8:16 AM" },
};
