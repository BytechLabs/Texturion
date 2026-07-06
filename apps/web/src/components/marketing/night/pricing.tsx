import Link from "next/link";

import { Reveal } from "@/components/marketing/ui/reveal";
import { Section } from "@/components/marketing/ui/section";

/**
 * S5 — Pricing ("Quiet daylight" v3 §6 S5). Light band; the craft is in the
 * receipt, no set piece.
 *
 * - id="pricing" is the anchor target of EVERY pricing link on the site (the
 *   hero's "See pricing", the sticky header link).
 * - The honesty strip sits INSIDE each card at the decision point (between
 *   the line items and the CTA) and at >= neighboring text size: the US
 *   carrier wait may never be hidden or shrunk.
 * - The comparison table is a quiet receipt: one mono voice, hairline rules,
 *   figures right-aligned, no checkmark columns. Copper appears exactly
 *   twice on the page's money: the 2px price underline and the delta figure.
 * - Server component, zero JS, zero section CSS. Everything is static; the
 *   only motion is the standard <Reveal> rise (v3 §4).
 */

/* ---- Copy (deck S5, verbatim slot by slot) -------------------------------- */

const HONESTY_STRIP =
  "Canada texts right away. US texting turns on in about a week once carriers approve.";

type Plan = {
  name: string;
  price: string;
  items: readonly string[];
  cta: string;
};

const PLANS: readonly Plan[] = [
  {
    name: "Starter",
    price: "$29",
    items: [
      "3 users",
      "1 local number",
      "500 outbound segments a month",
      "Inbound free, unmetered",
      "$29 one-time US carrier registration",
      "Month to month",
      "30-day money back",
    ],
    cta: "Start with one number",
  },
  {
    name: "Pro",
    price: "$79",
    items: [
      "10 users",
      "2 local numbers",
      "2,500 outbound segments a month",
      "Inbound free, unmetered",
      "$29 one-time US carrier registration",
      "Month to month",
      "30-day money back",
    ],
    cta: "Start with Pro",
  },
];

/* Deck note 3 (honesty correction): five people is a Pro shop, so the table
   is written at $79 flat with the Starter callout beneath it. */
const COMPARISON: readonly {
  tool: string;
  cost: string;
  note: string;
  self?: boolean;
}[] = [
  { tool: "Quo", cost: "$75 to $95", note: "$15 to $19 per seat, times five" },
  { tool: "Heymarket", cost: "$245 and up", note: "$49 and up per seat, times five" },
  { tool: "Podium", cost: "a sales call to find out", note: "annual contract" },
  {
    tool: "Loonext",
    cost: "$79 flat",
    note: "Pro covers up to 10 people and 2 numbers",
    self: true,
  },
];

/* ---- Pieces ---------------------------------------------------------------- */

function PlanCard({ plan }: { plan: Plan }) {
  return (
    <div className="panel-card flex h-full flex-col rounded-xl p-6 sm:p-8">
      <h3 className="display-h3">{plan.name}</h3>

      {/* The price figure: retuned display-numeral (Besley 700) over a 2px
          copper rule — copper only ever touches money. /mo stays in the mono
          data voice. */}
      <p className="mt-4">
        <span className="display-numeral inline-block border-b-2 border-[color:var(--copper)] pb-1.5 text-[color:var(--day-ink)]">
          {plan.price}
        </span>
        <span className="font-mono-mkt ml-1.5 text-sm tracking-[0.02em] text-[color:var(--ink-55)]">
          /mo
        </span>
      </p>

      {/* Line items exactly as truth, Martian Mono (any number a lawyer could
          check is set in the mono), hairline separators like a till roll. */}
      <ul className="font-mono-mkt mt-6 divide-y divide-[color:var(--rule-light)] border-y border-[color:var(--rule-light)] text-[0.8125rem] leading-[1.4] tracking-[0.02em] text-[color:var(--ink-70)]">
        {plan.items.map((item) => (
          <li key={item} className="py-2.5">
            {item}
          </li>
        ))}
      </ul>

      {/* The decision point. mt-auto pins strip + CTA to the card foot so both
          cards' CTAs align. The strip is amber-at-10% with day-ink text and is
          NOT smaller than its neighbors (the carrier wait may never be
          shrunk below neighboring text). */}
      <div className="mt-auto pt-6">
        <p className="rounded-lg bg-[color:var(--amber-strip)] px-3.5 py-2.5 text-sm leading-[1.5] text-[color:var(--day-ink)]">
          {HONESTY_STRIP}
        </p>
        <Link
          href="/signup"
          className="mt-4 inline-flex w-full items-center justify-center rounded-lg bg-[color:var(--petrol)] px-5 py-3 text-[0.9375rem] font-semibold text-white transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--petrol)]"
        >
          {plan.cta}
        </Link>
      </div>
    </div>
  );
}

