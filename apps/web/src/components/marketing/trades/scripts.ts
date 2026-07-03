/**
 * Trade thread scripts (trades track), one genuinely-specific scripted
 * conversation per trade page (BLUEPRINT §5: "an example conversation rendered
 * in the real thread UI, static, trade-specific"; §5 guard: zero shared
 * sentences between pages).
 *
 * These reuse the heroperf-owned `ThreadScript` model (thread-demo/script.ts)
 * verbatim, the trades track only supplies DATA, never edits the shared
 * component or the shared thread-demo scripts. Every line here is real trade
 * dialogue: the jargon, the numbers, the objections, and the flow are specific
 * to that trade and appear on no other page.
 *
 * Contact numbers use the 555-01XX safe fictional range (DESIGN.md G10). Crew
 * names differ per trade so no page reads like a find-and-replace of another.
 */

import type { ThreadScript } from "@/components/marketing/thread-demo/script";

/* -------------------------------------------------------------------------- */
/* Plumbers, emergency backup, elbow-deep, photo triage (COPY §P anchor,      */
/* expanded with a distinct after-hours turn). "A Tuesday, in texts."          */
/* -------------------------------------------------------------------------- */

export const PLUMBERS_SCRIPT: ThreadScript = {
  contact: { name: "Marcus T", number: "(647) 555-0121" },
  finalStatus: "waiting",
  assignee: "Dale",
  beats: [
    {
      id: "pl-in-1",
      kind: "inbound",
      from: "Marcus T",
      body:
        "Hey, our basement floor drain is backing up when the washing machine runs. How soon could someone look at it?",
      photo: { label: "Backed-up floor drain" },
      time: "7:52 AM",
    },
    {
      id: "pl-note-1",
      kind: "note",
      by: "Priya",
      body:
        "Second backup on that street this month. Dale, bring the auger and the camera",
      time: "7:55 AM",
    },
    {
      id: "pl-event-1",
      kind: "event",
      text: "Priya assigned this conversation to Dale",
    },
    {
      id: "pl-out-1",
      kind: "outbound",
      by: "Dale",
      body:
        "Hi Marcus, Dale from Reyes Plumbing. From your photo that looks like a main line clog, we can be there tomorrow at 8am. It's $180 for the auger service, and we'll quote anything bigger before we touch it. Want the 8am?",
      time: "8:03 AM",
      delivered: "delivered",
    },
    {
      id: "pl-in-2",
      kind: "inbound",
      from: "Marcus T",
      body: "Booked. See you at 8",
      time: "8:06 AM",
    },
    {
      id: "pl-event-2",
      kind: "event",
      text: "Dale added the tag Scheduled",
    },
  ],
};

/* -------------------------------------------------------------------------- */
/* Landscapers, spring cleanup quote from a yard photo, crews across sites.    */
/* Distinct jargon: bed edging, mulch yards, mowing rotation.                  */
/* -------------------------------------------------------------------------- */

export const LANDSCAPERS_SCRIPT: ThreadScript = {
  contact: { name: "The Alvarez house", number: "(905) 555-0164" },
  finalStatus: "waiting",
  assignee: "Sofia",
  beats: [
    {
      id: "ls-in-1",
      kind: "inbound",
      from: "Diane Alvarez",
      body:
        "Winter really did a number on the beds out front. Could you do a spring cleanup and re-mulch? Here's the worst corner.",
      photo: { label: "Overgrown front beds" },
      time: "9:12 AM",
    },
    {
      id: "ls-note-1",
      kind: "note",
      by: "Marco",
      body:
        "That's the Oakridge cul-de-sac. Sofia's crew is three doors down Thursday. Roughly 4 yards of mulch, half a day.",
      time: "9:20 AM",
    },
    {
      id: "ls-event-1",
      kind: "event",
      text: "Marco assigned this conversation to Sofia",
    },
    {
      id: "ls-out-1",
      kind: "outbound",
      by: "Sofia",
      body:
        "Hi Diane, Sofia from Greenline. From the photo I'd budget a full bed cleanup, fresh edging, and about 4 yards of mulch, $640 all in. My crew is on your street Thursday, so we could fold you in that morning. Sound good?",
      time: "9:34 AM",
      delivered: "delivered",
    },
    {
      id: "ls-in-2",
      kind: "inbound",
      from: "Diane Alvarez",
      body: "Thursday's perfect. Can you also quote the mowing for the season while you're here?",
      time: "9:41 AM",
    },
    {
      id: "ls-event-2",
      kind: "event",
      text: "Sofia added the tag Quote sent",
    },
  ],
};

