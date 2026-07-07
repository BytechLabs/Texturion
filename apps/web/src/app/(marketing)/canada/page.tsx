/**
 * /canada, the Canada-first story (BLUEPRINT §2, §7). Targets "business
 * texting canada" and "text customers canada". This is the market's only
 * Canada-first page; keep it concrete, not patriotic.
 *
 * Sections (§7): instant CA activation (no US 10DLC wait), local numbers in
 * every province (the shared city→area-code widget with CA data), CASL-aware
 * features ("helps you follow CASL", never "CASL-compliant"), honest US data-
 * residency disclosure stated not buried, enable-US-texting-later path ($29 then,
 * 3–7 business days), USD pricing acknowledged head-on. FAQ (5). Every claim
 * traces to SPEC §4.2/§5. buildMetadata + BreadcrumbList JSON-LD; NO FAQPage.
 */

import Link from "next/link";
import { ArrowRight, Database, MapPin, ShieldCheck, Zap } from "lucide-react";
import type { Metadata } from "next";

import { Container } from "@/components/marketing/ui/container";
import { JsonLd } from "@/components/marketing/ui/json-ld";
import { Reveal } from "@/components/marketing/ui/reveal";
import { Section } from "@/components/marketing/ui/section";
import { Display, MarkerCheck } from "@/components/marketing/display";
import { ArrowLink } from "@/components/marketing/ledger/arrow-link";
import { CityAreaCodeWidget } from "@/components/marketing/interactive/city-area-code-widget";
import { NumberCardsVisual } from "@/components/marketing/features/number-cards-visual";
import { ConsentVisual } from "@/components/marketing/features/consent-visual";
import { PhotoFrame } from "@/components/marketing/photo-frame";
import { Photo } from "@/components/marketing/photo";
import { Button } from "@/components/ui/button";
import {
  FeatureCta,
  FeatureFaq,
  FeatureSection,
  MiniPricing,
  RelatedLinks,
} from "@/components/marketing/features/feature-page";
import { breadcrumbJsonLd, buildMetadata } from "@/lib/marketing/seo";

const PATH = "/canada";

export const metadata: Metadata = buildMetadata({
  title: "Business texting in Canada, text customers the same day",
  description:
    "Canadian crews text customers the day they sign up, no US carrier registration to wait on. Local numbers in every province, CASL-aware. Flat $29/mo.",
  path: PATH,
});

