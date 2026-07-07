/**
 * Pricing page (Track A shell family). BLUEPRINT §8 (full spec) + COPY §PR
 * (verbatim). Pricing on its own page IS the positioning (anti-Podium): every
 * cost on one page and a buy button instead of a sales call.
 *
 * Layout order (§8, amended by #28): H1 + sub → two plan cards (full detail,
 * both CTAs to signup) → "Build your plan" add-ons strip (#12 module model,
 * the differentiator) → crew-size slider → honesty ledger (with the
 * first-week timeline card) → "what you'll actually pay elsewhere" table →
 * segment explainer + counter → guarantee block → FAQ (9) → CTA band.
 *
 * Reuses the shared marketing components (crew-size slider, usage-meter proof,
 * first-week timeline) rather than re-implementing them, one source of truth,
 * one motion grammar. Competitor numbers carry "as of July 2026" and per-cell
 * sourcing (§6, §13.7). SoftwareApplication + BreadcrumbList JSON-LD only,
 * NO FAQPage (§11.2, dead rich result). Fully static (§11.4).
 */

import Link from "next/link";
import {
  ArrowRight,
  Check,
  CircleDollarSign,
  Clock,
  ListChecks,
  Receipt,
} from "lucide-react";
import type { Metadata } from "next";

import { Container } from "@/components/marketing/ui/container";
import { JsonLd } from "@/components/marketing/ui/json-ld";
import { Reveal } from "@/components/marketing/ui/reveal";
import { Section } from "@/components/marketing/ui/section";
import { LazyCrewSizeSlider } from "@/components/marketing/lazy/lazy-crew-size-slider";
import { CrewSizeSliderStatic } from "@/components/marketing/interactive/crew-size-slider-static";
import { PlanAddons } from "@/components/marketing/plan-addons";
import { UsageMeterProof } from "@/components/marketing/home/usage-meter-proof";
import { FirstWeekTimeline } from "@/components/marketing/home/first-week-timeline";
import { Button } from "@/components/ui/button";
import {
  breadcrumbJsonLd,
  buildMetadata,
  softwareApplicationJsonLd,
} from "@/lib/marketing/seo";
import { LIVE_ROUTES } from "@/lib/marketing/site";
import { cn } from "@/lib/utils";

import { LazySegmentCounter } from "./lazy-segment-counter";
import { SegmentCounterStatic } from "./segment-counter-static";

const PATH = LIVE_ROUTES.pricing;

export const metadata: Metadata = buildMetadata({
  title: "Pricing, $29/mo flat for the whole crew",
  description:
    "Starter $29/mo (3 people, 500 texts), Pro $79/mo (10 people, 2,500). Optional add-ons: picture messages $5, call forwarding $8, extra storage $5. One-time $29 US registration fee. No per-user fees, no quote calls.",
  path: PATH,
});

/* -------------------------------------------------------------------------- */
/* Plan cards, everything from SPEC §2, in human words, nothing omitted (§8). */
/* Copy from COPY §PR plan cards, amended by #24: photo sending is NOT a base */
/* feature (it's the $5/mo Picture messages add-on, apps/api/src/billing/     */
/* modules.ts), so the cards no longer claim it. The add-ons strip below the  */
/* cards carries the module truth.                                            */
/* -------------------------------------------------------------------------- */

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
      "1 local business number (US or Canada, your area code)",
      "500 texts a month (a plain text up to 160 characters is one; the composer shows the count before you send)",
      "Receiving texts and photos: free, unlimited",
      "Extra texts: 3¢ each",
      "Spending cap you control (default 3× your allowance) with alerts at 80% and 100%",
      "Month to month, cancel anytime",
    ],
    cta: "Start with Starter",
  },
  {
    name: "Pro",
    price: "$79",
    tagline: "For crews up to ten, and a second number.",
    badge: "For bigger crews",
    highlighted: true,
    features: [
      "10 teammates included",
      "2 local business numbers (two locations, or office and field)",
      "2,500 texts a month (same count rule; the composer always shows it before you send)",
      "Receiving texts and photos: free, unlimited",
      "Extra texts: 2.5¢ each",
      "Spending cap you control (default 3× your allowance) with alerts at 80% and 100%",
      "Month to month, cancel anytime",
    ],
    cta: "Start with Pro",
  },
];