/* -------------------------------------------------------------------------- */
/* Cleaners, recurring client, gate code / access note, reschedule.           */
/* Distinct jargon: biweekly, lockbox, turnover, team of two.                  */
/* -------------------------------------------------------------------------- */

export const CLEANERS_SCRIPT: ThreadScript = {
  contact: { name: "Nadia K", number: "(437) 555-0178" },
  finalStatus: "open",
  assignee: "Rosa",
  beats: [
    {
      id: "cl-in-1",
      kind: "inbound",
      from: "Nadia K",
      body:
        "Hi! We're out of town for our biweekly Friday clean. Door code is 4-4-8-2, and the dog is in the crate, please don't let him out. Key's in the lockbox if the code acts up.",
      time: "3:18 PM",
    },
    {
      id: "cl-note-1",
      kind: "note",
      by: "Elena",
      body:
        "Saving the gate code to her contact so the whole team has it. Rosa, you and Ana have this one Friday",
      time: "3:22 PM",
    },
    {
      id: "cl-event-1",
      kind: "event",
      text: "Elena assigned this conversation to Rosa",
    },
    {
      id: "cl-out-1",
      kind: "outbound",
      by: "Rosa",
      body:
        "Got it, Nadia, code 4482, dog stays crated, lockbox as backup. Ana and I will be there Friday between 10 and noon and I'll text you when we lock up. Anything you want us to focus on this time?",
      time: "3:29 PM",
      delivered: "delivered",
    },
    {
      id: "cl-in-2",
      kind: "inbound",
      from: "Nadia K",
      body: "Just the oven if you have time. Thank you both!",
      time: "3:35 PM",
    },
    {
      id: "cl-event-2",
      kind: "event",
      text: "Rosa added the tag Scheduled",
    },
  ],
};

/* -------------------------------------------------------------------------- */
/* HVAC, no-heat call in a January cold snap, seasonal triage, maintenance.   */
/* Distinct jargon: furnace lockout, filter, maintenance plan, blower.         */
/* -------------------------------------------------------------------------- */

export const HVAC_SCRIPT: ThreadScript = {
  contact: { name: "Greg P", number: "(613) 555-0143" },
  finalStatus: "waiting",
  assignee: "Tariq",
  beats: [
    {
      id: "hv-in-1",
      kind: "inbound",
      from: "Greg P",
      body:
        "Furnace quit overnight and it's -18 out. It's clicking then shutting off, the little light is flashing 3 times. Can someone come today?",
      photo: { label: "Furnace status light" },
      time: "6:41 AM",
    },
    {
      id: "hv-note-1",
      kind: "note",
      by: "Dana",
      body:
        "3 flashes on that model is a pressure-switch / flame lockout. Tariq's van has the induced-draft motor if it's that. Bump him up the cold-snap list.",
      time: "6:47 AM",
    },
    {
      id: "hv-event-1",
      kind: "event",
      text: "Dana assigned this conversation to Tariq",
    },
    {
      id: "hv-out-1",
      kind: "outbound",
      by: "Tariq",
      body:
        "Morning Greg, Tariq from Northline Heating. Three flashes points to a pressure-switch lockout, often a blocked intake or the induced-draft motor. I can be there by 11. Diagnostic is $120 and applies to the repair. In the meantime, keep the thermostat set and don't keep resetting it. Okay to head over?",
      time: "6:55 AM",
      delivered: "delivered",
    },
    {
      id: "hv-in-2",
      kind: "inbound",
      from: "Greg P",
      body: "Yes please, 11 works. We're bundling up till then",
      time: "6:58 AM",
    },
    {
      id: "hv-event-2",
      kind: "event",
      text: "Tariq added the tag Scheduled",
    },
  ],
};

/* -------------------------------------------------------------------------- */
/* Salons, appointment confirmation + a rebook, front desk is one person.     */
/* Distinct jargon: color consult, root touch-up, stylist, waitlist.          */
/* -------------------------------------------------------------------------- */

