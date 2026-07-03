/**
 * Final CTA band (Track B) — §3.12 / COPY §H13.
 * Ledger identity (iteration 5): section `12` on the spine, and the earned
 * crescendo — the ONE petrol FLOOD close (ART-DIRECTION §3.3, anti-bland #3):
 * the whole band solid petrol, white type, one white "Start for $29" button.
 * After a page of disciplined stone-and-petrol calm, petrol floods edge to edge.
 * It carries the recurring done-mark ledger row (#9), the founder line, and the
 * security strip (quantified/verifiable proof over fake social proof, #20).
 * Copy verbatim from §H13.
 */

import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { Reveal } from "@/components/marketing/ui/reveal";
import { LedgerSection } from "@/components/marketing/ledger/ledger-section";
import { Button } from "@/components/ui/button";

export function FinalCta() {
  return (
    <LedgerSection
      n={12}
      bleed
      defer
      intrinsic={620}
      className="relative overflow-hidden bg-primary py-16 text-primary-foreground sm:py-24 dark:bg-teal-700"
    >
      <div className="mx-auto w-full max-w-3xl px-4 text-center sm:px-6">
        {/* Section 12 eyebrow — inline light-on-petrol ledger meta. */}
        <p className="jt-meta flex items-center justify-center gap-2 text-teal-100">
          <span className="tabular-nums">12</span>
          <span aria-hidden className="h-px w-6 bg-teal-100/50" />
          <span>Start today</span>
        </p>

        {/* The recurring done-mark ledger row — the ticket, filed and closed. */}
        <Reveal className="mx-auto mb-8 mt-6 w-fit">
          <div className="flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 ring-1 ring-white/20 backdrop-blur">
            <span className="inline-flex items-center rounded-full bg-white/20 p-1 text-white">
              <svg viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M3.5 8.5 6.5 11.5 12.5 5" />
              </svg>
            </span>
            <span className="text-[14px] text-white line-through opacity-70">
              Booked for tomorrow 9–11
            </span>
            <span className="jt-meta text-teal-100">
              Done · Priya · 2:14 PM
            </span>
          </div>
        </Reveal>

        <h2 className="display-h2 text-white">
          One number for the whole crew. No strings attached.
        </h2>
        <p className="mx-auto mt-5 max-w-xl text-lg leading-relaxed text-teal-50">
          See the price, pay, and start texting today — with a full refund in
          your first 30 days if it&apos;s not for you. Month to month, the whole
          time.
        </p>

        <div className="mt-8 flex justify-center">
          {/* The one white button on the flood — inverted so it reads as the
              single loud CTA against solid petrol (§3.3). Uses a FIXED petrol
              text (`text-teal-700` = #0F766E, 5.2:1 on white) not the themed
              `text-primary`, which in dark mode is a light teal that fails AA on
              a white button (Lighthouse color-contrast). */}
          <Button
            asChild
            size="lg"
            className="bg-white text-teal-700 shadow-sm hover:bg-white/90 dark:text-teal-700"
          >
            <Link href="/signup">
              Start for $29
              <ArrowRight strokeWidth={1.75} aria-hidden />
            </Link>
          </Button>
        </div>
        <p className="jt-meta mt-4 text-teal-100">
          $29/mo flat · Month to month · 30-day money-back guarantee
        </p>

        {/* Founder line — shipped without names (never fabricated, §3.12). */}
        <p className="mx-auto mt-12 max-w-2xl border-t border-white/20 pt-8 text-[15px] leading-relaxed text-teal-50">
          We built JobText because we watched small shops run their whole
          business off one person&apos;s cell. No sales team, no investors
          leaning on us to upsell you — just a tool we&apos;d want to use. Email
          us anytime; a real person answers.
        </p>

        {/* Security strip — verifiable differentiators, links /security. */}
        <p className="mx-auto mt-6 max-w-2xl text-[13px] leading-relaxed text-teal-100">
          Your data is encrypted in transit and at rest, we keep message content
          out of our analytics and error logs, and it&apos;s stored in the
          United States.{" "}
          <Link
            href="/security"
            className="font-medium text-white underline underline-offset-2 hover:opacity-90"
          >
            The details are on our security page.
          </Link>
        </p>
      </div>
    </LedgerSection>
  );
}
