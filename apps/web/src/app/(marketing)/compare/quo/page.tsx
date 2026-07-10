/**
 * /compare/quo, v4 "FIRST RESPONSE" (DESIGN-DIRECTION §6 COMPARE template;
 * COPY-DECK v2). Dateline Header (their per-user + per-segment arithmetic) →
 * Honesty Ledger centerpiece (page-data.ts; never claims a bundled texting
 * allowance for Quo, because it doesn't sell one) → slider chart (the $19
 * seat price in the chart IS Quo's, sourced here) → the honest calling
 * concession (Quo is a full phone system; Loonext can't place calls) →
 * switching Truth Strip → CTA. Their $19.50 registration disclosure is
 * credited in the footnote, as the deck orders.
 *
 * JSON-LD: buildMetadata + BreadcrumbList only. Fully static. No em-dashes
 * anywhere in rendered text (Law 6).
 */

import Link from "next/link";
import type { Metadata } from "next";

import { CountryOnly } from "@/components/marketing/country";
import {
  CompareCta,
  CompareHero,
  HonestFit,
  LedgerBand,
  SliderBand,
  SwitchBand,
} from "@/components/marketing/compare/compare-sections";
import { LedgerTable } from "@/components/marketing/compare/ledger-table";
import { JsonLd } from "@/components/marketing/ui/json-ld";
import { breadcrumbJsonLd, buildMetadata } from "@/lib/marketing/seo";
import { LIVE_ROUTES } from "@/lib/marketing/site";

import { QUO_COLUMNS, QUO_FOOTNOTE, QUO_ROWS } from "./page-data";

const PATH = LIVE_ROUTES.compareQuo;

export const metadata: Metadata = buildMetadata({
  title: "Loonext vs Quo: flat beats per-user",
  description:
    "A dated, sourced comparison. Loonext is $29/mo flat with texting included under automated fair use; Quo (formerly OpenPhone) is $19/user/mo on monthly billing with texting metered at 1¢/segment and extra numbers at $5/mo. Where Quo's calling genuinely wins, we say so.",
  path: PATH,
});

