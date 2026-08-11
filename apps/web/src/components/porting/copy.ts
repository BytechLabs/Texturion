import { DEFAULT_LOCALE } from "@loonext/shared";

import { makeTranslate, type Translate } from "@/i18n/provider";

import type { PortStepKey } from "./port-ui-state";

/**
 * Customer-facing porting copy (PORTING.md §8/§9 — exact, honest strings).
 * Shared by the onboarding port wizard and the Settings port card so the
 * timeline promise can never drift between surfaces. Tone matches the §4.4
 * registration copy: plain, no false urgency, no "instant".
 */

/**
 * #228: English is the DEFAULT here, not the only option.
 *
 * The sentences themselves now live in `i18n/sections/settingsMore.ts`, in both
 * languages. What stays in this module is the DECISION of which one a given
 * transfer state deserves — which is the part `port-ui-state.test.ts` and
 * `port-card.test.tsx` assert, with no provider in the room.
 *
 * So every function here takes the reader's own `t` and falls back to English,
 * and the plain constants resolve through English at import time. A caller that
 * has a reader (any `"use client"` component, through `useT()`) should pass it;
 * a caller that has not been converted yet reads exactly what it read before.
 */
const EN = makeTranslate(DEFAULT_LOCALE);

/** The 4-step tracker labels + owner-facing meaning (PORTING.md §8.2 table). */
export const PORT_STEP_COPY: Record<
  PortStepKey,
  { label: string; meaning: string }
> = {
  submitted: {
    label: EN("settingsMore.portStepSubmittedLabel"),
    meaning: EN("settingsMore.portStepSubmittedMeaning"),
  },
  date_confirmed: {
    label: EN("settingsMore.portStepDateConfirmedLabel"),
    meaning: EN("settingsMore.portStepDateConfirmedMeaning"),
  },
  number_switched: {
    label: EN("settingsMore.portStepNumberSwitchedLabel"),
    meaning: EN("settingsMore.portStepNumberSwitchedMeaning"),
  },
  texting_live: {
    label: EN("settingsMore.portStepTextingLiveLabel"),
    meaning: EN("settingsMore.portStepTextingLiveMeaning"),
  },
};

/** Portability check result copy (PORTING.md §9, pre-pay). */
export function portabilityOkCopy(display: string, t: Translate = EN): string {
  return t("settingsMore.portabilityOk", { number: display });
}

export function portabilityFailCopy(
  reason: string | null,
  t: Translate = EN,
): string {
  const why = reason?.trim()
    ? reason.trim()
    : t("settingsMore.portabilityFailReasonUnknown");
  return t("settingsMore.portabilityFail", { reason: why });
}

/**
 * The honest window shown before payment / on the port wizard (PORTING.md §8.1
 * checkout copy, plain-language distillation). Kept short — the wizard shows one
 * warm sentence, not a wall of compliance text.
 */
export const PORT_HONEST_WINDOW = EN("settingsMore.portHonestWindow");

/** The pre-payment checkout expectation card lines (PORTING.md §8.1). */
export const PORT_CHECKOUT_TIMELINE = [
  EN("settingsMore.portTimelineKeepsWorking"),
  EN("settingsMore.portTimelineSwitchDate"),
  EN("settingsMore.portTimelineTextingStarts"),
] as const;

/**
 * Per-state banner copy for the Settings port card (PORTING.md §9).
 *
 * The four states that interpolate something take `t` as a trailing argument;
 * the five that do not are resolved in English at import time, and their
 * translated twins are one `t("settingsMore.portState…")` away at the call site.
 */
export const PORT_STATE_COPY = {
  submitted: EN("settingsMore.portStateSubmitted"),
  focConfirmed: (date: string, t: Translate = EN) =>
    t("settingsMore.portStateFocConfirmed", { date }),
  numberSwitched: EN("settingsMore.portStateNumberSwitched"),
  textingLive: EN("settingsMore.portStateTextingLive"),
  voiceException: (reason: string | null, t: Translate = EN) =>
    t("settingsMore.portStateVoiceException", {
      reason:
        reason?.trim().replace(/[.!?]+$/, "") ||
        t("settingsMore.portStateVoiceExceptionReasonUnknown"),
    }),
  messagingException: EN("settingsMore.portStateMessagingException"),
  assignmentBlocked: (number: string, t: Translate = EN) =>
    t("settingsMore.portStateAssignmentBlocked", { number }),
  documentsPending: EN("settingsMore.portStateDocumentsPending"),
  bridgeAvailable: (bridge: string, t: Translate = EN) =>
    t("settingsMore.portStateBridgeAvailable", { bridge }),
} as const;

/**
 * What the customer should DO while the transfer is in flight (#319). All four
 * lines existed already, in a marketing blog post — which is the one place a
 * customer who is *already mid-port* will never look. Two of them are why this
 * is worth the space:
 *
 *   - cancelling the old service before the port finishes can release the
 *     number back into the carrier pool, and that is the one way to genuinely
 *     lose it. It is one of the two mistakes behind almost every port horror
 *     story, and it is the only one the customer can make by accident while
 *     doing what feels tidy.
 *   - the number moves; the conversations do not. Export is only possible
 *     BEFORE the cutover, so saying it afterwards costs them the history.
 *
 * Ordered by what it costs to get wrong rather than by chronology — the item
 * that can lose them the number goes first, because a skim reads the bold leads
 * top-down and stops early.
 *
 * Exported as data (not inlined in the card) so the same four strings can be
 * asserted across web/Android/iOS: this is guidance a customer may read on one
 * client and act on from another, and it drifts silently if hand-kept.
 */
// #248: MOVED TO `@loonext/shared` AND RE-EXPORTED HERE, which is what the
// paragraph above was always asking for. It said these four strings exist as data
// so they can be asserted across web/Android/iOS, "and it drifts silently if
// hand-kept" — and then they lived in a web-only file, so neither phone ever said
// any of it. A port is managed from whatever device is to hand, and the mistake
// the first line prevents is available on all of them.
//
// Re-exported rather than moved-and-rewritten so every call site here is
// unchanged, and there is still exactly one definition.
export { PORT_PRE_CUTOVER_CHECKLIST } from "@loonext/shared";

/** Plain one-liners explaining the two required documents (labels, not jargon). */
export const PORT_DOCUMENT_HINTS = {
  loa: EN("settingsMore.portHintLoa"),
  loaCa: EN("settingsMore.portHintLoaCa"),
  invoice: EN("settingsMore.portHintInvoice"),
} as const;

/** Telnyx Canadian LOA template (PORTING.md §3.2 — linked for CA ports). */
export const CANADIAN_LOA_TEMPLATE_URL =
  "https://support.telnyx.com/en/articles/6205951-porting-a-canadian-number";
