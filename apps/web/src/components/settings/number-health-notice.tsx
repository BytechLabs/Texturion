"use client";

import { AlertTriangle } from "lucide-react";

import type { NumberHealth } from "@/lib/api/types";

/**
 * #235 — a number a carrier has started filtering, said plainly.
 *
 * The house style is honest failure, and this is that principle applied to a
 * number instead of a send. A degraded line is the customer's whole business
 * quietly not working: the messages look sent, they are billed, and nobody
 * receives them. Saying nothing would leave them to discover it from a
 * customer who never called back.
 *
 * WHAT IT DELIBERATELY DOES NOT DO:
 *
 *   - It does not say "spam" or "flagged". We know delivery fell; we do not
 *     know which vendor labelled it or whether one did. Naming a cause we
 *     have not established would be a guess dressed as a diagnosis.
 *   - It does not appear for the internal 'watch' state. That never reaches
 *     the client — a maybe-degraded warning on a thin sample is how a false
 *     alarm becomes a cancellation.
 *   - It does not offer a self-serve fix button. Remediation is registry
 *     paperwork that takes days and needs the customer's real business
 *     identity; a button implying otherwise would be a lie about the timeline.
 *
 * Applying: Zen of Clarity (one sentence of fact, one of what happens next)
 * and the Safety Principle — a warning about somebody's phone line has to read
 * as information, not as an upsell or an accusation.
 */
export function NumberHealthNotice({ health }: { health: NumberHealth }) {
  return (
    <div
      className="mt-3 flex items-start gap-3 rounded-lg border border-warning/30 bg-warning/5 px-3 py-3"
      role="status"
    >
      <AlertTriangle
        className="mt-0.5 size-4 shrink-0 text-warning"
        aria-hidden
      />
      <div className="min-w-0 text-sm">
        <p className="font-medium">Messages from this number aren&apos;t arriving reliably</p>
        <p className="mt-1 text-muted-foreground">
          {deliveryLine(health)} Carriers sometimes start filtering a number —
          often one that was reused from a previous business. We&apos;ve been
          alerted and we&apos;re on it; you don&apos;t need to do anything yet.
        </p>
        {health.degraded_since && (
          <p className="mt-1 text-xs text-muted-foreground">
            Since {new Date(health.degraded_since).toLocaleDateString()}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * The number, when we have one worth quoting.
 *
 * A rate is only meaningful with its baseline, and the server only sets one
 * when the sample supported a verdict — so an absent rate says less rather
 * than inventing precision.
 */
function deliveryLine(health: NumberHealth): string {
  if (health.delivery_rate === null) {
    return "Fewer of your texts are getting through than usual.";
  }
  return `About ${Math.round(health.delivery_rate * 100)}% of your recent texts were delivered, which is below normal for this number.`;
}