function PlanCard({ plan }: { plan: Plan }) {
  return (
    <div
      className={cn(
        "flex h-full flex-col rounded-2xl border bg-card p-6 sm:p-8",
        plan.highlighted
          ? "border-primary/40 ring-1 ring-primary/20"
          : "border-border",
      )}
    >
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-foreground">{plan.name}</h2>
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

      <ul className="mt-6 flex-1 space-y-3">
        {plan.features.map((f) => (
          <li
            key={f}
            className="flex gap-2.5 text-[14px] leading-relaxed text-foreground"
          >
            <Check
              className="mt-0.5 size-4 shrink-0 text-success"
              strokeWidth={2}
              aria-hidden
            />
            <span>{f}</span>
          </li>
        ))}
      </ul>

      <Button
        asChild
        className="mt-8 w-full"
        variant={plan.highlighted ? "default" : "outline"}
      >
        <Link href="/signup">{plan.cta}</Link>
      </Button>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Honesty ledger, the trust centerpiece (§8). Every cost, before you pay.    */
/* Copy verbatim from COPY §PR honesty ledger.                                 */
/* -------------------------------------------------------------------------- */

const LEDGER: { term: string; detail: React.ReactNode }[] = [
  {
    term: "Your plan",
    detail: "$29 or $79 a month. Month to month.",
  },
  {
    term: "Register with the phone companies: $29, one time, ever.",
    detail:
      "The phone companies require every business that texts to register first; this covers the fee they charge to review and approve you, which we pay on your behalf, including a resubmission if your first attempt bounces. Cancel and come back next year: you won't pay it again. Canadian businesses that don't text US numbers never pay it. For a US shop, that means $58 your first month, then $29 every month after.",
  },
  {
    term: "Extra texts",
    detail:
      "3¢ each on Starter, 2.5¢ on Pro, only after your included texts run out, only up to the cap you control.",
  },
  {
    // #24: the module prices are part of "every cost, before you pay."
    // Prices and quantities mirror apps/api/src/billing/plans.ts +
    // modules.ts (mms $5/150 picture messages, voice $8/300 min,
    // extra_storage $5/10 GB); the add-ons strip above renders them from
    // the shared catalog mirror. Each outbound MMS also meters as a flat 3
    // segments (MMS_SEGMENTS, messaging/media.ts; DECISIONS.md D5) — that
    // cost belongs on this page too.
    term: "Optional add-ons, if you turn them on",
    detail:
      "Picture messages $5/mo (150 a month included; each one you send also counts as three texts from your allowance), call forwarding with missed-call text-back $8/mo (300 minutes included), extra storage $5/mo (10 GB more). All three are off by default, you switch them on at signup or later in settings, and you can switch them off the same way. Nothing here is required to text.",
  },
  {
    term: "Tax",
    detail:
      "Prices are in USD, plus sales tax where it applies, calculated at checkout. (CAD billing isn't here yet, we'd rather tell you now than surprise you at checkout.)",
  },
  {
    term: "That's the whole list.",
    detail:
      'Two plans, three optional add-ons, one registration fee, and overage you cap. No setup fees, no per-user fees, no monthly "compliance" or "carrier" line items, no fee for canceling.',
  },
];

/* -------------------------------------------------------------------------- */
/* "What you'll actually pay elsewhere" (§8). Every competitor figure dated    */
/* "as of July 2026" with per-cell sourcing (§6, §13.7). Copy verbatim §PR.    */
/* -------------------------------------------------------------------------- */

const COMPARE_COLUMNS = [
  "Loonext Starter",
  "Heymarket Standard",
  "Quo",
  "Podium",
] as const;

const COMPARE_ROWS: { label: string; cells: string[] }[] = [
  {
    label: "Monthly software",
    cells: [
      "$29 flat",
      "$49/user/mo × 3 = $147",
      "$19/user/mo × 3 = $57 (monthly billing)",
      "Not published",
    ],
  },
  {
    label: "The 500 texts",
    cells: [
      "Included",
      "~$15 (3¢/segment × 500)",
      "Not included, metered at 1¢/segment (~$5)",
      "Not published",
    ],
  },
  {
    label: "Monthly carrier line item",
    cells: ["$0", "$10/mo", "$0", "Not published"],
  },
  {
    label: "Monthly total",
    cells: [
      "$29",
      "~$172",
      "~$62 + extra numbers at $5 ea.",
      "Ask their sales team",
    ],
  },
];

/* -------------------------------------------------------------------------- */
/* Pricing FAQ (9). COPY §PR, amended: the photo answer states the $5 add-on  */
/* + 150 cap-and-drop truth (#24), the "not getting" answer stops denying     */
/* voice (#24, the $8 call-forwarding add-on ships), and the keep-my-number   */
/* question mirrors /features/business-number's verified porting answer       */
/* (#71). NO FAQPage JSON-LD (§11.2).                                         */
/* -------------------------------------------------------------------------- */

const FAQS: { q: string; a: string }[] = [
  {
    q: "Is there a free trial?",
    a: "No, and here's why. A texting number can't really be \"free\": the moment we give you one, the phone companies charge for it, and free numbers attract spammers, which wrecks message delivery for everyone. So Loonext is paid from day one, with a 30-day full money-back guarantee instead. You get a real trial; we keep the network clean.",
  },
  {
    q: "Do texts customers send me count against my 500?",
    a: "No. Receiving texts and photos is free and unlimited on every plan. Only what you send counts.",
  },
  {
    // Truth: apps/api/src/billing/plans.ts PLAN_MMS_INCLUDED (150, both
    // plans) + the cap-and-drop in messaging/send.ts. An outbound picture
    // message meters as a FLAT 3 segments against the text allowance
    // (MMS_SEGMENTS in messaging/media.ts, reported in messaging/status.ts;
    // DECISIONS.md D5). The 80% warning is the owner email from
    // billing/usage-alerts.ts; the composer reports a dropped photo right
    // after the send (thread/mms-gate.ts).
    q: "How do photo messages work?",
    a: "Receiving photos is free and unlimited on every plan. Sending them is the Picture messages add-on: $5 a month with 150 picture messages included. Each one you send also counts as a flat three texts from your monthly allowance, however long the words. Past 150 in a month, the photo is dropped and your message still goes out as plain text — the account owner gets an email at 80% of the cap, and the composer tells you right away when a photo didn't go.",
  },
  {
    q: "What happens when I hit my allowance?",
    a: "We email you at 80% and again at 100%. Past that, extra texts are 3¢ each (2.5¢ on Pro) up to a spending cap, 3× your allowance by default. Hit the cap and sending pauses until you raise it; account owners can do that in one click. You'll never get a surprise bill.",
  },
  {
    q: "Will I ever pay the $29 registration fee twice?",
    a: "No. It's charged at most once per company, ever, even if you cancel and come back. It only exists at all because the phone companies charge a real fee to review and approve every business that texts, and we'd rather show you that fee than bury it in the subscription.",
  },
  {
    q: "Can I change plans or cancel later?",
    a: "Yes. Upgrades apply immediately. Downgrades apply at the end of your billing period. Canceling takes two clicks in billing settings, no phone call, no chat-with-retention. We hold your number for 30 days in case you change your mind.",
  },
  {
    // Mirrors the verified porting answer on /features/business-number
    // (free US/CA transfers, 1–7 business days, no dead air). #71.
    q: "Can I keep my current business number?",
    a: "Yes, transfer it to Loonext. At signup, choose “Bring my number,” give us your current carrier details, and upload a recent bill; we handle the paperwork with the phone companies from there. Transfers are free for US and Canadian numbers and typically take 1 to 7 business days, and your number keeps working on your current carrier the whole time, switching to Loonext on the transfer date. Want to text sooner? Get a new local number now and transfer your old one alongside it.",
  },
  {
    q: "Are prices really in USD for Canadian businesses?",
    a: "For now, yes, your card is charged in USD and your bank converts it. CAD billing is coming; until it's real, we won't pretend otherwise.",
  },
  {
    // #24/#58: no more blanket voice denial, the $8 call-forwarding module
    // ships (apps/api/src/billing/modules.ts).
    q: "What am I not getting at these prices?",
    a: "Loonext is a shared texting inbox, not a phone system: there's no calling inside the app, no mass text blasts, and no review management. Phone calls aren't left hanging, though. The call forwarding add-on ($8/mo) sends calls on your business number to your cell and texts back the ones you miss, so the lead still lands in your inbox. If you need blasts or review tools, a bigger platform might fit better; our comparison pages say so honestly.",
  },
];

export default function PricingPage() {
  return (
    <>
      <JsonLd
        data={[
          softwareApplicationJsonLd(),
          breadcrumbJsonLd([
            { name: "Home", path: "/" },
            { name: "Pricing", path: PATH },
          ]),
        ]}
      />

      {/* Hero. H1 + sub (COPY §PR). */}
      <Container className="pt-16 sm:pt-24">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold text-primary">Pricing</p>
          <h1 className="display-hero mt-2 text-foreground">
            One price for the whole crew. Nothing hidden.
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-lg leading-relaxed text-muted-foreground">
            Two plans, every cost on this page, and a buy button instead of a
            sales call. If you can&apos;t find a price on a texting
            company&apos;s pricing page, that&apos;s the price talking.
          </p>
        </div>
      </Container>

      {/* Plan cards + under-cards line. */}
      <Container className="pt-12 sm:pt-16">
        <div className="mx-auto grid max-w-4xl gap-6 lg:grid-cols-2 lg:items-stretch">
          {PLANS.map((plan) => (
            <Reveal key={plan.name} className="h-full">
              <PlanCard plan={plan} />
            </Reveal>
          ))}
        </div>
        <p className="mx-auto mt-5 max-w-4xl text-center text-[14px] text-muted-foreground">
          Upgrading from Starter to Pro takes one click and applies immediately.
          Both plans take the same optional add-ons, listed below.
        </p>
      </Container>

      {/* "Build your plan" add-ons strip (#28): the #12 module model, marketed.
          Prices and quantities render from the shared catalog mirror
          (PLAN_MODULE_CARDS), so this section can't drift from checkout. */}
      <PlanAddons />

      {/* Crew-size slider, flat beats per-user. */}
      <Section>
        <div className="mx-auto max-w-4xl">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="display-h2 text-foreground">
              Flat beats per-user. Slide to see by how much.
            </h2>
          </div>
          <div className="mx-auto mt-10 max-w-xl">
            <Reveal>
              {/* Reuses the shared slider; its own dated + sourced footnote
                  (§13.7) is part of the component, so no duplicate footnote
                  here, the §PR footnote text lives inside CrewSizeSlider.
                  Deferred: the static default state converts before/without JS;
                  the draggable island loads on viewport approach. */}
              <LazyCrewSizeSlider fallback={<CrewSizeSliderStatic />} />
            </Reveal>
          </div>
        </div>
      </Section>

      {/* Honesty ledger, the trust centerpiece, with the first-week timeline. */}
      <Section
        bleed
        className="bg-gradient-to-b from-stone-50 to-teal-50 py-16 dark:from-background dark:to-teal-950/20 sm:py-24"
      >
        <Container>
          <div className="mx-auto max-w-3xl">
            <h2 className="display-h2 text-foreground">
              Every cost, before you pay.
            </h2>

            {/* Each row is a <div> whose ONLY children are <dt>/<dd> so the
                definition-list / dlitem a11y rules pass (axe: a <dl>'s <div>
                wrappers may contain nothing but <dt>/<dd>). The decorative
                icon lives inside the <dt>, not as a sibling of the wrapper. */}
            <dl className="mt-10 space-y-5 rounded-2xl border border-border bg-card p-6 sm:p-8">
              {LEDGER.map(({ term, detail }) => (
                <div key={term}>
                  <dt className="flex items-start gap-3.5 text-[15px] font-semibold text-foreground">
                    <CircleDollarSign
                      className="mt-0.5 size-5 shrink-0 text-primary"
                      strokeWidth={1.75}
                      aria-hidden
                    />
                    {term}
                  </dt>
                  <dd className="mt-1 pl-[34px] text-[14px] leading-relaxed text-muted-foreground">
                    {detail}
                  </dd>
                </div>
              ))}
            </dl>

            {/* Timeline card (amber, with the first-week timeline). §PR. */}
            <div className="mt-6 rounded-2xl border border-amber-300/70 bg-amber-50/50 p-5 dark:border-amber-700/40 dark:bg-amber-950/20">
              <div className="flex gap-3">
                <Clock
                  className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-warning"
                  strokeWidth={1.75}
                  aria-hidden
                />
                <p className="text-[14px] leading-relaxed text-foreground">
                  Receiving texts works the moment your number is ready,
                  usually live in a minute or two. Texting Canadian numbers works
                  immediately. Texting US numbers turns on after the phone
                  companies approve you, typically 3–7 business days (about a
                  week). We file everything and email you the moment you&apos;re
                  approved.
                </p>
              </div>
            </div>

            <div className="mt-6">
              <Reveal>
                <FirstWeekTimeline />
              </Reveal>
            </div>

            {/* The real usage meter as product proof (SPEC §2 cap + alerts). */}
            <div className="mt-6 max-w-md">
              <Reveal>
                <UsageMeterProof />
              </Reveal>
            </div>
          </div>
        </Container>
      </Section>

      {/* "What you'll actually pay elsewhere", dated, per-cell sourced. */}
      <Section>
        <div className="mx-auto max-w-4xl">
          <h2 className="display-h2 text-foreground">
            The same crew, priced elsewhere.
          </h2>
          <p className="mt-5 max-w-2xl text-lg leading-relaxed text-muted-foreground">
            A 3-person crew sending 500 single-segment texts a month, at
            published prices as of July 2026 (every number below cites its source
            in our comparison pages):
          </p>

          <div className="mt-8 overflow-x-auto rounded-2xl border border-border">
            <table className="w-full min-w-[640px] border-collapse text-left text-[14px]">
              <thead>
                <tr className="border-b border-border bg-secondary/40">
                  <th className="p-4 font-medium text-muted-foreground" />
                  {COMPARE_COLUMNS.map((col, i) => (
                    <th
                      key={col}
                      className={cn(
                        "p-4 font-semibold text-foreground",
                        i === 0 && "text-primary",
                      )}
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {COMPARE_ROWS.map((row) => {
                  const isTotal = row.label === "Monthly total";
                  return (
                    <tr
                      key={row.label}
                      className={cn(
                        "border-b border-border last:border-b-0",
                        isTotal && "bg-secondary/30",
                      )}
                    >
                      <th
                        scope="row"
                        className={cn(
                          "p-4 text-left font-medium text-foreground",
                          isTotal && "font-semibold",
                        )}
                      >
                        {row.label}
                      </th>
                      {row.cells.map((cell, i) => (
                        <td
                          key={i}
                          className={cn(
                            "p-4 tabular-nums text-muted-foreground",
                            i === 0 && "font-medium text-foreground",
                            isTotal && "font-semibold text-foreground",
                          )}
                        >
                          {cell}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="mt-4 text-[13px] leading-relaxed text-muted-foreground">
            Competitor prices from their public pricing pages, July 2026; each
            figure is sourced on the matching comparison page. Heymarket&apos;s
            texting total assumes 500 single-segment texts at their published
            3¢/segment; Quo bills texting separately at 1¢/segment (automated
            SMS) and charges $5/mo per extra number, so its real total depends on
            volume. One-time registration fees excluded for all (ours is $29; Quo
            discloses $19.50; others don&apos;t say). If any number changes, tell
            us and we&apos;ll fix it.
          </p>
        </div>
      </Section>

      {/* Text-length explainer + counter (§8, §PR). */}
      <Section
        bleed
        className="bg-gradient-to-b from-stone-50 to-teal-50 py-16 dark:from-background dark:to-teal-950/20 sm:py-24"
      >
        <Container>
          <div className="mx-auto grid max-w-4xl gap-10 lg:grid-cols-2 lg:items-center lg:gap-16">
            <div>
              <h2 className="display-h2 text-foreground">
                What&apos;s a &quot;text,&quot; exactly?
              </h2>
              <p className="mt-5 text-lg leading-relaxed text-muted-foreground">
                A plain text up to 160 characters counts as one text. Longer
                texts, or texts with emoji, count as more than one, the texting
                networks split them behind the scenes (the technical word is
                &quot;segments,&quot; but you never have to think about it). Your
                500 is 500 of these, and the composer always shows the count
                before you send, so there&apos;s no mystery on your bill.
              </p>
            </div>
            <Reveal>
              {/* Deferred: the static default count is real (same estimator) and
                  meaningful before/without JS; the typable counter loads on
                  viewport approach. */}
              <LazySegmentCounter fallback={<SegmentCounterStatic />} />
            </Reveal>
          </div>
        </Container>
      </Section>

      {/* Guarantee block (§8, §PR). */}
      <Section>
        <div className="mx-auto max-w-3xl rounded-2xl border border-border bg-card p-6 sm:p-10">
          <div className="flex gap-4">
            <span className="mt-1 flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Receipt className="size-5" strokeWidth={1.75} aria-hidden />
            </span>
            <div>
              <h2 className="text-2xl font-semibold text-foreground">
                Try it for a month, on us if it&apos;s not for you.
              </h2>
              <p className="mt-4 text-[15px] leading-relaxed text-muted-foreground">
                If Loonext isn&apos;t right for your crew, email us within 30
                days of signing up and we&apos;ll refund your first invoice in
                full, subscription and registration fee included. No &quot;minus
                credits used,&quot; no forms, no retention call. We&apos;d rather
                have your trust than your $29.
              </p>
            </div>
          </div>
        </div>
      </Section>

      {/* Pricing FAQ (9), no FAQPage JSON-LD (§11.2). */}
      <Section>
        <div className="mx-auto max-w-3xl">
          <h2 className="display-h2 text-center text-foreground">
            Pricing questions, straight answers.
          </h2>
          <div className="mt-12 divide-y divide-border border-y border-border">
            {FAQS.map((item) => (
              <details key={item.q} className="group">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-5 text-left text-[17px] font-medium text-foreground [&::-webkit-details-marker]:hidden">
                  {item.q}
                  <ListChecks
                    className="size-5 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-6"
                    strokeWidth={1.75}
                    aria-hidden
                  />
                </summary>
                <p className="pb-5 pr-8 text-[15px] leading-relaxed text-muted-foreground">
                  {item.a}
                </p>
              </details>
            ))}
          </div>
        </div>
      </Section>

      {/* Final CTA band (§8, §PR). Second allowed wash. */}
      <Section
        bleed
        className="bg-gradient-to-b from-stone-50 to-teal-50 py-16 dark:from-background dark:to-teal-950/20 sm:py-24"
      >
        <div className="mx-auto w-full max-w-3xl px-4 text-center sm:px-6">
          <h2 className="display-h2 text-foreground">
            You&apos;ve seen the whole price list. That&apos;s the point.
          </h2>
          <div className="mt-8 flex justify-center">
            <Button asChild size="lg">
              <Link href="/signup">
                Start for $29
                <ArrowRight strokeWidth={1.75} aria-hidden />
              </Link>
            </Button>
          </div>
          <p className="mt-4 text-[13px] tabular-nums text-muted-foreground">
            Live in minutes · Month to month · 30-day money-back guarantee
          </p>
        </div>
      </Section>
    </>
  );
}
