import type { MarketingLocale } from "@/i18n/marketing/footer";
import { fill } from "@/i18n/marketing/home";
import { DEMO_CAST, threadDemoCopy } from "@/i18n/marketing/thread-demo";

/**
 * Thread-demo script model.
 *
 * The shared thread components are parameterized by a script: an ordered list
 * of beats that replicate the app's real inbox thread in the marketing site's
 * own DOM. The primitives use the app's exact visual language (inbound white
 * card, outbound petrol bubble, amber internal notes, delivery states,
 * centered system lines, all in app tokens per Law 2) but carry no app
 * runtime (no TanStack Query, no Supabase) so they render on a static
 * marketing route and hydrate as a tiny island.
 *
 * Every script here is drawn verbatim from COPY-DECK v2 (§S4 water-heater
 * thread is the canonical one, used by the home "The fix, shown" deep-dive).
 * Nothing is invented: names, numbers (555-01XX safe fictional range), and
 * copy all match the seed company "Reyes Plumbing & Heating". No em-dashes
 * anywhere (Law 6): ranges read "between 9 and 11".
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
  /**
   * This line is the assignment: the thread header's assignee avatar appears
   * once it is revealed. Data-driven on purpose, the deep-dive used to test
   * `step >= 3`, a literal that silently pointed at the wrong beat the moment
   * a beat was inserted ahead of it.
   */
  revealsAssignee?: boolean;
}

/**
 * A call in the thread (#129, D36 to D43). Calling has shipped on every plan
 * since D43 and the product threads calls next to texts, so a demo built only
 * from texts under-reports the conversation by half (#491).
 *
 * Every sentence this renders is the APP'S OWN, lifted from
 * `components/thread/system-line.tsx` `eventSentence`. Nothing here invents a
 * phrase the product would not print.
 */
export interface CallBeat extends BaseBeat {
  kind: "call";
  /** Inbound = the customer called us; outbound = the crew called them. */
  direction: "inbound" | "outbound";
  outcome: "answered" | "missed" | "voicemail";
  /** Talk time, rendered as the app's "· 4m 12s" tail. Answered calls only. */
  seconds?: number;
  /**
   * D43: the caller left a message. The line carries its length and the
   * player renders beneath it, with the Whisper transcript under that.
   */
  voicemail?: { seconds: number; transcript: string };
  /**
   * The FEATURE-GAPS missed-call line: the automatic text-back fired, so the
   * thread also says so. The reply itself is the outbound beat that follows.
   */
  textBack?: boolean;
}

export type ThreadBeat =
  | InboundBeat
  | OutboundBeat
  | NoteBeat
  | EventBeat
  | CallBeat;

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
 * §S4 canonical thread, the water-heater emergency, steppable and annotated
 * in the home "The fix, shown" section. Copy is verbatim from COPY-DECK v2
 * §S4.
 *
 * #491: the thread now opens the way the job actually starts, with a call
 * nobody could take. Karen rings the business number while the crew is under
 * a sink, leaves a voicemail, and the missed call texts her back on its own,
 * all of it in the same conversation her photo lands in ninety seconds later.
 * That is the single most load-bearing thing this page can show, because a
 * demo made of texts is what made the whole product read as a texting tool.
 */
export const waterHeaterScript = (
  locale: MarketingLocale = "en",
): ThreadScript => {
  const copy = threadDemoCopy(locale);
  return {
  contact: { name: DEMO_CAST.karen, number: "(416) 555-0187" },
  finalStatus: "waiting",
  assignee: DEMO_CAST.dale,
  beats: [
    {
      id: "call-1",
      kind: "call",
      direction: "inbound",
      outcome: "voicemail",
      voicemail: {
        seconds: 34,
        transcript: copy.waterVoicemail,
      },
      textBack: true,
      step: 1,
    },
    {
      id: "out-0",
      kind: "outbound",
      by: DEMO_CAST.business,
      body: copy.waterTextBack,
      time: "2:39 PM",
      delivered: "delivered",
    },
    {
      id: "in-1",
      kind: "inbound",
      from: DEMO_CAST.karen,
      body: copy.waterInbound,
      photo: { label: copy.waterPhotoLabel },
      time: "2:41 PM",
      step: 2,
    },
    {
      id: "note-1",
      kind: "note",
      by: DEMO_CAST.priya,
      body: copy.waterNote,
      time: "2:43 PM",
      step: 3,
    },
    {
      id: "event-1",
      kind: "event",
      text: fill(copy.waterAssigned, {
        by: DEMO_CAST.priya,
        to: DEMO_CAST.dale,
      }),
      revealsAssignee: true,
      step: 4,
    },
    {
      id: "out-1",
      kind: "outbound",
      by: DEMO_CAST.dale,
      body: copy.waterReply,
      time: "2:52 PM",
      delivered: "delivered",
      step: 5,
    },
    {
      id: "in-2",
      kind: "inbound",
      from: DEMO_CAST.karen,
      body: copy.waterConfirm,
      time: "2:58 PM",
    },
    {
      id: "event-2",
      kind: "event",
      text: fill(copy.waterTagged, {
        by: DEMO_CAST.dale,
        tag: copy.tagScheduled,
      }),
      step: 6,
    },
  ],
  };
};

/** The English thread, for the tests and any English-only surface. */
export const WATER_HEATER_SCRIPT: ThreadScript = waterHeaterScript("en");

/**
 * §S6 cell 9 phone thread ("Built for the truck, not the desk"): a short
 * early-morning exchange that reads well in the app's own dark mode inside
 * the phone Panel Frame. Trade-plausible one-liners (BLUEPRINT §10.1 permits
 * these for seed threads), attributed to the same Reyes crew.
 *
 * #491: Dale places the call from the same phone, in the same thread. The
 * cell's claim is that the whole product fits in a pocket, and the softphone
 * (D36 to D43) is the half of it that was never depicted.
 */
export const darkBandScript = (
  locale: MarketingLocale = "en",
): ThreadScript => {
  const copy = threadDemoCopy(locale);
  return {
  contact: { name: DEMO_CAST.marcus, number: "(647) 555-0121" },
  finalStatus: "open",
  assignee: DEMO_CAST.dale,
  beats: [
    {
      id: "d-in-1",
      kind: "inbound",
      from: DEMO_CAST.marcus,
      body: copy.darkInbound,
      time: "6:12 AM",
    },
    {
      id: "d-out-1",
      kind: "outbound",
      by: DEMO_CAST.dale,
      body: copy.darkReply,
      time: "6:14 AM",
      delivered: "delivered",
    },
    {
      id: "d-call-1",
      kind: "call",
      direction: "outbound",
      outcome: "answered",
      seconds: 42,
    },
    {
      id: "d-in-2",
      kind: "inbound",
      from: DEMO_CAST.marcus,
      body: copy.darkThanks,
      time: "6:15 AM",
    },
  ],
  };
};

/** The English thread, for the tests and any English-only surface. */
export const DARK_BAND_SCRIPT: ThreadScript = darkBandScript("en");

