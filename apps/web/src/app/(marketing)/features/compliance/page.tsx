/**
 * /features/compliance, "we handle the carrier paperwork" (BLUEPRINT §2, §4,
 * §3.10 at full depth). Targets "10dlc registration for small business" and
 * "business texting compliance".
 *
 * Everything here traces to SPEC §4 (registration state machine, checkout copy)
 * and §5 (opt-out model, consent attestation, quiet hours, records retention).
 * Framed as a BENEFIT and stated honestly: the US 3–7 business-day wait is a
 * feature, Canada is instant, STOP is handled automatically, quiet-hours only
 * fires when you START a late-night conversation (never on replies). Loonext
 * does NOT alter or append to message content, never claim it does. NEVER
 * "makes you compliant", "helps you follow the rules." Links /legal/aup +
 * /legal/privacy. buildMetadata + BreadcrumbList JSON-LD; NO FAQPage (§11.2).
 */

import {
  BellOff,
  FileCheck2,
  MessageSquareOff,
  Moon,
  UserCheck,
  UserX,
} from "lucide-react";
import type { Metadata } from "next";

import { JsonLd } from "@/components/marketing/ui/json-ld";
import {
  FeatureCta,
  FeatureFaq,
  FeatureHero,
  FeatureSection,
  FeatureStrip,
  HonestDetails,
  MiniPricing,
  RelatedLinks,
} from "@/components/marketing/features/feature-page";
import { Display } from "@/components/marketing/display";
import { RegistrationStepperVisual } from "@/components/marketing/features/registration-stepper-visual";
import { ConsentVisual } from "@/components/marketing/features/consent-visual";
import { OptOutVisual } from "@/components/marketing/features/opt-out-visual";
import { QuietHoursVisual } from "@/components/marketing/features/quiet-hours-visual";
import { FirstWeekTimeline } from "@/components/marketing/home/first-week-timeline";
import { breadcrumbJsonLd, buildMetadata } from "@/lib/marketing/seo";

const PATH = "/features/compliance";

export const metadata: Metadata = buildMetadata({
  title: "Compliance built in, we handle the carrier paperwork",
  description:
    "10DLC registration, opt-outs, and consent records handled for you. STOP is honored automatically. Helps you follow TCPA and CASL. Flat $29/mo.",
  path: PATH,
});