export default function CanadaPage() {
  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Home", path: "/" },
          { name: "Canada", path: PATH },
        ])}
      />

      {/* Hero, the Canada-first claim nobody else in the market makes (§7),
          composed in the "Caught" system over a real duotone photo. */}
      <section className="relative overflow-hidden pb-14 pt-28 sm:pb-20 sm:pt-32">
        <Container>
          <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.02fr)] lg:gap-16">
            <div>
              <p className="font-mono-mkt flex items-center gap-2.5 text-[13px] font-medium tracking-[0.04em] text-[color:var(--graphite)]">
                <span aria-hidden className="h-px w-6 bg-[color:var(--petrol)]/50" />
                Made in Canada, for Canadian crews
              </p>
              <Display as="h1" size="hero" className="mt-5 text-balance">
                Canadian crews text customers{" "}
                <Display.Mark>day one</Display.Mark>, no wait.
              </Display>
              <p className="mt-6 max-w-xl text-lg leading-relaxed text-[color:var(--ink-70)]">
                The US carrier registration that makes American shops wait about
                a week doesn&apos;t apply to a Canadian business texting Canadian
                customers. So on Loonext, you pick a local number, invite the
                crew, and start texting, today. One shared inbox, one flat price:
                a flat{" "}
                <span className="font-mono-mkt text-[color:var(--petrol)]">
                  $29
                </span>{" "}
                a month for the whole team.
              </p>

              <div className="mt-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-6">
                <Button asChild size="lg" className="w-full sm:w-auto">
                  <Link href="/signup">
                    Start for $29
                    <ArrowRight strokeWidth={1.75} aria-hidden />
                  </Link>
                </Button>
                <ArrowLink href="/pricing">See pricing</ArrowLink>
              </div>

              <ul className="mt-7 flex flex-wrap gap-x-5 gap-y-2.5">
                {[
                  "Texting works day one",
                  "Local numbers, every province",
                  "CASL-aware from the first text",
                ].map((chip) => (
                  <li
                    key={chip}
                    className="flex items-center gap-2 text-[13px] text-[color:var(--ink-70)]"
                  >
                    <MarkerCheck
                      color="petrol"
                      draw={false}
                      className="size-4 shrink-0"
                    />
                    {chip}
                  </li>
                ))}
              </ul>
            </div>

            <Reveal className="relative">
              <PhotoFrame
                id="crew-rooftop"
                priority
                aspect="4 / 3"
                sizes="(min-width: 1024px) 44vw, 92vw"
                caption={{ label: "Texting day one, in Canada" }}
              />
            </Reveal>
          </div>
        </Container>
      </section>

      {/* Section 1, instant activation, explained plainly (no 10DLC jargon). */}
      <FeatureSection
        eyebrow="Instant activation"
        heading="No registration wait. Just text."
        visual={<NumberCardsVisual className="mx-auto max-w-md" />}
        wash
      >
        <p>
          Here&apos;s the whole reason Canadian crews are texting on day one, in
          one plain sentence: the phone-company registration that US texting
          requires, the thing that adds about a week for American shops,
          simply isn&apos;t required for a Canadian business texting Canadian
          customers. There&apos;s no brand-and-campaign approval to sit through,
          no carrier review, no &ldquo;activates in 3–7 business days&rdquo;
          banner. Your number is live, and it can send.
        </p>
        <p>
          That&apos;s not a workaround or a trial mode, it&apos;s how the rules
          actually work north of the border, and Loonext is built to take
          advantage of it. Pick your number, add your crew, put &ldquo;call or
          text&rdquo; on your trucks, and you&apos;re in business the same
          afternoon.
        </p>
      </FeatureSection>

      {/* Section 2, local numbers in every province (the widget as visual). */}
      <FeatureSection
        eyebrow="Local numbers"
        heading="A local number, in every province."
        visual={<CityAreaCodeWidget />}
        flip
      >
        <p>
          Type your city and Loonext finds you a matching local number, a (416)
          or (647) in Toronto, a (604) in Vancouver, a (403) in Calgary, a (902)
          in Halifax. The picker uses the same real numbering data the app uses
          to choose your number, so a customer in your city sees a number that
          looks like it&apos;s from their city.
        </p>
        <p>
          Local numbers are available across every province, so wherever your
          crew works, the number your customers text looks like it belongs there
          , because it does.
        </p>
      </FeatureSection>

      {/* Section 3. CASL-aware features (helps you follow CASL, never claims). */}
      <FeatureSection
        eyebrow="CASL-aware"
        heading="Built to help you follow CASL, not to promise you're covered."
        visual={<ConsentVisual />}
        wash
      >
        <p>
          CASL is Canada&apos;s anti-spam law, and Loonext is built with it in
          mind. Consent is recorded when you start a conversation, one checkbox
          confirming the customer asked you to text them, saved with a name and a
          date. And when a customer texts STOP, they&apos;re opted out instantly,
          with any future send to that number blocked before it ever leaves the
          app.
        </p>
        <p>
          We&apos;re careful with the words here: Loonext <em>helps you follow</em>{" "}
          CASL, it doesn&apos;t make you &ldquo;CASL-compliant,&rdquo; because
          staying within the law also depends on you only texting people who
          actually agreed to hear from you. We give you the consent records and
          the opt-out enforcement; you bring the honest list.
        </p>
      </FeatureSection>

      {/* Section 4, honest data residency (stated, not buried), §7. */}
      <Section>
        <div className="mx-auto max-w-3xl">
          <p className="font-mono-mkt flex items-center gap-2.5 text-[13px] font-medium tracking-[0.04em] text-[color:var(--graphite)]">
            <span aria-hidden className="h-px w-6 bg-[color:var(--petrol)]/50" />
            Where your data lives
          </p>
          <Display as="h2" size="h2" className="mt-3">
            Plain about your data, including that it&apos;s processed in the US.
          </Display>
          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            <div className="flex gap-3 rounded-2xl border border-[color:var(--hairline)] bg-[color:var(--paper-2)] p-5">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[color:var(--petrol-12)] text-[color:var(--petrol)]">
                <Database className="size-5" strokeWidth={1.75} aria-hidden />
              </span>
              <div>
                <h3 className="text-[15px] font-semibold text-[color:var(--ink)]">
                  Processed in the United States
                </h3>
                <p className="mt-1.5 text-[14px] leading-relaxed text-[color:var(--ink-70)]">
                  Your data is stored and processed in the US (our database is in
                  AWS us-east-1). We state this plainly rather than bury it, and
                  our privacy policy discloses the cross-border transfer the way
                  PIPEDA and Quebec&apos;s Law 25 expect.
                </p>
              </div>
            </div>
            <div className="flex gap-3 rounded-2xl border border-[color:var(--hairline)] bg-[color:var(--paper-2)] p-5">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[color:var(--petrol-12)] text-[color:var(--petrol)]">
                <ShieldCheck className="size-5" strokeWidth={1.75} aria-hidden />
              </span>
              <div>
                <h3 className="text-[15px] font-semibold text-[color:var(--ink)]">
                  Message content stays private
                </h3>
                <p className="mt-1.5 text-[14px] leading-relaxed text-[color:var(--ink-70)]">
                  Your customers&apos; numbers and consent data are never sold or
                  shared for marketing, and message content is kept out of our
                  analytics and error logs. The details are on our security page.
                </p>
              </div>
            </div>
          </div>
          <p className="mt-5 text-[14px] text-[color:var(--ink-70)]">
            Read the full{" "}
            <Link
              href="/legal/privacy"
              className="font-medium text-[color:var(--petrol)] underline-offset-2 hover:underline"
            >
              privacy policy
            </Link>{" "}
            and{" "}
            <Link
              href="/security"
              className="font-medium text-[color:var(--petrol)] underline-offset-2 hover:underline"
            >
              security page
            </Link>
            .
          </p>
        </div>
      </Section>

      {/* Section 5, enable US texting later + USD pricing head-on. */}
      <FeatureSection
        eyebrow="Texting the US later"
        heading="Want to text US customers too? Turn it on any time."
        visual={
          <figure className="mx-auto max-w-md overflow-hidden rounded-2xl border border-[color:var(--hairline)] bg-[color:var(--paper-2)] shadow-[0_24px_64px_-32px_rgba(11,79,73,0.25)]">
            <Photo
              id="owner-counter-phone"
              sizes="(min-width: 1024px) 28rem, 100vw"
              imgClassName="aspect-[4/3] object-cover"
            />
            <figcaption className="border-t border-[color:var(--hairline)] px-5 py-4 text-center text-[13px] leading-relaxed text-[color:var(--ink-70)]">
              Cross-border customers or a second location stateside? Flip on US
              texting when you&apos;re ready, everything you built stays put.
            </figcaption>
          </figure>
        }
        flip
      >
        <p>
          Plenty of Canadian shops have customers, suppliers, or a second
          location across the border. When you&apos;re ready, enable US texting
          from your settings: that&apos;s when the one-time $29 registration fee
          applies and the roughly-one-week carrier approval kicks in, the same
          honest wait American shops have. Until you enable it, you never pay the
          fee and never wait; everything you&apos;ve built stays exactly as it
          is.
        </p>
        <p>
          One thing we&apos;ll say straight: pricing is in{" "}
          <strong>USD</strong> for now, your card is charged in US dollars and
          your bank converts it. CAD billing is coming, and until it&apos;s real
          we won&apos;t pretend otherwise. Everything else, the flat $29, the
          shared inbox, the instant Canadian texting, is exactly what an
          American shop gets, minus the registration wait.
        </p>
      </FeatureSection>

      {/* Instant-vs-wait callout. Canada's day-one advantage, as a small object. */}
      <Section>
        <div className="mx-auto max-w-4xl">
          <div className="grid gap-4 sm:grid-cols-2">
            <Reveal>
              <div className="h-full rounded-2xl border border-[color:var(--petrol)]/30 bg-[color:var(--petrol-12)] p-6">
                <span className="flex size-10 items-center justify-center rounded-full bg-[color:var(--petrol)]/15 text-[color:var(--petrol)]">
                  <Zap className="size-5" strokeWidth={1.75} aria-hidden />
                </span>
                <h3 className="mt-4 text-[17px] font-semibold text-[color:var(--ink)]">
                  Canada to Canada
                </h3>
                <p className="mt-1.5 text-[15px] leading-relaxed text-[color:var(--ink-70)]">
                  Live and texting the same day. No registration, no fee, no
                  wait. Receiving works the moment your number is ready.
                </p>
              </div>
            </Reveal>
            <Reveal delay={60}>
              <div className="h-full rounded-2xl border border-[color:var(--hairline)] bg-[color:var(--paper-2)] p-6">
                <span className="flex size-10 items-center justify-center rounded-full bg-[color:var(--marker-40)] text-[color:var(--ink)]">
                  <MapPin className="size-5" strokeWidth={1.75} aria-hidden />
                </span>
                <h3 className="mt-4 text-[17px] font-semibold text-[color:var(--ink)]">
                  Canada to US (optional, later)
                </h3>
                <p className="mt-1.5 text-[15px] leading-relaxed text-[color:var(--ink-70)]">
                  Enable it any time. A one-time $29 registration and about a
                  week of carrier approval apply then, the same honest wait US
                  shops have.
                </p>
              </div>
            </Reveal>
          </div>
        </div>
      </Section>

      {/* Mini-pricing. */}
      <MiniPricing
        body={
          <>
            <p>
              Same flat price as everyone: $29/mo on Starter (up to 3 people, one
              local number), $79/mo on Pro (up to 10 people, two numbers).
              Receiving texts is always free and unlimited, and it&apos;s month to
              month with a 30-day money-back guarantee.
            </p>
            <p>
              A Canadian business texting Canadian customers pays no registration
              fee and waits for nothing, the $29 one-time fee and the
              about-a-week approval only ever apply if you choose to enable US
              texting later. Pricing is in USD for now.
            </p>
          </>
        }
      />

      {/* Internal links. Canada leads into trades + the features it relies on. */}
      <RelatedLinks
        heading="A shared inbox for Canadian crews"
        intro="Instant Canadian texting is the headline; the shared inbox, the numbers, and the compliance handling are what you use every day. Here's where they land for a few trades."
        links={[
          {
            label: "Your business number",
            href: "/features/business-number",
            hint: "Local Canadian numbers in every province, from the same real numbering data.",
          },
          {
            label: "Compliance built in",
            href: "/features/compliance",
            hint: "Consent and opt-outs handled, the CASL mechanics, in depth.",
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

      {/* Canada FAQ (5), unique to /canada (§7). */}
      <FeatureFaq
        heading="Canada questions, straight answers."
        faqs={[
          {
            q: "Can I really text customers the same day I sign up?",
            a: "Yes, if you're a Canadian business texting Canadian customers. The US carrier registration that makes American shops wait about a week doesn't apply to Canada-to-Canada texting, so your number can send as soon as it's active, usually a minute or two after you subscribe.",
          },
          {
            q: "Do I get a real Canadian number?",
            a: "Yes, a local number in the area code you choose, available across every province. Type your city in the picker on this page and you'll see the exact area code you'd get, from the same numbering data the app uses.",
          },
          {
            q: "Does Loonext make me CASL-compliant?",
            a: "It helps you follow CASL, that's the honest phrasing. Loonext records consent and enforces opt-outs, which are the mechanics CASL cares about. Staying compliant also depends on you only texting people who agreed to hear from you, which is on you, not the tool.",
          },
          {
            q: "Where is my data stored?",
            a: "In the United States, our database and file storage are in AWS us-east-1. We state this plainly and disclose the cross-border transfer in our privacy policy, the way PIPEDA and Quebec's Law 25 expect. Message content is also kept out of our analytics and error logs.",
          },
          {
            q: "I bill in Canada, can I pay in Canadian dollars?",
            a: "Not yet. Prices are in USD for now, so your card is charged in US dollars and your bank handles the conversion. CAD billing is on the way, and we'd rather tell you that plainly than surprise you at checkout.",
          },
        ]}
      />

      <FeatureCta
        heading="Text your Canadian customers today."
        sub="Pick a local number, invite the crew, and start texting the same afternoon, no registration wait, no sales call. Month to month, with a 30-day money-back guarantee."
      />
    </>
  );
}
