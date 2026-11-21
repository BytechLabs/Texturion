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

import type { MarketingLocale } from "@/i18n/marketing/footer";
import { fill } from "@/i18n/marketing/home";
import { cleanersCopy } from "@/i18n/marketing/for-cleaners";
import { contractorsCopy } from "@/i18n/marketing/for-contractors";
import { hvacCopy } from "@/i18n/marketing/for-hvac";
import { landscapersCopy } from "@/i18n/marketing/for-landscapers";
import { plumbersCopy } from "@/i18n/marketing/for-plumbers";
import { salonsCopy } from "@/i18n/marketing/for-salons";
import { demoClock } from "@/lib/marketing/demo-clock";

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

/**
 * A call in the thread (#129, D36 to D43), same model as the shared
 * thread-demo <CallBeat>. #491: calling ships on every plan and every one of
 * these six threads was made of texts, which is most of why the six highest
 * intent pages on the site read as a texting tool.
 *
 * Each page stages a DIFFERENT half of the calling surface on purpose, so a
 * reader who lands on two of them learns two true things rather than the same
 * one twice: inbound voicemail with the text-back, an inbound call the office
 * answered, an outbound call that went unanswered, and an outbound call that
 * was picked up.
 */
export interface TradeCallBeat {
  id: string;
  kind: "call";
  direction: "inbound" | "outbound";
  outcome: "answered" | "missed" | "voicemail";
  /** Talk time, rendered as the app's "· 4m 12s" tail. Answered calls only. */
  seconds?: number;
  /** D43: the caller left a message, so the player and its words render. */
  voicemail?: { seconds: number; transcript: string };
  /** The automatic text-back fired; the reply is the outbound beat after it. */
  textBack?: boolean;
}

export type TradeBeat =
  | TradeInboundBeat
  | TradeNoteBeat
  | TradeOutboundBeat
  | TradeEventBeat
  | TradeCallBeat;

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

export const plumbersScript = (
  locale: MarketingLocale = "en",
): TradeScript => {
  const copy = plumbersCopy(locale);
  return {
  contact: { name: "Marcus T", number: "(647) 555-0121" },
  status: "waiting",
  assignee: "Dale",
  beats: [
    {
      id: "pl-call-1",
      kind: "call",
      direction: "inbound",
      outcome: "voicemail",
      voicemail: { seconds: 27, transcript: copy.scriptVoicemail },
      textBack: true,
    },
    {
      id: "pl-out-0",
      kind: "outbound",
      body: copy.scriptTextBack,
      time: demoClock("9:02 PM", locale),
    },
    {
      id: "pl-in-1",
      kind: "inbound",
      body: copy.scriptInbound,
      photoLabel: copy.scriptPhotoLabel,
      time: demoClock("9:04 PM", locale),
    },
    {
      id: "pl-note-1",
      kind: "note",
      by: "Priya",
      body: copy.scriptNote,
      time: demoClock("9:09 PM", locale),
    },
    {
      id: "pl-event-1",
      kind: "event",
      text: fill(copy.scriptAssigned, { by: "Priya", to: "Dale" }),
    },
    {
      id: "pl-out-1",
      kind: "outbound",
      body: copy.scriptQuote,
      time: demoClock("9:14 PM", locale),
    },
    {
      id: "pl-in-2",
      kind: "inbound",
      body: copy.scriptBooked,
      time: demoClock("9:17 PM", locale),
    },
    {
      id: "pl-event-2",
      kind: "event",
      text: fill(copy.scriptTagged, { by: "Dale", tag: copy.scriptTagScheduled }),
    },
  ],
  };
};

/** The English thread, for tests and any English-only surface. */
export const PLUMBERS_SCRIPT: TradeScript = plumbersScript("en");

/* -------------------------------------------------------------------------- */
/* HVAC: the 6:48 AM no-heat text with a thermostat error photo; the office    */
/* reads the code, the "bring the capacitor" note rides the van (v2 script).   */
/* -------------------------------------------------------------------------- */