export const SALONS_SCRIPT: ThreadScript = {
  contact: { name: "Bri L", number: "(416) 555-0192" },
  finalStatus: "open",
  assignee: "Jess",
  beats: [
    {
      id: "sa-in-1",
      kind: "inbound",
      from: "Bri L",
      body:
        "Hi! Confirming my color appointment Saturday. Also. I'd love to go a few shades lighter than last time, is that something we can talk through first?",
      photo: { label: "Hair color inspo" },
      time: "1:04 PM",
    },
    {
      id: "sa-note-1",
      kind: "note",
      by: "Priya",
      body:
        "Bri's booked with Jess 2pm Sat. Big lift from her current level, flag it so Jess adds time and a bond treatment.",
      time: "1:08 PM",
    },
    {
      id: "sa-event-1",
      kind: "event",
      text: "Priya assigned this conversation to Jess",
    },
    {
      id: "sa-out-1",
      kind: "outbound",
      by: "Jess",
      body:
        "Hi Bri! You're confirmed for Saturday at 2 with me. That inspo is a bigger lift from where we are now, so I'll block extra time and add a bond treatment to keep it healthy, it'll run a little more than a root touch-up. Want me to text you the updated total before Saturday?",
      time: "1:15 PM",
      delivered: "delivered",
    },
    {
      id: "sa-in-2",
      kind: "inbound",
      from: "Bri L",
      body: "Yes please! And thank you for the heads up on the price",
      time: "1:19 PM",
    },
    {
      id: "sa-event-2",
      kind: "event",
      text: "Jess added the tag Scheduled",
    },
  ],
};

/* -------------------------------------------------------------------------- */
/* Contractors, the builder-sends-address-and-paint-color scenario, made      */
/* concrete via D14 mark-done: EACH text is a task the crew works through and  */
/* checks off in the thread (DECISIONS D14, the message IS the task; NO jobs  */
/* feature). Distinct jargon: GC, subs, change order, punch list.              */
/*                                                                            */
/* `done` beats carry the D14 done state (line-through + petrol check badge),  */
/* rendered by the trades-owned <TradeThread> done wrapper.                     */
/* -------------------------------------------------------------------------- */

export const CONTRACTORS_SCRIPT: ThreadScript = {
  contact: { name: "Ben (GC)", number: "(289) 555-0137" },
  finalStatus: "open",
  assignee: "Luis",
  beats: [
    {
      id: "co-in-1",
      kind: "inbound",
      from: "Ben (GC)",
      body:
        "Crew's starting the Riverside unit tomorrow. Address is 214 Riverside, lockbox 7-1-9-0. Powder room and hall get Chantilly Lace, primary bedroom is Hale Navy, two coats.",
      time: "4:02 PM",
    },
    {
      id: "co-note-1",
      kind: "note",
      by: "Luis",
      body:
        "Marking Ben's address + paint text done once I've read it out to the crew and loaded the paint. Change orders go through me, not the client.",
      time: "4:10 PM",
    },
    {
      id: "co-out-1",
      kind: "outbound",
      by: "Luis",
      body:
        "Got it Ben, 214 Riverside, code 7190, Chantilly Lace in the powder room and hall, Hale Navy two coats in the primary. I'll have the crew there at 7. I'll text you a photo once the primary's cut in.",
      time: "4:16 PM",
      delivered: "delivered",
    },
    {
      id: "co-in-2",
      kind: "inbound",
      from: "Ben (GC)",
      body:
        "One change, client wants the hall in Hale Navy too now, not Chantilly. Can you price the extra coat?",
      time: "8:47 AM",
    },
    {
      id: "co-out-2",
      kind: "outbound",
      by: "Luis",
      body:
        "No problem. Hall in Hale Navy instead is an extra $140 for the color switch and second coat. Say the word and I'll write it up as a change order.",
      time: "8:52 AM",
      delivered: "delivered",
    },
  ],
};

/**
 * The done-marked beat ids for the contractors thread (D14). The trades-owned
 * <TradeThread> renders these two with strikethrough + the petrol check badge:
 * the address/paint spec is done (crew briefed, paint loaded) and Luis's
 * confirmation is done. The live change-order turn is left open, a new task,
 * not yet worked through, so the reader sees the thread as a working task list.
 */
export const CONTRACTORS_DONE_IDS: readonly string[] = ["co-in-1", "co-out-1"];

/**
 * The D14 done-badge tooltip/label text per done beat, so the marketing
 * illustration reads like the app's real "Done · Sam · 2:14 PM" badge.
 */
export const CONTRACTORS_DONE_LABELS: Record<string, string> = {
  "co-in-1": "Done · Luis · 4:12 PM",
  "co-out-1": "Done · Luis · 4:18 PM",
};
