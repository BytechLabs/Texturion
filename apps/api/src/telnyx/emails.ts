import type { Env } from "../env";

/**
 * Email copy for the telnyx track (SPEC §4.3 failure hook, §4.4 R3/R4 +
 * OTP nudge). Registration/provisioning emails are operational (SPEC §8):
 * they go to the owner + active admins and bypass notification_prefs — the
 * recipient resolution lives in billing/recipients (shared audience).
 */

export interface EmailCopy {
  subject: string;
  text: string;
  html: string;
}

function toHtml(text: string): string {
  const escaped = text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  return `<p>${escaped.replaceAll("\n\n", "</p><p>").replaceAll("\n", "<br>")}</p>`;
}

function copy(subject: string, text: string): EmailCopy {
  return { subject, text, html: toHtml(text) };
}

/** SPEC §4.3 failure handling — reassuring, no action required (exact tone). */
export function provisioningDelayedCopy(companyName: string): EmailCopy {
  return copy(
    "We're still setting up your Loonext number",
    `Hi,\n\nWe're setting up the business number for ${companyName} — this is ` +
      `taking longer than usual. You don't need to do anything: we retry ` +
      `automatically and will have it ready shortly.\n\n— Loonext`,
  );
}

/** SPEC §4.4 R3: campaign approved → "US texting is live". */
export function usTextingLiveCopy(companyName: string, env: Env): EmailCopy {
  return copy(
    "US texting is live 🎉",
    `Hi,\n\nGreat news — US carriers approved ${companyName}'s texting ` +
      `registration. You can now text US numbers from your Loonext inbox.\n\n` +
      `Open your inbox: ${env.APP_ORIGIN}\n\n— Loonext`,
  );
}

/** SPEC §4.4 R4: rejection email with a link to the fix-and-resubmit form. */
export function registrationRejectedCopy(
  companyName: string,
  rejectionReason: string,
  env: Env,
): EmailCopy {
  return copy(
    "US registration needs a fix",
    `Hi,\n\nUS carrier registration for ${companyName} needs a fix:\n\n` +
      `${rejectionReason}\n\n` +
      `Update your details and resubmit — it takes 2 minutes:\n` +
      `${env.APP_ORIGIN}/settings/numbers\n\n— Loonext`,
  );
}

/** SPEC §4.2 / §11: +12h sole-prop OTP nudge (sent once per submission). */
export function otpNudgeCopy(companyName: string, env: Env): EmailCopy {
  return copy(
    "One step left to finish your US texting registration",
    `Hi,\n\nOne step left for ${companyName}: enter the verification code we ` +
      `texted to your mobile number to finish US registration. The code ` +
      `expires 24 hours after it was sent — you can request a fresh one from ` +
      `Settings.\n\nFinish up: ${env.APP_ORIGIN}/settings/numbers\n\n— Loonext`,
  );
}

// ---------------------------------------------------------------------------
// Number porting (PORTING.md §9 email triggers) — owner + admins, operational.
// ---------------------------------------------------------------------------

/** PORTING.md §9: submitted to the losing carrier. */
export function portSubmittedCopy(number: string, env: Env): EmailCopy {
  return copy(
    "Your number transfer is underway",
    `Hi,\n\nTransfer in progress. We've sent the request to move ${number} to ` +
      `Loonext to your current carrier — they usually respond within a couple ` +
      `of business days. Your number still works on your old carrier for now; ` +
      `nothing changes for your customers until the switch-over date.\n\n` +
      `Track it: ${env.APP_ORIGIN}/settings/numbers\n\n— Loonext`,
  );
}

/** PORTING.md §9: FOC date confirmed. */
export function portFocConfirmedCopy(
  number: string,
  focDate: string | null,
  env: Env,
): EmailCopy {
  const when = focDate ? `on ${focDate}` : "soon (date confirmed by your carrier)";
  return copy(
    "Your number transfer date is locked in",
    `Hi,\n\nLocked in. ${number} switches to Loonext ${when}. Nothing works ` +
      `differently until then — we'll email you the moment it switches.\n\n` +
      `Details: ${env.APP_ORIGIN}/settings/numbers\n\n— Loonext`,
  );
}

