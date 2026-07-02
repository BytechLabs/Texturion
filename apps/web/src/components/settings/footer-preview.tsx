"use client";

import { identificationFooter } from "@/lib/settings/footer-preview";

const SAMPLE_BODY = "Hi! We can fit you in Tuesday at 3pm — does that work?";

/**
 * Live first-message preview (G8 Workspace): the outbound bubble exactly as
 * the customer's phone renders it, footer composed by the same rule as the
 * API (lib/settings/footer-preview). Updates on every keystroke of the
 * company-name input.
 */
export function FooterPreview({ businessName }: { businessName: string }) {
  const name = businessName.trim();
  return (
    <div className="space-y-1.5">
      <p className="text-xs text-muted-foreground">
        Added to the first text you send each customer
      </p>
      <div
        aria-live="polite"
        className="ml-auto max-w-[85%] rounded-lg bg-primary/10 px-3 py-2 text-[15px] leading-normal text-foreground sm:max-w-[65%]"
      >
        <p className="whitespace-pre-line">{SAMPLE_BODY}</p>
        <p className="whitespace-pre-line text-muted-foreground">
          {identificationFooter(name === "" ? "Your business" : name)}
        </p>
      </div>
    </div>
  );
}
