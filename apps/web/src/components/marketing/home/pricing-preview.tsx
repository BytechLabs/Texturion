/**
 * Pricing preview (Track B) — §3.9 / COPY §H9. Pricing on the home page IS the
 * positioning (anti-Podium). Two plan cards, the honesty strip that OWNS the
 * first-month sum out loud ($58 then $29), the crew-size slider (the converting
 * interaction), and the live usage-meter proof. One of the two allowed washes
 * (stone-50 → teal-50). All figures from SPEC §2; copy verbatim from §H9.
 */

import Link from "next/link";
import { Clock, Receipt, ShieldCheck } from "lucide-react";

import { Reveal } from "@/components/marketing/ui/reveal";
import { LedgerSection } from "@/components/marketing/ledger/ledger-section";
import { SignalCheck } from "@/components/marketing/ledger/signal-check";
import { ArrowLink } from "@/components/marketing/ledger/arrow-link";
import { Button } from "@/components/ui/button";
import { LazyCrewSizeSlider } from "@/components/marketing/lazy/lazy-crew-size-slider";
import { CrewSizeSliderStatic } from "@/components/marketing/interactive/crew-size-slider-static";
import { FlatVsPerSeatChart } from "@/components/marketing/art";
import { HOME_ANCHORS } from "@/lib/marketing/site";
import { cn } from "@/lib/utils";

import { UsageMeterProof } from "./usage-meter-proof";

interface Plan {
  name: string;
  price: string;
  tagline: string;
  badge?: string;
  highlighted?: boolean;
  features: string[];
  cta: string;
}

const PLANS: Plan[] = [
  {
    name: "Starter",
    price: "$29",
    tagline: "For crews of one to three.",
    features: [
      "3 teammates included",
      "1 local business number",
      "500 texts a month (a plain text up to 160 characters is one; the composer shows the count before you send)",
      "Receiving texts: free, unlimited",
      "Extra texts: 3¢ each, with a spending cap you control",
    ],
    cta: "Start with Starter",
  },
  {
    name: "Pro",
    price: "$79",
    tagline: "For crews up to ten — and a second number.",
    badge: "For bigger crews",
    highlighted: true,
    features: [
      "10 teammates included",
      "2 local business numbers (two locations, or office and field)",
      "2,500 texts a month (same count rule; the composer always shows it before you send)",
      "Receiving texts: free, unlimited",
      "Extra texts: 2.5¢ each, with a spending cap you control",
    ],
    cta: "Start with Pro",
  },
];

function PlanCard({ plan }: { plan: Plan }) {
  return (
    <div
      className={cn(
        "flex h-full flex-col rounded-2xl border bg-card p-6",
        plan.highlighted ? "border-primary/40 ring-1 ring-primary/20" : "border-border",
      )}
    >
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-foreground">{plan.name}</h3>
        {plan.badge && (
          <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-[12px] font-medium text-teal-800 dark:text-primary">
            {plan.badge}
          </span>
        )}
      </div>
      <div className="mt-3 flex items-baseline gap-1.5">
        <span className="text-[48px] font-semibold leading-none tabular-nums text-foreground">
          {plan.price}
        </span>
        <span className="text-[15px] text-muted-foreground">/mo</span>
      </div>
      <p className="mt-2 text-[14px] text-muted-foreground">{plan.tagline}</p>

      <ul className="mt-5 flex-1 space-y-3">
        {plan.features.map((f) => (
          <li key={f} className="flex gap-2.5 text-[14px] leading-relaxed text-foreground">
            <span className="mt-0.5 shrink-0">
              <SignalCheck className="size-4" />
            </span>
            <span>{f}</span>
          </li>
        ))}
      </ul>

      <Button
        asChild
        className="mt-6 w-full"
        variant={plan.highlighted ? "default" : "outline"}
      >
        <Link href="/signup">{plan.cta}</Link>
      </Button>
    </div>
  );
}