/** PORTING.md §9: needs-a-fix (carrier rejection / exception). */
export function portExceptionCopy(
  number: string,
  reason: string,
  env: Env,
): EmailCopy {
  return copy(
    "Your number transfer needs a quick fix",
    `Hi,\n\nYour carrier flagged something on the transfer of ${number}:\n\n` +
      `${reason}\n\nFix it and resubmit — it usually takes a couple of ` +
      `minutes, and there's no fee to try again:\n` +
      `${env.APP_ORIGIN}/settings/numbers\n\n— Loonext`,
  );
}

/** PORTING.md §9: messaging exception (no customer action needed). */
export function portMessagingExceptionCopy(number: string): EmailCopy {
  return copy(
    "Your number moved — texting is taking a little longer",
    `Hi,\n\n${number} moved over to Loonext, but texting is taking a bit ` +
      `longer — your old provider hasn't released the texting routing yet. ` +
      `We're escalating with the carrier on your behalf; this usually clears ` +
      `within a business day or two and there's nothing you need to do.\n\n— Loonext`,
  );
}

/**
 * PORTING.md §9: 10DLC campaign assignment FAILED post-port — the one
 * customer-actionable messaging failure (contrast the messaging exception,
 * where Telnyx escalates and the customer does nothing). Typically the LOSING
 * provider still holds the number in their carrier campaign; only the
 * customer can ask them to release it. Sent ONCE per stuck number — the
 * `assignmentFailureNotified` stamp in registration.ts guards it across the
 * §4.4 retry cron's re-runs.
 */
export function portAssignmentBlockedCopy(number: string, env: Env): EmailCopy {
  return copy(
    "Action needed to finish activating texting",
    `Hi,\n\n${number} moved over to Loonext — one more step finishes ` +
      `activating texting: ask your previous texting provider to remove ` +
      `${number} from their carrier campaign, then we'll finish connecting ` +
      `it. We'll retry automatically once they do.\n\n` +
      `Details: ${env.APP_ORIGIN}/settings/numbers\n\n— Loonext`,
  );
}

/** PORTING.md §9 / §4 P6d: texting live — the port completed. */
export function portCompletedCopy(number: string, env: Env): EmailCopy {
  return copy(
    "🎉 Your number is live on Loonext",
    `Hi,\n\nGreat news — ${number} is now live on Loonext. You can text your ` +
      `customers straight from your inbox.\n\nOpen your inbox: ${env.APP_ORIGIN}\n\n` +
      `— Loonext`,
  );
}

/**
 * PORTING.md §9 / paid-checkout tail: the transfer can't start until the
 * customer uploads the signed LOA + a recent bill (the §3.5 documents gate),
 * an upload only possible AFTER payment — so the moment they've paid is the
 * moment to tell them. Sent once from the checkout webhook (the webhook
 * ledger dedupes redelivery); skipped when the documents are already on file.
 */
export function portDocumentsNeededCopy(number: string, env: Env): EmailCopy {
  return copy(
    "Next step: two documents start your number transfer",
    `Hi,\n\nYou're in — one step starts the transfer of ${number}: upload a ` +
      `signed authorization (LOA) and a recent bill from your current ` +
      `carrier. The transfer can't move until we have both; it takes about ` +
      `two minutes, and your number keeps working the whole time.\n\n` +
      `Upload them here: ${env.APP_ORIGIN}/settings/numbers\n\n— Loonext`,
  );
}

/**
 * PORTING.md §4 P6e: the port completed and a tide-me-over bridge number is
 * still active — nudge the owner to release it so it stops holding a plan
 * slot (releasing is their call; nothing is released automatically). Fires
 * with P6d under the same P6 idempotency guard, so it sends once.
 */
export function portBridgeReleaseNudgeCopy(
  portedNumber: string,
  bridgeNumber: string,
  env: Env,
): EmailCopy {
  return copy(
    "Your real number is live — you can release the temporary one",
    `Hi,\n\n${portedNumber} is live on Loonext, so the temporary number we ` +
      `set up (${bridgeNumber}) has done its job. Conversations stay right ` +
      `where they are — releasing it just frees the number slot on your ` +
      `plan. Keep it if you're still using it; release it whenever you're ` +
      `ready:\n\n${env.APP_ORIGIN}/settings/numbers\n\n— Loonext`,
  );
}