export const hvacScript = (
  locale: MarketingLocale = "en",
): TradeScript => {
  const copy = hvacCopy(locale);
  return {
  contact: { name: "Greg P", number: "(613) 555-0143" },
  status: "waiting",
  assignee: "Tariq",
  beats: [
    {
      id: "hv-call-1",
      kind: "call",
      direction: "inbound",
      outcome: "missed",
      textBack: true,
    },
    {
      id: "hv-out-0",
      kind: "outbound",
      body: copy.scriptTextBack,
      time: demoClock("6:46 AM", locale),
    },
    {
      id: "hv-in-1",
      kind: "inbound",
      body: copy.scriptInbound,
      photoLabel: copy.scriptPhotoLabel,
      time: demoClock("6:48 AM", locale),
    },
    {
      id: "hv-note-1",
      kind: "note",
      by: "Dana",
      body: copy.scriptNote,
      time: demoClock("6:52 AM", locale),
    },
    {
      id: "hv-event-1",
      kind: "event",
      text: fill(copy.scriptAssigned, { by: "Dana", to: "Tariq" }),
    },
    {
      id: "hv-out-1",
      kind: "outbound",
      body: copy.scriptReply,
      time: demoClock("6:57 AM", locale),
    },
    {
      id: "hv-in-2",
      kind: "inbound",
      body: copy.scriptConfirm,
      time: demoClock("7:01 AM", locale),
    },
    {
      id: "hv-event-2",
      kind: "event",
      text: fill(copy.scriptTagged, { by: "Tariq", tag: copy.scriptTagScheduled }),
    },
  ],
  };
};

/** The English thread, for tests and any English-only surface. */
export const HVAC_SCRIPT: TradeScript = hvacScript("en");

/* -------------------------------------------------------------------------- */
/* Landscapers: 7:15 AM, the crew is at a locked gate; the code request turns  */
/* into a back-beds upsell (v2 script).                                        */
/* -------------------------------------------------------------------------- */

export const landscapersScript = (
  locale: MarketingLocale = "en",
): TradeScript => {
  const copy = landscapersCopy(locale);
  return {
  contact: { name: "Diane Alvarez", number: "(905) 555-0164" },
  status: "open",
  assignee: "Sofia",
  beats: [
    {
      id: "ls-call-1",
      kind: "call",
      direction: "outbound",
      outcome: "missed",
    },
    {
      id: "ls-out-1",
      kind: "outbound",
      body: copy.scriptGateAsk,
      time: demoClock("7:15 AM", locale),
    },
    {
      id: "ls-in-1",
      kind: "inbound",
      body: copy.scriptCodeReply,
      time: demoClock("7:19 AM", locale),
    },
    {
      id: "ls-note-1",
      kind: "note",
      by: "Marco",
      body: copy.scriptNote,
      time: demoClock("7:22 AM", locale),
    },
    {
      id: "ls-event-1",
      kind: "event",
      text: fill(copy.scriptAssigned, { by: "Marco", to: "Sofia" }),
    },
    {
      id: "ls-out-2",
      kind: "outbound",
      body: copy.scriptReply,
      time: demoClock("7:26 AM", locale),
    },
    {
      id: "ls-event-2",
      kind: "event",
      text: fill(copy.scriptTagged, { by: "Sofia", tag: copy.scriptTagQuoteSent }),
    },
  ],
  };
};

/** The English thread, for tests and any English-only surface. */
export const LANDSCAPERS_SCRIPT: TradeScript = landscapersScript("en");

/* -------------------------------------------------------------------------- */
/* Cleaners: 5:56 PM, new access instructions (key under the mat) plus a       */
/* Friday-to-Monday reschedule (v2 script).                                    */
/* -------------------------------------------------------------------------- */

export const cleanersScript = (
  locale: MarketingLocale = "en",
): TradeScript => {
  const copy = cleanersCopy(locale);
  return {
  contact: { name: "Nadia K", number: "(437) 555-0178" },
  status: "waiting",
  assignee: "Rosa",
  beats: [
    {
      id: "cl-call-1",
      kind: "call",
      direction: "inbound",
      outcome: "answered",
      seconds: 96,
    },
    {
      id: "cl-in-1",
      kind: "inbound",
      body: copy.scriptInbound,
      time: demoClock("5:56 PM", locale),
    },
    {
      id: "cl-note-1",
      kind: "note",
      by: "Elena",
      body: copy.scriptNote,
      time: demoClock("6:03 PM", locale),
    },
    {
      id: "cl-event-1",
      kind: "event",
      text: fill(copy.scriptAssigned, { by: "Elena", to: "Rosa" }),
    },
    {
      id: "cl-out-1",
      kind: "outbound",
      body: copy.scriptReply,
      time: demoClock("6:10 PM", locale),
    },
    {
      id: "cl-in-2",
      kind: "inbound",
      body: copy.scriptConfirm,
      time: demoClock("6:14 PM", locale),
    },
    {
      id: "cl-event-2",
      kind: "event",
      text: fill(copy.scriptTagged, { by: "Rosa", tag: copy.scriptTagScheduled }),
    },
  ],
  };
};