export default function CompareQuoPage() {
  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Home", path: "/" },
          { name: "Compare", path: LIVE_ROUTES.compareIndex },
          { name: "Loonext vs Quo", path: PATH },
        ])}
      />

      <CompareHero
        dateline="$19/USER/MO + 1¢/TEXT"
        title="Loonext vs Quo: flat beats per-user."
        lead="Quo (formerly OpenPhone) is a full business phone system: calling included, priced per user at $19 a month on monthly billing, with texting metered at 1¢ a segment and extra numbers at $5 each. Loonext is texting only, $29 a month flat for the whole crew, texts included. Here is the arithmetic, dated and sourced, July 2026."
      />

      <LedgerBand
        heading="A 3-person crew, side by side."
        lead={
          <>
            Same crew, same workload of 500 texts a month, at published prices.
            Quo&apos;s texting cell states its real metered terms, we won&apos;t
            print a bundled allowance it doesn&apos;t sell, and the row where
            Quo flatly beats us is in the table too. On Loonext, texting is
            included under an automated fair-use policy that covers this
            workload comfortably; the concrete numbers live in our{" "}
            <Link
              href={LIVE_ROUTES.fairUse}
              className="font-medium text-[color:var(--fr-cobalt)] underline-offset-2 hover:underline"
            >
              fair use policy
            </Link>
            .
          </>
        }
        footnote={QUO_FOOTNOTE}
      >
        <LedgerTable
          caption="Monthly cost for a 3-person crew sending 500 texts: Loonext Starter next to Quo Starter, at published prices as of July 2026."
          columns={QUO_COLUMNS}
          rows={QUO_ROWS}
        />
      </LedgerBand>

      <SliderBand
        heading="This chart's $19 line is Quo's own seat price."
        lead="The per-user line in this chart is Quo Starter's published $19/user monthly price, and it doesn't include their metered texting. Slide your crew size and watch the gap."
      />

      <HonestFit
        heading="When Quo fits better."
        intro="Quo is a mature product with a real edge over us, and the biggest one is the obvious one: it's a phone system."
        loonextTitle="Reach for Loonext if"
        loonextBody={
          <>
            <p>
              Texting is the job: customers text photos of the problem, the
              crew answers from the truck, and you want all of it in one shared
              inbox at one flat price with the texts included.
            </p>
            <CountryOnly country="us">
              <p>
                You&apos;d rather one flat bill than per-user math: $29 covers
                the whole crew and the texts, with no per-seat fee and no
                per-segment meter on top.
              </p>
            </CountryOnly>
            <CountryOnly country="ca">
              <p>
                You&apos;re texting Canadian customers, or splitting work across
                US and Canadian customers: Canadian texting works the day you
                sign up, with no registration wait.
              </p>
            </CountryOnly>
          </>
        }
        competitorTitle="Reach for Quo if"
        competitorBody={
          <>
            <p>
              Your business lives on phone calls. Quo makes and receives them,
              with unlimited US and Canada calling on every tier, voicemail,
              and an AI agent. Loonext cannot place a call; our $8/mo add-on
              only forwards calls to your cell and texts back the ones you
              miss.
            </p>
            <p>
              You want desktop and mobile apps for a distributed team that
              treats the phone line, not the text thread, as home base.
            </p>
          </>
        }
        points={[
          {
            title: "Calling is the honest headline.",
            body: "Unlimited US/Canada calling ships on every Quo tier. If your customers expect to reach you by voice all day, Quo is genuinely the better tool and no texting inbox replaces it.",
          },
          {
            title: "Their fee disclosure sets a high bar.",
            body: "Quo prints its $19.50 one-time registration and its $1.50 to $3 monthly carrier maintenance right on the pricing page, and even reminds you before a trial ends. Credit where due; we aim to beat it, not match it, with one $29 fee, once, and no recurring carrier line at all.",
          },
          {
            title: "A bigger app surface.",
            body: "Quo ships iOS, Android, macOS, Windows, and web apps plus integrations and an API. Loonext is a fast web app you add to your home screen, deliberately smaller.",
          },
        ]}
        recommendation={
          <>
            Plainly: if the phone ringing is your front door, buy Quo. If the
            text thread is your front door and you&apos;re tired of it living
            on one person&apos;s cell, Loonext gives the whole crew one inbox
            for $29 flat, and the texts are already in the price.
          </>
        }
      />

      {/* The money-back line names the US registration fee, so it splits by
          country; the rest of the band is shared. */}
      <CountryOnly country="us">
        <SwitchBand
          heading="Switching from a per-user bill is quick math."
          lead="Count your seats, add the metered texting, and put the total next to $29 or $79 flat. If the flat line wins, moving is painless."
          items={[
            {
              text: "Keep your number: transfers from Quo or any carrier are free, self-serve at signup or later, and typically take 1 to 7 business days.",
              good: true,
            },
            {
              text: "Your number keeps working on your current provider until the scheduled switch, so you can run both while you move.",
              good: true,
            },
            {
              text: "Month to month, with a 30-day full money-back guarantee, registration fee included.",
              good: true,
            },
            {
              text: "If your team makes calls from the app all day, read the calling section above before you switch; Loonext won't do that job.",
            },
          ]}
        />
      </CountryOnly>
      <CountryOnly country="ca">
        <SwitchBand
          heading="Switching from a per-user bill is quick math."
          lead="Count your seats, add the metered texting, and put the total next to $29 or $79 flat. If the flat line wins, moving is painless."
          items={[
            {
              text: "Keep your number: transfers from Quo or any carrier are free, self-serve at signup or later, and typically take 1 to 7 business days.",
              good: true,
            },
            {
              text: "Your number keeps working on your current provider until the scheduled switch, so you can run both while you move.",
              good: true,
            },
            {
              text: "Month to month, with a 30-day full money-back guarantee.",
              good: true,
            },
            {
              text: "If your team makes calls from the app all day, read the calling section above before you switch; Loonext won't do that job.",
            },
          ]}
        />
      </CountryOnly>

      <CompareCta
        heading="Flat for the crew, texts included."
        sub="$29 a month covers up to three people with texting included; $79 covers up to fifteen, with a second number in the price. No seat math, no per-segment meter, and a full refund in your first 30 days if it's not for you."
      />
    </>
  );
}
