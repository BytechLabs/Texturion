/**
 * #228 — the English an extra-number refusal goes out in, on the wire.
 *
 * `extraNumberBlockedReason` names catalogue keys now, and three clients
 * resolve them in the reader's language. The API cannot: it composes an
 * `errorResponse` body, and
 *
 *   1. a client built last month renders that body verbatim, and
 *   2. the server does not know the reader's language anyway —
 *      `profiles.locale`'s null means "ask the device, then the workspace",
 *      the device half only exists on the client, and no client sends it.
 *
 * So the wire stays English and the CLIENTS translate, which is the same
 * expand-and-contract `payoutReadinessCopy` is in. This table is the English
 * half, kept here rather than in `packages/shared` for one reason: it is the
 * server's obligation, not a shared rule, and putting it in the shared module
 * would put it back in front of the clients that have already moved on.
 *
 * The strings must stay word-for-word identical to the English in
 * `apps/web/src/i18n/sections/settingsMore.ts`. A test asserts exactly that —
 * two copies of a sentence with no check between them is how #389 happened.
 */
import type { ExtraNumberKey } from "@loonext/shared";

export const EXTRA_NUMBER_REASONS_EN: Record<ExtraNumberKey, string> = {
  "settingsMore.extraNumberUsTexting":
    "An extra number needs US texting turned on for your workspace first.",
  /*
   * `{max}` is filled by the caller, not here: the number is
   * STARTER_MAX_TOTAL_NUMBERS and the shared module owns it. A figure typed
   * into this sentence is a figure that goes stale the day the cap moves.
   */
  "settingsMore.extraNumberStarterCap":
    "Starter tops out at {max} numbers (1 included + 1 extra). Move to Pro for more.",
  "settingsMore.extraNumberCurrency":
    "Extra numbers are priced in US dollars and can't be added to a " +
    "subscription billed in another currency yet. Contact support and we'll " +
    "sort it out.",
};
