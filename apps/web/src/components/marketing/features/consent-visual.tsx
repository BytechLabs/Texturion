/**
 * Consent-attestation visual (features track), /features/compliance + /canada.
 *
 * A live-DOM render of the app's new-conversation compose flow (DESIGN.md G5):
 * the mandatory consent checkbox ("This customer asked us to text them",
 * SPEC §5 consent attestation) and the record it writes on the contact, who
 * attested and when. It makes an abstract compliance feature concrete: consent
 * isn't a vibe, it's a row with a name and a date.
 *
 * Server component, static DOM, matches the composer tokens. Numbers are in
 * the 555-01XX safe fictional range (G10).
 */

import { Check, ShieldCheck } from "lucide-react";

import { cn } from "@/lib/utils";

export function ConsentVisual({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "rounded-[10px] border border-border bg-card p-5 shadow-[0_24px_64px_-32px_rgba(28,25,23,0.25)]",
        className,
      )}
    >
      <p className="text-[13px] font-medium text-muted-foreground">
        New conversation
      </p>

      {/* Recipient field, formatted like the app's E.164 live-format input. */}
      <div className="mt-3 rounded-lg border border-border bg-background px-3 py-2">
        <p className="text-[11px] text-muted-foreground">To</p>
        <p className="text-[15px] tabular-nums text-foreground">
          (416) 555-0187
        </p>
      </div>

      {/* Consent attestation, required for a new contact (SPEC §5). */}
      <label className="mt-3 flex cursor-default items-start gap-2.5 rounded-lg bg-primary/5 p-3">
        <span
          className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border border-primary bg-primary text-primary-foreground"
          aria-hidden
        >
          <Check className="size-3" strokeWidth={3} />
        </span>
        <span className="text-[13px] leading-snug text-foreground">
          This customer asked us to text them
          <span className="mt-0.5 block text-[12px] text-muted-foreground">
            Recorded with your name and today&apos;s date.
          </span>
        </span>
      </label>

      {/* The record the checkbox writes, as it lives on the contact (SPEC §5). */}
      <div className="mt-3 flex items-start gap-2.5 rounded-lg border border-border bg-background p-3">
        <span
          className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"
          aria-hidden
        >
          <ShieldCheck className="size-3.5" strokeWidth={1.75} />
        </span>
        <p className="text-[13px] leading-snug text-foreground">
          Consent on file
          <span className="mt-0.5 block text-[12px] text-muted-foreground">
            Attested by Dale · today, 2:41 PM
          </span>
        </p>
      </div>
    </div>
  );
}