/* ---- The section ----------------------------------------------------------- */

export function Pricing() {
  return (
    <Section
      id="pricing"
      defer
      intrinsic={1700}
      className="bg-[color:var(--first-light)] text-[color:var(--day-ink)]"
    >
      <Reveal className="mx-auto max-w-2xl text-center">
        <h2 className="display-h2 text-balance">One flat price. Bring the whole crew.</h2>
        <p className="mt-4 text-base leading-relaxed text-[color:var(--ink-70)] sm:text-lg">
          Month to month. 30-day money back. No sales calls, no contracts, no
          demo you have to book. Start it yourself.
        </p>
      </Reveal>

      {/* Two tall cards, side by side, stacked on mobile. */}
      <div className="mx-auto mt-12 grid max-w-4xl items-stretch gap-6 md:grid-cols-2">
        {PLANS.map((plan, i) => (
          <Reveal key={plan.name} delay={i * 60} className="h-full">
            <PlanCard plan={plan} />
          </Reveal>
        ))}
      </div>

      {/* Canonical line, verbatim, shared under both cards (deck note 1). */}
      <Reveal className="mt-8">
        <p className="text-center text-base font-medium leading-relaxed">
          Inbound texts are free. We never meter what customers send you.
        </p>
      </Reveal>

      {/* The quiet receipt. A real <table> (a11y: caption announces the
          heading, row headers name the tool); row order follows the deck
          verbatim: tool · cost · how it's counted. */}
      <Reveal className="mx-auto mt-14 max-w-3xl">
        <table className="font-mono-mkt w-full border-collapse text-left text-[0.8125rem] leading-[1.4] tracking-[0.02em] text-[color:var(--day-ink)]">
          <caption className="pb-4 text-left text-sm font-medium">
            What five people cost each month
          </caption>
          <tbody>
            {COMPARISON.map((row) => (
              <tr key={row.tool} className={row.self ? "font-semibold" : undefined}>
                <th
                  scope="row"
                  className="border-t border-[color:var(--rule-light)] py-3 pr-4 text-left align-baseline font-medium whitespace-nowrap"
                >
                  {row.tool}
                </th>
                <td className="border-t border-[color:var(--rule-light)] py-3 pr-4 text-right align-baseline">
                  {row.cost}
                </td>
                <td className="border-t border-[color:var(--rule-light)] py-3 pl-2 text-left align-baseline text-[color:var(--ink-55)]">
                  {row.note}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td
                colSpan={3}
                className="border-t border-[color:var(--rule-light)] pt-4 text-right"
              >
                {/* The delta: the page's one copper money figure. Static. */}
                <span className="block text-xl font-semibold leading-none text-[color:var(--copper)]">
                  $166+ back every month
                </span>
                <span className="mt-1.5 block text-xs text-[color:var(--ink-55)]">
                  next to five seats on Heymarket
                </span>
              </td>
            </tr>
          </tfoot>
        </table>
        <p className="font-body-mkt mt-3 text-sm leading-[1.5] text-[color:var(--ink-55)]">
          Competitor figures are each tool&apos;s published per-seat pricing as
          of July 2026;{" "}
          <Link
            href="/compare"
            className="underline decoration-[color:var(--rule-light)] underline-offset-2 hover:text-[color:var(--ink-70)]"
          >
            see the full comparisons
          </Link>{" "}
          for sources.
        </p>
      </Reveal>

      {/* Starter callout (deck note 3's honesty correction) and the canonical
          flat-pricing caption, verbatim, closing the section. */}
      <Reveal className="mx-auto mt-12 max-w-2xl text-center">
        <p className="text-base leading-relaxed text-[color:var(--ink-70)]">
          Crew of three or fewer? Starter is $29 flat.
        </p>
        <p className="mt-3 text-lg font-semibold leading-snug sm:text-xl">
          $29 a month covers the whole crew. Not $29 each.
        </p>
      </Reveal>
    </Section>
  );
}