/** The English thread, for tests and any English-only surface. */
export const CLEANERS_SCRIPT: TradeScript = cleanersScript("en");

/* -------------------------------------------------------------------------- */
/* Salons: 11:20 AM, the running-late text, rescued between stylists           */
/* (v2 script: the reschedule is handled by whoever is free).                  */
/* -------------------------------------------------------------------------- */

export const salonsScript = (
  locale: MarketingLocale = "en",
): TradeScript => {
  const copy = salonsCopy(locale);
  return {
  contact: { name: "Bri L", number: "(416) 555-0192" },
  status: "open",
  assignee: "Maya",
  beats: [
    {
      id: "sa-in-1",
      kind: "inbound",
      body: copy.scriptInbound,
      time: demoClock("11:20 AM", locale),
    },
    {
      id: "sa-note-1",
      kind: "note",
      by: "Renee",
      body: copy.scriptNote,
      time: demoClock("11:22 AM", locale),
    },
    {
      id: "sa-event-1",
      kind: "event",
      text: fill(copy.scriptAssigned, { by: "Renee", to: "Maya" }),
    },
    {
      id: "sa-out-1",
      kind: "outbound",
      body: copy.scriptReply,
      time: demoClock("11:24 AM", locale),
    },
    {
      id: "sa-in-2",
      kind: "inbound",
      body: copy.scriptThanks,
      time: demoClock("11:26 AM", locale),
    },
    {
      id: "sa-call-1",
      kind: "call",
      direction: "outbound",
      outcome: "answered",
      seconds: 107,
    },
    {
      id: "sa-event-2",
      kind: "event",
      text: fill(copy.scriptTagged, { by: "Maya", tag: copy.scriptTagScheduled }),
    },
  ],
  };
};

/** The English thread, for tests and any English-only surface. */
export const SALONS_SCRIPT: TradeScript = salonsScript("en");

/* -------------------------------------------------------------------------- */
/* Contractors: 8:02 AM, a homeowner change request filed against the job,     */
/* assigned, priced, and approved in writing (v2 script). The original         */
/* request carries the app's D14 done state once it's been written up.        */
/* -------------------------------------------------------------------------- */

export const contractorsScript = (
  locale: MarketingLocale = "en",
): TradeScript => {
  const copy = contractorsCopy(locale);
  return {
  contact: { name: "Karen H", number: "(289) 555-0137" },
  status: "open",
  assignee: "Omar",
  beats: [
    {
      id: "co-call-1",
      kind: "call",
      direction: "inbound",
      outcome: "voicemail",
      voicemail: { seconds: 41, transcript: copy.scriptVoicemail },
      textBack: true,
    },
    {
      id: "co-out-0",
      kind: "outbound",
      body: copy.scriptTextBack,
      time: demoClock("7:59 AM", locale),
    },
    {
      id: "co-in-1",
      kind: "inbound",
      body: copy.scriptInbound,
      time: demoClock("8:02 AM", locale),
    },
    {
      id: "co-note-1",
      kind: "note",
      by: "Luis",
      body: copy.scriptNote,
      time: demoClock("8:06 AM", locale),
    },
    {
      id: "co-event-1",
      kind: "event",
      text: fill(copy.scriptAssigned, { by: "Luis", to: "Omar" }),
    },
    {
      id: "co-out-1",
      kind: "outbound",
      body: copy.scriptReply,
      time: demoClock("8:11 AM", locale),
    },
    {
      id: "co-in-2",
      kind: "inbound",
      body: copy.scriptApproved,
      time: demoClock("8:15 AM", locale),
    },
    {
      id: "co-event-2",
      kind: "event",
      text: fill(copy.scriptTagged, { by: "Omar", tag: copy.scriptTagWon }),
    },
  ],
  doneIds: ["co-in-1"],
  doneLabels: { "co-in-1": copy.scriptDoneLabel },
  };
};

/** The English thread, for tests and any English-only surface. */
export const CONTRACTORS_SCRIPT: TradeScript = contractorsScript("en");
