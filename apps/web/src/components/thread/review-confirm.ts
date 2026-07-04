import { destinationLocalHour } from "@jobtext/shared";

import { destinationLocalTimeLabel } from "@/components/inbox/e164";

/**
 * Copy for the review-ask confirm dialog (FEATURE-GAPS Step 0b / §3). The API
 * signals BOTH cases with the composer's one stable 409 code
 * (`quiet_hours_confirmation_required`): quiet hours at the destination —
 * which apply to every review send — or a cold thread (>72h since the last
 * inbound) that makes the ask a fresh outreach. The wording picks the
 * quiet-hours framing whenever the destination clock is inside 8pm–8am
 * (mirroring the API's own check, exactly like the composer's dialog builds
 * its local-time title client-side); otherwise it explains the cold thread.
 */
export interface ReviewConfirmCopy {
  title: string;
  description: string;
}

export function reviewConfirmCopy(
  e164: string,
  now: Date = new Date(),
): ReviewConfirmCopy {
  const hour = destinationLocalHour(e164, now);
  if (hour !== null && (hour >= 20 || hour < 8)) {
    const localTime = destinationLocalTimeLabel(e164, now);
    return {
      title: localTime
        ? `It's ${localTime} for this customer.`
        : "It's late where this customer is.",
      description: "Send the review ask anyway?",
    };
  }
  return {
    title: "This thread has gone quiet.",
    description:
      "It's been a while since this customer texted, so a review ask starts a fresh conversation. Send it now?",
  };
}
