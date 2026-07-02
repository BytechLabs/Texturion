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
    "We're still setting up your JobText number",
    `Hi,\n\nWe're setting up the business number for ${companyName} — this is ` +
      `taking longer than usual. You don't need to do anything: we retry ` +
      `automatically and will have it ready shortly.\n\n— JobText`,
  );
}

/** SPEC §4.4 R3: campaign approved → "US texting is live". */
export function usTextingLiveCopy(companyName: string, env: Env): EmailCopy {
  return copy(
    "US texting is live 🎉",
    `Hi,\n\nGreat news — US carriers approved ${companyName}'s texting ` +
      `registration. You can now text US numbers from your JobText inbox.\n\n` +
      `Open your inbox: ${env.APP_ORIGIN}\n\n— JobText`,
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
      `${env.APP_ORIGIN}/registration\n\n— JobText`,
  );
}

/** SPEC §4.2 / §11: +12h sole-prop OTP nudge (sent once per submission). */
export function otpNudgeCopy(companyName: string, env: Env): EmailCopy {
  return copy(
    "One step left to finish your US texting registration",
    `Hi,\n\nOne step left for ${companyName}: enter the verification code we ` +
      `texted to your mobile number to finish US registration. The code ` +
      `expires 24 hours after it was sent — you can request a fresh one from ` +
      `the dashboard.\n\nFinish up: ${env.APP_ORIGIN}/registration\n\n— JobText`,
  );
}
