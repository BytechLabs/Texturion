/**
 * /canada, the Canada-first page, on the v4 "FIRST RESPONSE" CANADA template
 * (DESIGN-DIRECTION v4 §6, COPY-DECK v2).
 *
 * Dateline `DAY ONE · NO WAIT` → H1 "In Canada? You can text customers
 * today." → the flipped first-week timeline leads (green Day 0 node only:
 * the waiting segment does not exist; green is allowed to lead this one
 * page) → why there's no registration wait → province availability as an
 * Honesty Ledger, computed from the same NANP table the app picks numbers
 * from (@loonext/shared, nothing invented) → CASL consent records (the real
 * component) → USD Truth Strip → the enable-US-texting-later path → FAQ →
 * Frost CTA band.
 *
 * "Helps you follow CASL", never "CASL-compliant". US data residency stated,
 * not buried. Every number is a verified product/billing fact.
 */

import { Check } from "lucide-react";
import type { Metadata } from "next";

import { NANP_AREA_CODES } from "@loonext/shared";

import { JsonLd } from "@/components/marketing/ui/json-ld";
import { FrCard, PanelFrame } from "@/components/marketing/fr";
import {
  FeatureCta,
  FeatureFaq,
  FeatureHero,
  FeatureSection,
  PricingSnippet,
  RelatedLinks,
  TruthStripSection,
} from "@/components/marketing/features/feature-page";
import { ConsentVisual } from "@/components/marketing/features/consent-visual";
import { breadcrumbJsonLd, buildMetadata } from "@/lib/marketing/seo";

const PATH = "/canada";

export const metadata: Metadata = buildMetadata({
  title: "Business texting in Canada: text customers today",
  description:
    "Canadian crews text customers the day they sign up. No US carrier registration to wait on, local numbers in every province, CASL-aware consent records. $29/mo flat.",
  path: PATH,
});

/* -------------------------------------------------------------------------- */
/* The province ledger, computed from the app's own NANP table so every code  */
/* shown is one the app could actually assign (nothing invented, Law 7).     */
/* -------------------------------------------------------------------------- */

/** Canada Post province/territory code → display name, in ledger order. */
const PROVINCES: [string, string][] = [
  ["BC", "British Columbia"],
  ["AB", "Alberta"],
  ["SK", "Saskatchewan"],
  ["MB", "Manitoba"],
  ["ON", "Ontario"],
  ["QC", "Quebec"],
  ["NB", "New Brunswick"],
  ["NS", "Nova Scotia"],
  ["PE", "Prince Edward Island"],
  ["NL", "Newfoundland and Labrador"],
];

/** The territories share one geographic code; shown as a single ledger row. */
const TERRITORIES: string[] = ["NT", "NU", "YT"];

function codesForRegions(regions: string[]): string[] {
  const codes = Object.entries(NANP_AREA_CODES)
    .filter(
      ([, entry]) =>
        entry.country === "CA" &&
        entry.geographic &&
        entry.region !== null &&
        regions.includes(entry.region),
    )
    .map(([code]) => code);
  return [...new Set(codes)].sort();
}

