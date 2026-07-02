/**
 * Consent + first-message-footer visual (features track) — /features/compliance.
 *
 * A live-DOM render of the app's new-conversation compose flow (DESIGN.md G5):
 * the mandatory consent checkbox ("This customer asked us to text them",
 * SPEC §5 consent attestation) and the auto-appended first-message footer
 * preview ("— {Business}. Reply STOP to opt out", SPEC §5 first-message
 * identification). It makes two abstract compliance features concrete: consent
 * is recorded, and identification is written for you.
 *
 * Server component — static DOM, matches the composer + footer-preview tokens.
 */

import { Check, ShieldCheck } from "lucide-react";

import { cn } from "@/lib/utils";

export function ConsentFooterVisual({ className }: { className?: string }) {
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

      {/* Consent attestation — required for a new contact (SPEC §5). */}
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

      {/* Composer with the first-message footer preview (SPEC §5). */}
      <div className="mt-3 rounded-lg border border-border bg-background p-3">
        <p className="text-[15px] leading-normal text-foreground">
          Hi Karen, it&apos;s Dale from Reyes Plumbing — following up on your
          water heater.
        </p>
        <p className="mt-2 border-t border-dashed border-border pt-2 text-[13px] text-muted-foreground">
          — Reyes Plumbing &amp; Heating. Reply STOP to opt out.
          <span className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground/80">
            <ShieldCheck className="size-3" strokeWidth={1.75} aria-hidden />
            Added to your first message to this contact
          </span>
        </p>
      </div>
    </div>
  );
}
