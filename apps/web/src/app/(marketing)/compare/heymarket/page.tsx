/**
 * /compare/heymarket, v4 "FIRST RESPONSE" (DESIGN-DIRECTION §6 COMPARE
 * template; COPY-DECK v2). Dateline Header (their published seat price) →
 * Honesty Ledger centerpiece (page-data.ts, every cell dated + sourced) →
 * slider chart → "when Heymarket fits better" honesty → switching Truth
 * Strip → CTA. No competitor logos, no dark patterns, no cheap shots; the
 * places Heymarket genuinely beats us (SOC 2, HIPAA BAA, email channel, CRM
 * depth) are stated outright.
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

import {
  HEYMARKET_COLUMNS,
  HEYMARKET_FOOTNOTE,
  HEYMARKET_ROWS,
} from "./page-data";

const PATH = LIVE_ROUTES.compareHeymarket;

export const metadata: Metadata = buildMetadata({
  title: "Loonext vs Heymarket: flat $29 vs $49 a person",
  description:
    "A dated, sourced comparison. Loonext is $29/mo flat with texting included under automated fair use; Heymarket is $49/user with a 2-user minimum, texts at 3¢/segment, and a $10/mo carrier fee. About $172 vs $29 for a 3-person crew, July 2026.",
  path: PATH,
});

export default function CompareHeymarketPage() {
  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Home", path: "/" },
          { name: "Compare", path: LIVE_ROUTES.compareIndex },
          { name: "Loonext vs Heymarket", path: PATH },
        ])}
      />

      <CompareHero
        dateline="$49/USER/MO · THEIR PUBLISHED STARTER SEAT"
        title="Loonext vs Heymarket: flat $29 vs $49 a person."
        lead="Heymarket is a polished, enterprise-grade shared inbox, and its price model is per user: $49 a seat with a two-seat minimum, texts billed on top at 3¢ a segment, plus a $10 monthly carrier fee. Loonext is $29 a month for the whole crew, texts included. Here is the arithmetic, dated and sourced, July 2026."
      />

      <LedgerBand
        heading="A 3-person crew, side by side."
        lead={
          <>
            Same crew, same workload of 500 texts a month, at published prices.
            Every Heymarket figure cites the exact line item from their public
            pricing page, including the rows that count in their favor. On
            Loonext, texting is included under an automated fair-use policy
            that covers this workload comfortably; the concrete numbers live
            in our{" "}
            <Link
              href={LIVE_ROUTES.fairUse}
              className="font-medium text-[color:var(--fr-cobalt)] underline-offset-2 hover:underline"
            >
              fair use policy
            </Link>
            .
          </>
        }
        footnote={HEYMARKET_FOOTNOTE}
      >
        <LedgerTable
          caption="Monthly cost for a 3-person crew sending 500 texts: Loonext Starter next to Heymarket Standard, at published prices as of July 2026."
          columns={HEYMARKET_COLUMNS}
          rows={HEYMARKET_ROWS}
        />
      </LedgerBand>

      <SliderBand
        heading="Per-user pricing climbs. Flat doesn't."
        lead="Heymarket's two-seat minimum puts its floor at $98 a month before a single text is sent. Slide your crew size and watch a typical per-user bill pull away from the flat line."
      />

      <HonestFit
        heading="When Heymarket fits better."
        intro="Heymarket is a serious product for a different buyer, and pretending otherwise would cost us your trust. Here's the straight read."
        loonextTitle="Reach for Loonext if"
        loonextBody={
          <>
            <p>
              You&apos;re a small service crew that wants every customer text
              in one shared inbox at one flat price, with the texts included
              and the whole cost printed before you pay.
            </p>
            <p>
              You want to sign up and pay online today, month to month, without
              booking a demo to get started.
            </p>
          </>
        }
        competitorTitle="Reach for Heymarket if"
        competitorBody={
          <>
            <p>
              You&apos;re a larger or regulated team that needs SOC 2, a HIPAA
              BAA, a unified text-and-email inbox, or deep Salesforce and
              HubSpot integrations, and per-user pricing is normal for how you
              buy software.
            </p>
            <p>
              A guided demo and an annual plan are how you prefer to roll a
              tool out across a bigger organization.
            </p>
          </>
        }
        points={[
          {
            title: "Compliance you can hand to an auditor.",
            body: "Heymarket publishes SOC 2 Type 2 and offers a HIPAA BAA. Loonext doesn't hold those certifications yet and won't claim them. For healthcare or security-reviewed procurement, that's a real gap on our side.",
          },
          {
            title: "Text and email in one shared inbox.",
            body: "Heymarket handles both channels together. Loonext is texting only. If your team needs to work email and texts from a single place, Heymarket does something we simply don't.",
          },
          {
            title: "Deep CRM integrations and automations.",
            body: "Heymarket integrates tightly with Salesforce and HubSpot and offers broadcasts, campaigns, and AI-assisted flows. Loonext keeps a deliberately small surface. If your workflow lives inside a CRM, Heymarket meets it where it is.",
          },
        ]}
        recommendation={
          <>
            Straight up: if you need SOC 2, a HIPAA BAA, a text-and-email
            inbox, or CRM-deep automations, buy Heymarket. It&apos;s built for
            that and does it well. If you&apos;re a service crew that wants
            texting to land in one place at one flat price, that&apos;s the job
            Loonext was built for.
          </>
        }
      />

      {/* The switch band's country-specific lines (the money-back fee clause
          and the registration/activation timeline) split so a US visitor reads
          the carrier wait and a Canadian reads the day-one story, never both. */}
      <CountryOnly country="us">
        <SwitchBand
          heading="Switching costs you nothing but the walk."
          lead="Start Loonext alongside Heymarket, move your texting over at your own pace, and cancel Heymarket when your conversations live here. There's no exit window on our side to plan around."
          items={[
            {
              text: "Keep your number: transfers from your current provider are free, self-serve at signup or later, and typically take 1 to 7 business days.",
              good: true,
            },
            {
              text: "Your number keeps working where it is today until the scheduled switch, so there's no dead air while it moves.",
              good: true,
            },
            {
              text: "Month to month, and a 30-day money-back guarantee covers your first invoice, registration fee included.",
              good: true,
            },
            {
              text: "US carrier registration applies at every provider, ours is a one-time $29 and we file it the minute you pay. Receiving texts work day one; US texting turns on in 3 to 7 business days.",
            },
          ]}
        />
      </CountryOnly>
      <CountryOnly country="ca">
        <SwitchBand
          heading="Switching costs you nothing but the walk."
          lead="Start Loonext alongside Heymarket, move your texting over at your own pace, and cancel Heymarket when your conversations live here. There's no exit window on our side to plan around."
          items={[
            {
              text: "Keep your number: transfers from your current provider are free, self-serve at signup or later, and typically take 1 to 7 business days.",
              good: true,
            },
            {
              text: "Your number keeps working where it is today until the scheduled switch, so there's no dead air while it moves.",
              good: true,
            },
            {
              text: "Month to month, and a 30-day money-back guarantee covers your first invoice.",
              good: true,
            },
            {
              text: "Texting Canadian customers works the day you sign up, with no registration to wait on. Receiving texts work day one too.",
              good: true,
            },
          ]}
        />
      </CountryOnly>

      <CompareCta
        heading="One flat price, texts included, no demo."
        sub="$29 a month covers the whole crew and the texts. No per-seat bill, no per-segment meter on top, no monthly carrier line item, and a full refund in your first 30 days if it's not for you."
      />
    </>
  );
}