export function PricingPreview() {
  return (
    <LedgerSection
      n={9}
      id="pricing"
      bleed
      defer
      intrinsic={1200}
      className="bg-gradient-to-b from-stone-50 to-teal-50 py-16 dark:from-background dark:to-teal-950/20 sm:py-24"
    >
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <div className="max-w-2xl">
          <p className="jt-meta flex items-center gap-2 text-primary">
            <span className="tabular-nums">09</span>
            <span aria-hidden className="h-px w-6 bg-primary/40" />
            <span className="text-muted-foreground">Pricing</span>
          </p>
          <h2 className="display-h2 mt-4 text-foreground">
            One flat price for the whole crew.
          </h2>
          <p className="mt-5 text-lg leading-relaxed text-muted-foreground">
            No per-user fees. No quote calls. No annual contracts. This is the
            whole price list.
          </p>
        </div>

        <div className="mt-10 grid gap-6 lg:grid-cols-[1fr_1fr_1.05fr] lg:items-stretch">
          {PLANS.map((plan) => (
            <Reveal key={plan.name} className="h-full">
              <PlanCard plan={plan} />
            </Reveal>
          ))}

          {/* The converting interaction + the usage-meter proof. The slider is
              deferred (LazyIsland): its static default state converts before/
              without JS; the draggable island loads on viewport approach. */}
          <Reveal className="flex h-full flex-col gap-6">
            <LazyCrewSizeSlider fallback={<CrewSizeSliderStatic />} />
            <UsageMeterProof />
          </Reveal>
        </div>

        {/* Flat-vs-per-seat, drawn (VISUALS §3): the designed "at a glance"
            twin of the slider — flat petrol line vs a climbing per-user line,
            with the dated source. Inline SVG (themeable, zero-CLS, no-JS). */}
        <Reveal className="mt-8">
          <div className="rounded-2xl border border-border bg-card p-6 sm:p-8">
            <div className="grid items-center gap-6 lg:grid-cols-[1fr_1.2fr] lg:gap-10">
              <div>
                <h3 className="text-[20px] font-semibold text-foreground">
                  Flat beats per-user — by more, the bigger you get.
                </h3>
                <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">
                  JobText stays $29, then $79 for a crew of ten. A typical
                  per-user tool keeps climbing with every person you add. Drag
                  the slider above to see your crew&apos;s number.
                </p>
              </div>
              <FlatVsPerSeatChart className="w-full" />
            </div>
          </div>
        </Reveal>

        {/* Honesty strip — the first-month sum owned out loud, next to $29. */}
        <div className="mt-8 grid gap-3 rounded-2xl border border-border bg-card p-6 sm:grid-cols-3">
          <div className="flex gap-3">
            <Receipt className="size-5 shrink-0 text-primary" strokeWidth={1.75} aria-hidden />
            <p className="text-[14px] leading-relaxed text-foreground">
              <span className="font-semibold">
                US shops: $29/mo + a one-time $29 to register with the phone
                companies = $58 your first month, then $29 every month after.
              </span>{" "}
              The registration fee is charged once, ever. Canadian businesses
              that don&apos;t text US numbers never pay it and never wait.
            </p>
          </div>
          <div className="flex gap-3">
            <Clock className="size-5 shrink-0 text-amber-600 dark:text-warning" strokeWidth={1.75} aria-hidden />
            <p className="text-[14px] leading-relaxed text-foreground">
              Day one, you&apos;re not idle: receiving texts and texting Canadian
              numbers work right away. Texting US numbers turns on in about a
              week (3–7 business days), once the phone companies approve you.
            </p>
          </div>
          <div className="flex gap-3">
            <ShieldCheck className="size-5 shrink-0 text-primary" strokeWidth={1.75} aria-hidden />
            <p className="text-[14px] leading-relaxed text-foreground">
              Prices in USD, plus sales tax where it applies. That&apos;s the
              whole list.
            </p>
          </div>
        </div>

        <div className="mt-6 flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[14px] text-muted-foreground">
            30-day money-back guarantee — full refund, including the
            registration fee.
          </p>
          {/* /pricing ships later; this section IS the on-page pricing beat, so
              the link stays on-page (site.ts guard) — zero dead links. */}
          <ArrowLink href={HOME_ANCHORS.pricing}>
            See full pricing and the fine print we put in large print
          </ArrowLink>
        </div>
      </div>
    </LedgerSection>
  );
}
