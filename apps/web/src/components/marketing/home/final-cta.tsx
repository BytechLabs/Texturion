/**
 * Final CTA band (§H13). The earned close: after a page of quiet paper, the one
 * deep-petrol ground floods edge to edge, white type, one white "Start for $29"
 * button. This is the single dark band on the page (§3: the deep ground used
 * once), and the crescendo of the "Caught" story.
 *
 * DESIGN-DIRECTION §0: no section number, no fake "done-mark ledger row" chip,
 * no FILED stamp. Structure is carried by the ground change and the display
 * lettering, not a counter. The headline is composed with a marker highlight on
 * the promise word; the founder line and the verifiable security strip close it.
 */

import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { Display } from "@/components/marketing/display";
import { Section } from "@/components/marketing/ui/section";
import { Button } from "@/components/ui/button";

export function FinalCta() {
  return (
    <Section
      bleed
      defer
      intrinsic={560}
      className="ground-deep relative overflow-hidden"
    >
      <div className="mx-auto w-full max-w-3xl px-4 text-center sm:px-6">
        {/* A true eyebrow (a real label, not a counter) opens the close. */}
        <p className="font-mono-mkt flex items-center justify-center gap-2.5 text-[13px] font-medium tracking-[0.04em] text-[color:var(--marker)]">
          <span aria-hidden className="h-px w-6 bg-[color:var(--marker)]/60" />
          Start today
        </p>

        <Display as="h2" size="h2" className="mt-6 text-[color:var(--paper)]">
          One number for the whole crew.{" "}
          <Display.Mark>Nothing missed.</Display.Mark>
        </Display>
        <p className="mx-auto mt-5 max-w-xl text-lg leading-relaxed text-[color:var(--paper)]/85">
          See the price, pay, and start texting today, with a full refund in
          your first 30 days if it is not for you. Month to month, the whole
          time.
        </p>

        <div className="mt-8 flex justify-center">
          {/* The one white button on the deep flood, inverted so it reads as the
              single loud CTA. Fixed petrol text (#0F766E, ~5.2:1 on white). */}
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
        <p className="font-mono-mkt mt-4 text-[13px] text-[color:var(--paper)]/75">
          $29/mo flat · Month to month · 30-day money-back guarantee
        </p>

        {/* Founder line, shipped without invented names (§3.12). */}
        <p className="mx-auto mt-12 max-w-2xl border-t border-white/20 pt-8 text-[15px] leading-relaxed text-[color:var(--paper)]/85">
          We built JobText because we watched small shops run their whole
          business off one person&apos;s cell. No sales team, no investors
          leaning on us to upsell you, just a tool we&apos;d want to use. Email
          us anytime; a real person answers.
        </p>

        {/* Security strip, verifiable differentiators, links /security. */}
        <p className="mx-auto mt-6 max-w-2xl text-[13px] leading-relaxed text-[color:var(--paper)]/70">
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
    </Section>
  );
}
