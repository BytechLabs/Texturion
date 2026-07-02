/**
 * Final CTA band (Track B) — §3.12 / COPY §H13. The second allowed wash. The
 * page's one honest social-proof beat: a founder-signed "why we built this"
 * line (real names from ops — SHIP WITHOUT NAMES rather than invent them,
 * §3.12) and a security strip of verifiable differentiators linking /security.
 * A small product visual (the done-mark) keeps the close from being pure text
 * (§1.4 back-half rule). Copy verbatim from §H13.
 */

import Link from "next/link";
import { ArrowRight, CircleCheck } from "lucide-react";

import { Reveal } from "@/components/marketing/ui/reveal";
import { Section } from "@/components/marketing/ui/section";
import { Button } from "@/components/ui/button";

export function FinalCta() {
  return (
    <Section
      bleed
      className="bg-gradient-to-b from-stone-50 to-teal-50 py-16 dark:from-background dark:to-teal-950/20 sm:py-24"
    >
      <div className="mx-auto w-full max-w-3xl px-4 text-center sm:px-6">
        {/* Small product visual — the D14 done-mark. */}
        <Reveal className="mx-auto mb-8 w-fit">
          <div className="flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 shadow-[0_24px_64px_-32px_rgba(28,25,23,0.25)]">
            <span className="inline-flex items-center rounded-full bg-primary/10 p-1 text-primary">
              <CircleCheck className="size-4" strokeWidth={2} aria-hidden />
            </span>
            <span className="text-[14px] text-foreground line-through opacity-55">
              Booked for tomorrow 9–11
            </span>
            <span className="text-[12px] text-muted-foreground">
              Done · Priya · 2:14 PM
            </span>
          </div>
        </Reveal>

        <h2 className="display-h2 text-foreground">
          One number for the whole crew. No strings attached.
        </h2>
        <p className="mx-auto mt-5 max-w-xl text-lg leading-relaxed text-muted-foreground">
          See the price, pay, and start texting today — with a full refund in
          your first 30 days if it&apos;s not for you. Month to month, the whole
          time.
        </p>

        <div className="mt-8 flex justify-center">
          <Button asChild size="lg">
            <Link href="/signup">
              Get your number
              <ArrowRight strokeWidth={1.75} aria-hidden />
            </Link>
          </Button>
        </div>
        <p className="mt-4 text-[13px] tabular-nums text-muted-foreground">
          $29/mo flat · Month to month · 30-day money-back guarantee
        </p>

        {/* Founder line — shipped without names (ops supplies real names; never
            fabricated, §3.12). The sentence stands on its own. */}
        <p className="mx-auto mt-12 max-w-2xl border-t border-border pt-8 text-[15px] leading-relaxed text-muted-foreground">
          We built JobText because we watched small shops run their whole
          business off one person&apos;s cell. No sales team, no investors
          leaning on us to upsell you — just a tool we&apos;d want to use. Email
          us anytime; a real person answers.
        </p>

        {/* Security strip — verifiable differentiators, links /security. */}
        <p className="mx-auto mt-6 max-w-2xl text-[13px] leading-relaxed text-muted-foreground">
          Your data is encrypted in transit and at rest, we keep message content
          out of our analytics and error logs, and it&apos;s stored in the
          United States.{" "}
          <Link
            href="/security"
            className="font-medium text-primary underline-offset-2 hover:underline"
          >
            The details are on our security page.
          </Link>
        </p>
      </div>
    </Section>
  );
}
