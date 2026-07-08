import type { BillingModule } from "@/lib/api/billing";
import type { Message } from "@/lib/api/types";

/**
 * #62 / #23 — pure logic for the Picture-messages (mms) add-on gate and the
 * cap-and-drop detector, shared by the in-thread composer and /inbox/new.
 * Kept side-effect free so both composers render ONE consistent pattern and
 * the rules are unit-testable as plain functions.
 */

/** Where the add-on is switched on — Settings › Billing (Plan add-ons). */
export const MMS_SETTINGS_PATH = "/settings/billing";

/** #62 pointer copy — mirrors the API's 409 for a gated media send. */
export const MMS_GATE_MESSAGE =
  "Sending pictures needs the Picture messages add-on.";
export const MMS_GATE_ACTION_LABEL = "Turn it on";

/** #23 toast action — points at the add-ons list on the billing page. */
export const MMS_DROP_ACTION_LABEL = "Plan add-ons";

/**
 * #62: true when the module list has LOADED and `mms` is off. While the list
 * is still loading (or failed) the affordance stays available — the API 409s
 * a gated media send anyway, so "unknown" must not flicker the button away
 * from the majority who have the add-on.
 */
export function mmsAttachGated(
  modules: readonly BillingModule[] | undefined,
): boolean {
  if (!modules) return false;
  return !(modules.find((m) => m.id === "mms")?.enabled ?? false);
}

/**
 * #23: the API cap-and-drops photos with a 2xx — over the included-MMS cap it
 * strips the media and sends text-only, and the ONLY signal is the returned
 * row coming back without attachments. Detect exactly that: media was
 * requested, the server row carries none.
 */
export function photosDropped(
  requestedCount: number,
  message: Pick<Message, "attachments">,
): boolean {
  return requestedCount > 0 && (message.attachments?.length ?? 0) === 0;
}

/** #23 honest-feedback copy — the text went out, the photo(s) did not. */
export function droppedPhotoNotice(count: number): string {
  return count === 1
    ? "Your text was sent, but the photo wasn't. You've used all included picture messages this month."
    : "Your text was sent, but the photos weren't. You've used all included picture messages this month.";
}
