/**
 * /canada — the Canada-first story (BLUEPRINT §2, §7). Targets "business
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
import {
  ArrowRight,
  Check,
  Database,
  Leaf,
  MapPin,
  ShieldCheck,
  Zap,
} from "lucide-react";
import type { Metadata } from "next";

import { Button } from "@/components/ui/button";
import { Container } from "@/components/marketing/ui/container";
import { GlowBackdrop } from "@/components/marketing/ui/glow-backdrop";
import { JsonLd } from "@/components/marketing/ui/json-ld";
import { Reveal } from "@/components/marketing/ui/reveal";
import { Section } from "@/components/marketing/ui/section";
import { CityAreaCodeWidget } from "@/components/marketing/interactive/city-area-code-widget";
import { NumberCardsVisual } from "@/components/marketing/features/number-cards-visual";
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
  title: "Business texting in Canada — text customers the same day",
  description:
    "Canadian crews text their customers the day they sign up — no US carrier registration to wait on. Local numbers in every province, CASL-aware consent and identification, and plain-English data disclosure. Flat $29/mo for the whole team.",
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

      {/* Hero — the Canada-first claim nobody else in the market makes (§7). */}
      <section className="relative overflow-hidden pb-8 pt-24 sm:pt-28">
        <GlowBackdrop />
        <Container>
          <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-16">
            <div>
              <p className="flex items-center gap-1.5 text-[13px] font-semibold text-primary">
                <Leaf className="size-4" strokeWidth={1.75} aria-hidden />
                Made in Canada, for Canadian crews
              </p>
              <h1 className="display-hero mt-4 text-balance text-foreground">
                Canadian crews text their customers the same day they sign up.
              </h1>
              <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground">
                The US carrier registration that makes American shops wait about
                a week doesn&apos;t apply to a Canadian business texting Canadian
                customers. So on JobText, you pick a local number, invite the
                crew, and start texting — today. One shared inbox, one flat price:
                $29 a month for the whole team.
              </p>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
                <Button asChild size="lg">
                  <Link href="/signup">
                    Get your number
                    <ArrowRight strokeWidth={1.75} aria-hidden />
                  </Link>
                </Button>
                <Button asChild size="lg" variant="outline">
                  <Link href="/pricing">See pricing</Link>
                </Button>
              </div>

              <ul className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-[13px] text-muted-foreground">
                {[
                  "Texting works day one",
                  "Local numbers, every province",
                  "CASL-aware from the first text",
                ].map((chip) => (
                  <li key={chip} className="flex items-center gap-1.5">
                    <Check
                      className="size-3.5 shrink-0 text-primary"
                      strokeWidth={2}
                      aria-hidden
                    />
                    {chip}
                  </li>
                ))}
              </ul>
            </div>

            <div className="relative">
              <NumberCardsVisual />
            </div>
          </div>
        </Container>
      </section>

      {/* Section 1 — instant activation, explained plainly (no 10DLC jargon). */}
      <FeatureSection
        eyebrow="Instant activation"
        heading="No registration wait. Just text."
        wash
      >
        <p>
          Here&apos;s the whole reason Canadian crews are texting on day one, in
          one plain sentence: the phone-company registration that US texting
          requires — the thing that adds about a week for American shops —
          simply isn&apos;t required for a Canadian business texting Canadian
          customers. There&apos;s no brand-and-campaign approval to sit through,
          no carrier review, no &ldquo;activates in 3–7 business days&rdquo;
          banner. Your number is live, and it can send.
        </p>
        <p>
          That&apos;s not a workaround or a trial mode — it&apos;s how the rules
          actually work north of the border, and JobText is built to take
          advantage of it. Pick your number, add your crew, put &ldquo;call or
          text&rdquo; on your trucks, and you&apos;re in business the same
          afternoon.
        </p>
      </FeatureSection>

      {/* Section 2 — local numbers in every province (the widget as visual). */}
      <FeatureSection
        eyebrow="Local numbers"
        heading="A local number, in every province."
        visual={<CityAreaCodeWidget />}
        flip
      >
        <p>
          Type your city and JobText finds you a matching local number — a (416)
          or (647) in Toronto, a (604) in Vancouver, a (403) in Calgary, a (902)
          in Halifax. The picker uses the same real numbering data the app uses
          to choose your number, so a customer in your city sees a number that
          looks like it&apos;s from their city.
        </p>
        <p>
          Local numbers are available across every province, so wherever your
          crew works, the number your customers text looks like it belongs there
          — because it does.
        </p>
      </FeatureSection>

      {/* Section 3 — CASL-aware features (helps you follow CASL, never claims). */}
      <FeatureSection
        eyebrow="CASL-aware"
        heading="Built to help you follow CASL — not to promise you're covered."
        wash
      >
        <p>
          CASL is Canada&apos;s anti-spam law, and JobText is built with it in
          mind. Consent is recorded when you start a conversation — one checkbox
          confirming the customer asked you to text them, saved with a name and a
          date. Your first text to a new contact automatically ends with your
          business name and a &ldquo;Reply STOP to opt out&rdquo; line, which is
          the sender identification CASL expects. And when a customer texts STOP,
          they&apos;re opted out instantly, with any future send to that number
          blocked.
        </p>
        <p>
          We&apos;re careful with the words here: JobText <em>helps you follow</em>{" "}
          CASL — it doesn&apos;t make you &ldquo;CASL-compliant,&rdquo; because
          staying within the law also depends on you only texting people who
          actually agreed to hear from you. We give you the consent records, the
          identification, and the opt-out enforcement; you bring the honest list.
        </p>
      </FeatureSection>

      {/* Section 4 — honest data residency (stated, not buried) — §7. */}
      <Section>
        <div className="mx-auto max-w-3xl">
          <p className="text-[13px] font-semibold text-primary">
            Where your data lives
          </p>
          <h2 className="display-h2 mt-2 text-foreground">
            Plain about your data — including that it&apos;s processed in the US.
          </h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            <div className="flex gap-3 rounded-[10px] border border-border bg-card p-5">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Database className="size-5" strokeWidth={1.75} aria-hidden />
              </span>
              <div>
                <h3 className="text-[15px] font-semibold text-foreground">
                  Processed in the United States
                </h3>
                <p className="mt-1.5 text-[14px] leading-relaxed text-muted-foreground">
                  Your data is stored and processed in the US (our database is in
                  AWS us-east-1). We state this plainly rather than bury it — and
                  our privacy policy discloses the cross-border transfer the way
                  PIPEDA and Quebec&apos;s Law 25 expect.
                </p>
              </div>
            </div>
            <div className="flex gap-3 rounded-[10px] border border-border bg-card p-5">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <ShieldCheck className="size-5" strokeWidth={1.75} aria-hidden />
              </span>
              <div>
                <h3 className="text-[15px] font-semibold text-foreground">
                  Message content stays private
                </h3>
                <p className="mt-1.5 text-[14px] leading-relaxed text-muted-foreground">
                  Your customers&apos; numbers and consent data are never sold or
                  shared for marketing, and message content is kept out of our
                  analytics and error logs. The details are on our security page.
                </p>
              </div>
            </div>
          </div>
          <p className="mt-5 text-[14px] text-muted-foreground">
            Read the full{" "}
            <Link
              href="/legal/privacy"
              className="font-medium text-primary underline-offset-2 hover:underline"
            >
              privacy policy
            </Link>{" "}
            and{" "}
            <Link
              href="/security"
              className="font-medium text-primary underline-offset-2 hover:underline"
            >
              security page
            </Link>
            .
          </p>
        </div>
      </Section>

      {/* Section 5 — enable US texting later + USD pricing head-on. */}
      <FeatureSection
        eyebrow="Texting the US later"
        heading="Want to text US customers too? Turn it on any time."
        flip
      >
        <p>
          Plenty of Canadian shops have customers, suppliers, or a second
          location across the border. When you&apos;re ready, enable US texting
          from your settings: that&apos;s when the one-time $29 registration fee
          applies and the roughly-one-week carrier approval kicks in — the same
          honest wait American shops have. Until you enable it, you never pay the
          fee and never wait; everything you&apos;ve built stays exactly as it
          is.
        </p>
        <p>
          One thing we&apos;ll say straight: pricing is in{" "}
          <strong>USD</strong> for now — your card is charged in US dollars and
          your bank converts it. CAD billing is coming, and until it&apos;s real
          we won&apos;t pretend otherwise. Everything else — the flat $29, the
          shared inbox, the instant Canadian texting — is exactly what an
          American shop gets, minus the registration wait.
        </p>
      </FeatureSection>

      {/* Instant-vs-wait callout — Canada's day-one advantage, as a small object. */}
      <Section>
        <div className="mx-auto max-w-4xl">
          <div className="grid gap-4 sm:grid-cols-2">
            <Reveal>
              <div className="h-full rounded-2xl border border-primary/30 bg-primary/5 p-6">
                <span className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Zap className="size-5" strokeWidth={1.75} aria-hidden />
                </span>
                <h3 className="mt-4 text-[17px] font-semibold text-foreground">
                  Canada → Canada
                </h3>
                <p className="mt-1.5 text-[15px] leading-relaxed text-muted-foreground">
                  Live and texting the same day. No registration, no fee, no
                  wait. Receiving works the moment your number is ready.
                </p>
              </div>
            </Reveal>
            <Reveal delay={60}>
              <div className="h-full rounded-2xl border border-amber-300/70 bg-amber-50/50 p-6 dark:border-amber-700/40 dark:bg-amber-950/20">
                <span className="flex size-10 items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-warning">
                  <MapPin className="size-5" strokeWidth={1.75} aria-hidden />
                </span>
                <h3 className="mt-4 text-[17px] font-semibold text-foreground">
                  Canada → US (optional, later)
                </h3>
                <p className="mt-1.5 text-[15px] leading-relaxed text-muted-foreground">
                  Enable it any time. A one-time $29 registration and about a
                  week of carrier approval apply then — the same honest wait US
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
              fee and waits for nothing — the $29 one-time fee and the
              about-a-week approval only ever apply if you choose to enable US
              texting later. Pricing is in USD for now.
            </p>
          </>
        }
      />

      {/* Internal links — Canada leads into trades + the features it relies on. */}
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
            hint: "Consent, opt-outs, and identification handled — the CASL mechanics, in depth.",
          },
          {
            label: "Texting for cleaners",
            href: "/for/cleaners",
            hint: "Recurring confirmations and reschedules, for Canadian cleaning crews.",
          },
          {
            label: "Texting for landscapers",
            href: "/for/landscapers",
            hint: "Seasonal quote volume across sites — texting the same day you sign up.",
          },
        ]}
      />

      {/* Canada FAQ (5) — unique to /canada (§7). */}
      <FeatureFaq
        heading="Canada questions, straight answers."
        faqs={[
          {
            q: "Can I really text customers the same day I sign up?",
            a: "Yes, if you're a Canadian business texting Canadian customers. The US carrier registration that makes American shops wait about a week doesn't apply to Canada-to-Canada texting, so your number can send as soon as it's active — usually a minute or two after you subscribe.",
          },
          {
            q: "Do I get a real Canadian number?",
            a: "Yes — a local number in the area code you choose, available across every province. Type your city in the picker on this page and you'll see the exact area code you'd get, from the same numbering data the app uses.",
          },
          {
            q: "Does JobText make me CASL-compliant?",
            a: "It helps you follow CASL — that's the honest phrasing. JobText records consent, adds your business identification to first messages, and enforces opt-outs, which are the mechanics CASL cares about. Staying compliant also depends on you only texting people who agreed to hear from you, which is on you, not the tool.",
          },
          {
            q: "Where is my data stored?",
            a: "In the United States — our database and file storage are in AWS us-east-1. We state this plainly and disclose the cross-border transfer in our privacy policy, the way PIPEDA and Quebec's Law 25 expect. Message content is also kept out of our analytics and error logs.",
          },
          {
            q: "I bill in Canada — can I pay in Canadian dollars?",
            a: "Not yet. Prices are in USD for now, so your card is charged in US dollars and your bank handles the conversion. CAD billing is on the way, and we'd rather tell you that plainly than surprise you at checkout.",
          },
        ]}
      />

      <FeatureCta
        heading="Text your Canadian customers today."
        sub="Pick a local number, invite the crew, and start texting the same afternoon — no registration wait, no sales call. Month to month, with a 30-day money-back guarantee."
      />
    </>
  );
}