export default function CompliancePage() {
  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Home", path: "/" },
          { name: "Compliance built in", path: PATH },
        ])}
      />

      <FeatureHero
        eyebrow="Compliance built in"
        title={
          <>
            We handle the carrier paperwork, so the rules stay{" "}
            <Display.Mark>handled</Display.Mark>.
          </>
        }
        sub="Business texting in the US and Canada comes with real rules, registering with the phone companies, honoring opt-outs, recording consent. Most tools hand you a homework packet. Loonext files the paperwork, enforces the opt-outs, and keeps the records, so you can get back to the job."
        truthChips={[
          "10DLC registration, filed for you",
          "STOP honored automatically",
          "Helps you follow TCPA & CASL",
        ]}
        visual={<RegistrationStepperVisual />}
      />

      {/* Section 1, registration explained as a benefit + honest timeline. */}
      <FeatureSection
        eyebrow="Registration, filed for you"
        heading="The 10DLC registration, without the 10DLC headache."
        visual={
          <div className="mx-auto max-w-md">
            {/* The first-week timeline renders its own card (border/bg/padding);
                the caption sits below it. */}
            <FirstWeekTimeline />
            <p className="mt-6 text-center text-[13px] leading-relaxed text-[color:var(--ink-70)]">
              Live on day zero. US texting turns on after a roughly one-week
              carrier review, we file it the minute you pay.
            </p>
          </div>
        }
        wash
      >
        <p>
          In the US, the phone companies require every business that texts to
          register first, it&apos;s called 10DLC, and it&apos;s an industry
          rule, not a Loonext rule. Done yourself, it means brand and campaign
          forms, carrier vetting, and a resubmission if anything bounces. On
          Loonext you answer a few plain questions at signup, your legal name,
          address, and EIN, and we file the whole thing for you the minute you
          pay, follow it through review, and resubmit if it comes back.
        </p>
        <p>
          Here&apos;s the honest part, stated up front rather than buried:
          approval typically takes <strong>3–7 business days</strong>, about a
          week. That wait is the carriers&apos;, not ours, and every provider has
          it. The good news is you&apos;re not idle while it happens: your number
          is live and receiving texts on day one, and if you&apos;re a Canadian
          business texting Canadian customers, you can text right away with no
          registration wait at all. We email you the moment US texting turns on.
        </p>
      </FeatureSection>

      {/* Section 2, opt-outs. */}
      <FeatureSection
        eyebrow="Opt-outs"
        heading="STOP means stop, automatically, and for good."
        visual={<OptOutVisual className="mx-auto max-w-md" />}
        flip
      >
        <p>
          When a customer texts STOP (or UNSUBSCRIBE, CANCEL, END, QUIT), Loonext
          opts them out on the spot and blocks any future send to that number
          until they opt back in. There&apos;s no toggle to remember and no way
          to text them by accident afterward, a send to an opted-out number is
          rejected before it ever leaves the app.
        </p>
        <p>
          Rules now expect you to honor <em>any</em> reasonable request to stop,
          not just the exact keyword, so every conversation and contact has a
          &ldquo;Mark opted out&rdquo; action a teammate can use when someone
          writes &ldquo;please stop texting me&rdquo; in their own words. Opt-outs
          and opt-ins are logged with who did it and when, and a customer who
          changes their mind can be marked opted back in. The point is simple:
          once someone&apos;s out, they stay out until they choose otherwise.
        </p>
      </FeatureSection>

      {/* Section 3, consent. */}
      <FeatureSection
        eyebrow="Consent"
        heading="Consent recorded, with a name and a date."
        visual={<ConsentVisual />}
        wash
      >
        <p>
          Replying to a customer who texted you first is unrestricted, they
          started the conversation. Starting a brand-new outbound conversation
          asks you one question: did this customer ask you to text them? Checking
          that box records the consent with your name and the date, which is
          exactly what makes the opt-in you declared to the carriers true. It&apos;s
          one tap, and it keeps you honest without a compliance binder.
        </p>
        <p>
          The record lives on the contact: how the consent came to be, who
          attested it, and when. Customers who text you first are recorded as
          having consented automatically, and opt-outs are stamped the same way.
          If a question ever comes up later, the answer is a lookup, not a
          memory.
        </p>
      </FeatureSection>

      {/* Section 4, quiet hours (scoped precisely to SPEC §5). */}
      <FeatureSection
        eyebrow="Quiet hours"
        heading="A gentle check before a late-night first text."
        visual={<QuietHoursVisual />}
        flip
      >
        <p>
          If you <em>start</em> a new conversation with someone between 8pm and
          8am in their local time, Loonext quietly checks first:
          &ldquo;It&apos;s 9:14pm where this customer is. Send anyway?&rdquo; You
          can send or wait, it&apos;s a nudge, not a hard block, and the time
          zone is inferred from the customer&apos;s area code so you don&apos;t
          have to think about it.
        </p>
        <p>
          Importantly, this only applies to <strong>starting</strong> a new
          late-night conversation. Replying to a customer who already texted you
          is never held up, at any hour, if someone messages you at 11pm with a
          burst pipe, you answer them without a dialog getting in the way.
        </p>
      </FeatureSection>

      {/* Feature strip. */}
      <FeatureStrip
        heading="Every rule, handled quietly in the background."
        items={[
          {
            icon: FileCheck2,
            title: "10DLC registration",
            body: "Brand and campaign filed for you at signup, followed through review, and resubmitted if it bounces.",
          },
          {
            icon: MessageSquareOff,
            title: "Opt-out enforcement",
            body: "STOP keywords honored instantly; sends to opted-out numbers are blocked before they leave the app.",
          },
          {
            icon: UserCheck,
            title: "Consent attestation",
            body: "Starting a new conversation records consent with a name and a date, so your declared opt-in is truthful.",
          },
          {
            icon: UserX,
            title: "Plain-language opt-outs",
            body: "A 'Mark opted out' action honors requests in the customer's own words, 'stop texting me' counts, keyword or not.",
          },
          {
            icon: Moon,
            title: "Quiet-hours nudge",
            body: "A soft confirm before starting a late-night conversation (8pm–8am local), never on replies.",
          },
          {
            icon: BellOff,
            title: "No blast tools, on purpose",
            body: "There's no bulk-send or purchased-list feature, the product itself steers you away from what breaks the rules.",
          },
        ]}
      />

      {/* Honest details, the precise scope (§4). */}
      <HonestDetails
        lead="Compliance copy is where it's easy to overpromise, so here's the careful version of what Loonext does and doesn't claim."
        items={[
          {
            term: "We help you follow the rules, we don't make you 'compliant.'",
            detail:
              "Loonext handles the mechanics: registration, opt-outs, consent records. Following the law (TCPA in the US, CASL in Canada) also depends on how you use it, you still have to only text people who agreed to hear from you. We give you the tools and the guardrails; the honest word is 'helps.'",
          },
          {
            term: "The US wait is the carriers', and it's real.",
            detail:
              "US texting turns on after 10DLC approval, typically 3–7 business days. We can't make the carriers move faster, and we won't pretend it's instant. What we do is file immediately, handle resubmissions, and keep you receiving texts (and texting Canada) the whole time.",
          },
          {
            term: "Quiet hours is a nudge, not a lock.",
            detail:
              "It fires only when you start a new conversation late at night, and you can always choose to send. Replies to existing conversations are never delayed. It's a courtesy check, not a send scheduler.",
          },
          {
            term: "Consent can't be bought or transferred.",
            detail:
              "You may only text people who gave you permission, because they texted you first, or asked you to. Purchased, rented, or scraped lists are banned outright, and importing one is a violation of our acceptable use policy.",
          },
        ]}
      />

      {/* Mini-pricing. */}
      <MiniPricing
        body={
          <>
            <p>
              Compliance handling is part of every plan, there&apos;s no
              separate &ldquo;compliance&rdquo; or &ldquo;carrier&rdquo; line
              item on your bill, ever. The recurring carrier campaign fees are
              absorbed into the flat $29 or $79.
            </p>
            <p>
              The one honest exception for US shops is a one-time $29 to register
              your business with the phone companies, charged once, ever, so the
              first month is $58 and every month after is $29. Canadian
              businesses that don&apos;t text US numbers never pay it and never
              wait for approval.
            </p>
          </>
        }
      />

      {/* Internal links, including the two legal pages (§4). */}
      <RelatedLinks
        heading="The rules, in your words and ours"
        intro="Compliance touches everything you send, so it's worth reading the policies plainly, and seeing how the handling plays out for a specific trade."
        links={[
          {
            label: "Acceptable use policy",
            href: "/legal/aup",
            hint: "How opt-in and opt-out work in plain language, the consent rule, the purchased-list ban, and what you can't send.",
          },
          {
            label: "Privacy policy",
            href: "/legal/privacy",
            hint: "What we collect, where your data is processed, and how consent records are kept.",
          },
          {
            label: "Texting for salons",
            href: "/for/salons",
            hint: "Confirmations and consult photos, with the rules handled for a front desk of one.",
          },
          {
            label: "Loonext vs Podium",
            href: "/compare/podium",
            hint: "Compliance handled without a sales call or an annual contract.",
          },
        ]}
      />

      {/* Page-specific FAQ, unique to compliance. */}
      <FeatureFaq
        heading="Compliance questions, straight answers."
        faqs={[
          {
            q: "What is 10DLC, and do I really have to register?",
            a: "10DLC is the US system for registering the local numbers that businesses use to text. Registration is required by the phone companies for every business that texts US numbers, it's not optional and it's not specific to Loonext. The difference is that we file it for you and carry it through approval, instead of handing you the forms.",
          },
          {
            q: "Why does US texting take about a week to turn on?",
            a: "The carriers review and approve every business before it can text US numbers, and that review typically takes 3–7 business days. We submit yours the minute you pay and email you the moment it's approved. Throughout the wait, receiving texts already works, and Canadian texting works immediately.",
          },
          {
            q: "What happens when a customer replies STOP?",
            a: "They're opted out instantly, and Loonext blocks any further texts to that number until they opt back in. A send to an opted-out number is rejected in the app before it reaches the carrier, so there's no accidental message. A teammate can also mark someone opted out manually if they ask to stop in their own words.",
          },
          {
            q: "How is consent recorded?",
            a: "Customers who text you first are recorded as having consented automatically. To start a new conversation with someone, you confirm they asked you to text them, one required checkbox, which records the consent with your name and the date. That record is what makes the opt-in you declared to the carriers accurate.",
          },
          {
            q: "Does Loonext add anything to my messages?",
            a: "No. What you write is exactly what your customer receives. The guardrails act on the send instead of the text: starting a new conversation requires the consent attestation, a send to an opted-out number is rejected, and a late-night first text gets the quiet-hours check.",
          },
          {
            q: "Are you saying Loonext makes me legally compliant?",
            a: "No, we say it helps you follow the rules, and we mean the difference. Loonext handles registration, opt-outs, and consent records, but staying within TCPA and CASL also depends on you only texting people who agreed to hear from you. We give you the tooling and the guardrails; we don't claim to absolve you of the rules.",
          },
        ]}
      />

      <FeatureCta
        heading="Let us handle the carrier paperwork."
        sub="Registration filed for you, opt-outs enforced, consent recorded, so you can text customers back without becoming a compliance department."
      />
    </>
  );
}