function ProvinceLedger() {
  const rows: { label: string; codes: string[] }[] = [
    ...PROVINCES.map(([region, label]) => ({
      label,
      codes: codesForRegions([region]),
    })),
    { label: "Yukon, Northwest Territories, Nunavut", codes: codesForRegions(TERRITORIES) },
  ];
  return (
    <div className="overflow-hidden rounded-xl">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr>
            <th className="fr-eyebrow px-4 py-3 text-[color:var(--fr-ink-55)]">
              Province
            </th>
            <th className="fr-eyebrow px-4 py-3 text-right text-[color:var(--fr-ink-55)]">
              Local area codes
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={row.label}
              className={i % 2 === 0 ? "bg-[color:var(--fr-frost)]" : undefined}
            >
              <td className="font-body-mkt px-4 py-2.5 text-[15px] text-[color:var(--fr-ink)]">
                {row.label}
              </td>
              <td className="fr-mono-data px-4 py-2.5 text-right text-[color:var(--fr-ink)]">
                {row.codes.join(" · ")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* The flipped first-week timeline: a green Day 0 node, and the waiting       */
/* segment shown as the thing that does not exist here.                       */
/* -------------------------------------------------------------------------- */

function FlippedTimeline() {
  return (
    <FrCard className="p-6 sm:p-8">
      <div className="flex gap-4">
        <span
          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[color:var(--fr-green)] text-white"
          aria-hidden
        >
          <Check className="size-5" strokeWidth={2.5} />
        </span>
        <div>
          <p className="fr-eyebrow text-[color:var(--fr-ink-55)]">Day 0</p>
          <h3 className="fr-h3 mt-2 text-[color:var(--fr-ink)]">
            You&apos;re live. That&apos;s the whole timeline.
          </h3>
          <p className="font-body-mkt mt-2 text-[15px] leading-relaxed text-[color:var(--fr-ink-70)]">
            Your number is up. Receiving texts works. Texting Canadian
            customers works. Invite the crew and start today.
          </p>
        </div>
      </div>
      <div className="mt-6 rounded-xl bg-[color:var(--fr-frost)] px-4 py-3.5">
        <p className="fr-eyebrow text-[color:var(--fr-ink-55)]">
          Days 1 to 7 · US carrier review
        </p>
        <p className="font-body-mkt mt-1.5 text-[14px] leading-relaxed text-[color:var(--fr-ink-70)]">
          Doesn&apos;t apply here. A Canadian business texting Canadian
          customers has no registration to wait on, so this segment does not
          exist.
        </p>
      </div>
    </FrCard>
  );
}

export default function CanadaPage() {
  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Home", path: "/" },
          { name: "Canada", path: PATH },
        ])}
      />

      <FeatureHero
        dateline="DAY ONE · NO WAIT"
        title="In Canada? You can text customers today."
        sub="The US phone-company registration that makes American shops wait about a week doesn't apply to a Canadian business texting Canadian customers. So on Loonext, you pick a local number, invite the crew, and start texting the same day you sign up. One shared inbox, $29 a month for the whole team, flat."
        panel={<FlippedTimeline />}
      />

      <FeatureSection
        ground="frost"
        eyebrow="Why there's no wait"
        heading="No registration wait. Just text."
      >
        <p>
          Here&apos;s the whole reason, in one plain sentence: the
          phone-company registration that US texting requires, the thing that
          adds 3 to 7 business days for American shops, isn&apos;t required
          for a Canadian business texting Canadian customers. No
          brand-and-campaign approval to sit through, no carrier review, no
          countdown banner. Your number is live, and it can send.
        </p>
        <p>
          That&apos;s not a workaround or a trial mode; it&apos;s how the
          rules work north of the border, and Loonext is built to take
          advantage of it. Pick your number, add your crew, put &quot;call or
          text&quot; on your trucks, and you&apos;re in business the same
          afternoon.
        </p>
      </FeatureSection>

      <FeatureSection
        eyebrow="Local numbers"
        heading="A local number, in every province."
        visual={
          <div>
            <ProvinceLedger />
            <p className="font-body-mkt mt-3 text-[13px] text-[color:var(--fr-ink-55)]">
              Area codes from the North American Numbering Plan, the same
              table the app picks your number from.
            </p>
          </div>
        }
      >
        <p>
          Type your city at signup and Loonext finds you a matching local
          number: a (416) or a (647) in Toronto, a (604) in Vancouver, a (403)
          in Calgary, a (902) in Halifax. A customer in your city sees a
          number that looks like it&apos;s from their city, because it is.
        </p>
        <p>
          Local numbers are available across every province, and the ledger
          here is generated from the same numbering data the app assigns
          from, so it stays true as codes are added.
        </p>
      </FeatureSection>

      <FeatureSection
        ground="frost"
        eyebrow="CASL-aware"
        heading="Built to help you follow CASL."
        visual={
          <PanelFrame
            caption="The consent record on each contact: how it came to be, who recorded it, and when."
            ariaLabel="Two Loonext contacts showing their CASL-relevant consent records"
          >
            <ConsentVisual />
          </PanelFrame>
        }
        flip
      >
        <p>
          CASL is Canada&apos;s anti-spam law, and Loonext is built with it in
          mind. A customer who texts you first is recorded as having consented
          the moment their text arrives. Starting a new conversation stamps a
          consent record with a name and a date. And when a customer texts
          STOP, they&apos;re opted out instantly, with any future send to that
          number blocked before it leaves the app.
        </p>
        <p>
          We&apos;re careful with the words here: Loonext <em>helps you
          follow</em> CASL, it doesn&apos;t make you &quot;CASL-compliant&quot;,
          because staying within the law also depends on you only texting
          people who actually agreed to hear from you. We keep the records and
          enforce the opt-outs; you bring the real list.
        </p>
      </FeatureSection>

      <FeatureSection
        eyebrow="Texting the US later"
        heading="Want to text US customers too? Turn it on any time."
      >
        <p>
          Plenty of Canadian shops have customers, suppliers, or a second
          location across the border. When you&apos;re ready, enable US
          texting from settings: the one-time $29 registration fee and the
          3 to 7 business day carrier approval apply then, the same wait US
          shops have. Until you enable it, you never pay the fee and never
          wait, and everything you&apos;ve built stays exactly as it is.
        </p>
        <p>
          And a plain word about where your data lives: it&apos;s stored and
          processed in the United States, and our privacy policy discloses the
          cross-border transfer the way PIPEDA and Quebec&apos;s Law 25
          expect. Message content stays out of our analytics and error logs.
        </p>
      </FeatureSection>

      <TruthStripSection
        heading="Stated plainly"
        items={[
          {
            text: "Texting Canadian customers works day one. No registration, no fee, no wait.",
            good: true,
          },
          {
            text: "Billing is in USD for now, plus tax. CAD billing is coming; until it's real, we won't pretend otherwise.",
          },
          {
            text: "Your data is stored in the United States, and the privacy policy says so plainly.",
          },
        ]}
      />

      <PricingSnippet>
        <p>
          Same flat price as everyone: $29/mo on Starter for up to 3 people
          and one local number, $79/mo on Pro for up to 10 people and two
          numbers. Receiving texts is always free and unlimited, month to
          month.
        </p>
        <p>
          A Canadian business texting Canadian customers pays no registration
          fee and waits for nothing. The one-time $29 fee and the 3 to 7
          business day approval only ever apply if you choose to enable US
          texting later. Prices in USD, plus sales tax where it applies.
        </p>
      </PricingSnippet>

      <RelatedLinks
        heading="A shared inbox for Canadian crews"
        intro="Day-one texting is the headline; the shared inbox, the numbers, and the compliance handling are what you use every day."
        links={[
          {
            label: "Your business number",
            href: "/features/business-number",
            hint: "Local Canadian numbers in every province, from the same numbering data.",
          },
          {
            label: "Compliance built in",
            href: "/features/compliance",
            hint: "Consent records and opt-out enforcement, in depth.",
          },
          {
            label: "Texting for cleaners",
            href: "/for/cleaners",
            hint: "Recurring confirmations and reschedules, for Canadian cleaning crews.",
          },
          {
            label: "Texting for landscapers",
            href: "/for/landscapers",
            hint: "Seasonal quote volume across sites, texting the same day you sign up.",
          },
        ]}
      />

      <FeatureFaq
        heading="Canada questions, straight answers."
        faqs={[
          {
            q: "Can I really text customers the same day I sign up?",
            a: "Yes, if you're a Canadian business texting Canadian customers. The US carrier registration that makes American shops wait about a week doesn't apply to Canada-to-Canada texting, so your number can send as soon as it's active, usually a minute or two after you subscribe.",
          },
          {
            q: "Do I get a real Canadian number?",
            a: "Yes, a local number in the area code you choose, available across every province. The ledger on this page comes from the same numbering data the app assigns your number from.",
          },
          {
            q: "Does Loonext make me CASL-compliant?",
            a: "It helps you follow CASL; that's the accurate phrasing. Loonext records consent and enforces opt-outs, which are the mechanics CASL cares about. Staying compliant also depends on you only texting people who agreed to hear from you, which is on you, not the tool.",
          },
          {
            q: "Where is my data stored?",
            a: "In the United States. We state this plainly and disclose the cross-border transfer in our privacy policy, the way PIPEDA and Quebec's Law 25 expect. Message content is also kept out of our analytics and error logs; the details are on our security page.",
          },
          {
            q: "I bill in Canada. Can I pay in Canadian dollars?",
            a: "Not yet. Prices are in USD for now, so your card is charged in US dollars and your bank handles the conversion. CAD billing is coming, and we'd rather tell you that now than surprise you at checkout.",
          },
        ]}
      />

      <FeatureCta
        heading="Text your Canadian customers today."
        sub="Pick a local number, invite the crew, and start texting the same afternoon. No registration wait, no sales call, month to month."
      />
    </>
  );
}
