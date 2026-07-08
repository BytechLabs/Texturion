import type { PortStepKey } from "./port-ui-state";

/**
 * Customer-facing porting copy (PORTING.md §8/§9 — exact, honest strings).
 * Shared by the onboarding port wizard and the Settings port card so the
 * timeline promise can never drift between surfaces. Tone matches the §4.4
 * registration copy: plain, no false urgency, no "instant".
 */

/** The 4-step tracker labels + owner-facing meaning (PORTING.md §8.2 table). */
export const PORT_STEP_COPY: Record<
  PortStepKey,
  { label: string; meaning: string }
> = {
  submitted: {
    label: "Transfer requested",
    meaning: "We've sent the transfer request to your current carrier.",
  },
  date_confirmed: {
    label: "Switch-over date confirmed",
    meaning: "Your carrier confirmed the date your number moves to Loonext.",
  },
  number_switched: {
    label: "Number switched",
    meaning: "Your number moved to Loonext. Turning on texting now.",
  },
  texting_live: {
    label: "Texting live",
    meaning: "Text your customers straight from Loonext.",
  },
};

/** Portability check result copy (PORTING.md §9, pre-pay). */
export function portabilityOkCopy(display: string): string {
  return `Good news: ${display} can move to Loonext. It'll keep working with your current carrier until the switch-over date.`;
}

export function portabilityFailCopy(reason: string | null): string {
  const why = reason?.trim()
    ? reason.trim()
    : "the carrier reports it can't be transferred right now";
  return `We can't transfer this number: ${why}. You can start with a new local number instead.`;
}

/**
 * The honest window shown before payment / on the port wizard (PORTING.md §8.1
 * checkout copy, plain-language distillation). Kept short — the wizard shows one
 * warm sentence, not a wall of compliance text.
 */
export const PORT_HONEST_WINDOW =
  "Your number keeps working with your current provider until the switch completes, usually 1 to 7 business days. We'll email you when it's ready.";

/** The pre-payment checkout expectation card lines (PORTING.md §8.1). */
export const PORT_CHECKOUT_TIMELINE = [
  "Your number keeps working on your current carrier the whole time.",
  "It switches to Loonext on the transfer date, usually a few business days to about two weeks (US), often faster in Canada.",
  "Texting through Loonext starts once the switch completes. We'll show you exactly where it is and email you at each step.",
] as const;

/** Per-state banner copy for the Settings port card (PORTING.md §9). */
export const PORT_STATE_COPY = {
  submitted:
    "Transfer in progress. We've sent the request to your current carrier. They usually respond within a couple of business days. Your number still works on your old carrier for now.",
  focConfirmed: (date: string) =>
    `Locked in. Your number switches to Loonext on ${date}. Nothing works differently until then. We'll email you when it switches.`,
  numberSwitched:
    "Your number moved to Loonext. We're turning on texting now, usually about 10 minutes, occasionally a business day or two. We'll email you the moment it's ready.",
  textingLive:
    "Your number is live on Loonext. Text your customers straight from here.",
  voiceException: (reason: string | null) =>
    `Your carrier flagged something on the transfer: ${
      reason?.trim().replace(/[.!?]+$/, "") ||
      "they didn't say exactly what, so check your details below"
    }. Fix it and resubmit. It usually takes a couple of minutes, and there's no fee to try again.`,
  messagingException:
    "Your number moved over, but texting is taking a bit longer. Your old provider hasn't released the texting routing yet. We're escalating with the carrier on your behalf; this usually clears within a business day or two and there's nothing you need to do.",
  assignmentBlocked: (number: string) =>
    `One more step: ask your previous texting provider to remove ${number} from their carrier campaign, then we'll finish connecting it. We'll retry automatically once they do.`,
  documentsPending:
    "Almost there. Upload your signed authorization (LOA) and a recent bill, then submit the transfer to your carrier.",
  bridgeAvailable: (bridge: string) =>
    `Your temporary number ${bridge} is ready so you can text today. Once your real number finishes transferring, you can release the temporary one.`,
} as const;

/** Plain one-liners explaining the two required documents (labels, not jargon). */
export const PORT_DOCUMENT_HINTS = {
  loa: "A signed letter authorizing the transfer. Sign it within the last 90 days, and make sure it lists this number and your service address.",
  loaCa: "Canadian carriers use a standard letter. Download the template, sign it, and upload it here.",
  invoice:
    "A recent bill from your current carrier, less than 30 days old, showing this number and your service address.",
} as const;

/** Telnyx Canadian LOA template (PORTING.md §3.2 — linked for CA ports). */
export const CANADIAN_LOA_TEMPLATE_URL =
  "https://support.telnyx.com/en/articles/6205951-porting-a-canadian-number";
