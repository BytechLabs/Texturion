/**
 * /features/compliance, on the v4 "FIRST RESPONSE" FEATURE template
 * (DESIGN-DIRECTION v4 §6, COPY-DECK v2).
 *
 * Dateline `STOP MEANS STOP · INSTANTLY` → H1 "Texting rules are real. We
 * deal with them so you don't have to." → the real registration stepper in
 * its "In review" state in a Panel Frame → the four proof points from the
 * deck expanded (registration filed for you; STOP means stop; consent on
 * the record; opt-outs honored however they're said) plus the late-night
 * send check → Truth Strip → pricing snippet → unique FAQ → Frost CTA band.
 *
 * The honest 10DLC countdown story stays: "3 to 7 business days", stated up
 * front. Loonext HELPS you follow TCPA and CASL; it never claims to make
 * you compliant, and it never alters or appends to message content.
 */

import type { Metadata } from "next";

import { JsonLd } from "@/components/marketing/ui/json-ld";
import { PanelFrame } from "@/components/marketing/fr";
import {
  FeatureCta,
  FeatureFaq,
  FeatureHero,
  FeatureSection,
  PlainDetails,
  PricingSnippet,
  RelatedLinks,
  TruthStripSection,
} from "@/components/marketing/features/feature-page";
import { ConsentVisual } from "@/components/marketing/features/consent-visual";
import { OptOutVisual } from "@/components/marketing/features/opt-out-visual";
import { QuietHoursVisual } from "@/components/marketing/features/quiet-hours-visual";
import { RegistrationStepperVisual } from "@/components/marketing/features/registration-stepper-visual";
import { breadcrumbJsonLd, buildMetadata } from "@/lib/marketing/seo";

const PATH = "/features/compliance";

export const metadata: Metadata = buildMetadata({
  title: "Compliance built in: registration, opt-outs, consent",
  description:
    "We register your business with the US phone companies at signup, honor STOP instantly, and record consent with a name and a date. Helps you follow TCPA and CASL.",
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
        dateline="STOP MEANS STOP · INSTANTLY"
        title="Texting rules are real. We deal with them so you don't have to."
        sub="Business texting in the US and Canada comes with real rules: registering with the phone companies, honoring opt-outs, recording consent. Most tools hand you a homework packet. Loonext files the paperwork, enforces the opt-outs, and keeps the records, so you can get back to the job."
        panel={
          <PanelFrame
            chromeUrl="loonext.com/settings"
            chip="scripted-demo"
            caption="The registration tracker, three days in: filed, in review, nothing for you to do."
            ariaLabel="The Loonext registration tracker showing a filing in carrier review"
          >
            <RegistrationStepperVisual />
          </PanelFrame>
        }
      />

      <FeatureSection
        ground="frost"
        eyebrow="Registration, filed for you"
        heading="The carrier registration, without the homework."
      >
        <p>
          In the US, the phone companies require every business that texts to
          register first. It&apos;s called 10DLC, and it&apos;s an industry
          rule, not a Loonext rule. Done yourself, it means brand and campaign
          forms, carrier vetting, and a resubmission if anything bounces. On
          Loonext you answer a few plain questions at signup, your legal name,
          address, and EIN, and we file the whole thing the minute you pay,
          follow it through review, and resubmit if it comes back.
        </p>
        <p>
          Here&apos;s the part to know up front, not buried in a footnote:
          approval typically takes 3 to 7 business days, about a week. That
          wait is the carriers&apos;, not ours, and every provider has it. You
          aren&apos;t idle while it happens: your number is live and receiving
          texts on day one, and a Canadian business texting Canadian customers
          can text right away with no registration wait at all. We email you
          the moment US texting turns on.
        </p>
      </FeatureSection>

      <FeatureSection
        eyebrow="Opt-outs"
        heading="STOP means stop, instantly."
        visual={
          <PanelFrame
            chip="scripted-demo"
            caption="A STOP arrives, and the composer is replaced by the block."
            ariaLabel="A conversation where a customer texted STOP and sends to them are blocked"
          >
            <OptOutVisual />
          </PanelFrame>
        }
        flip
      >
        <p>
          When a customer texts STOP, they&apos;re opted out on the spot, and
          Loonext blocks any future send to that number until they opt back
          in. There&apos;s no toggle to remember and no way to text them by
          accident afterward: a send to an opted-out number is rejected in the
          app before it ever reaches the carrier.
        </p>
        <p>
          The rules also count &quot;please stop texting me&quot; the same as
          STOP, so every conversation and contact has a mark-opted-out action
          for requests made in the customer&apos;s own words. One click marks
          them out, and Loonext blocks every send until they ask back in.
          Opt-outs and opt-ins are logged with who did it and when.
        </p>
      </FeatureSection>

      <FeatureSection
        ground="frost"
        eyebrow="Consent"
        heading="Consent, on the record."
        visual={
          <PanelFrame
            caption="The consent record on each contact: how it came to be, who recorded it, and when."
            ariaLabel="Two Loonext contacts showing their consent records"
          >
            <ConsentVisual />
          </PanelFrame>
        }
      >
        <p>
          Replying to a customer who texted you first is unrestricted: they
          started the conversation, and that consent is recorded automatically
          the moment their first text arrives. Starting a brand-new outbound
          conversation is the attestation that the customer asked you to text
          them, and Loonext stamps that record with your name and the date.
        </p>
        <p>
          The record lives on the contact: how the consent came to be, who
          recorded it, and when. If a question ever comes up later, the answer
          is a lookup, not a memory. What you write is never altered either:
          Loonext doesn&apos;t add anything to your messages, the guardrails
          act on the send, not the text.
        </p>
      </FeatureSection>

      <FeatureSection
        eyebrow="The late-night check"
        heading="A gentle check before a late-night first text."
        visual={
          <PanelFrame
            chip="scripted-demo"
            caption="Starting a conversation at 9:14 PM the customer's time: send, or wait for morning."
            ariaLabel="The Loonext late-night check asking whether to send a new conversation now or wait"
          >
            <QuietHoursVisual />
          </PanelFrame>
        }
        flip
      >
        <p>
          Start a new conversation late at night and we quietly ask first:
          &quot;It&apos;s 9:14 PM for this customer. Send anyway?&quot;
          You can send or wait. It&apos;s a nudge, not a hard block, and the
          customer&apos;s local time is worked out from their area code so you
          don&apos;t have to think about it.
        </p>
        <p>
          Replies to a customer who already texted you are never held up, at
          any hour. If someone messages you at 11pm with a burst pipe, you
          answer them without a dialog getting in the way.
        </p>
      </FeatureSection>

      <TruthStripSection
        heading="The careful version"
        items={[
          {
            text: "STOP, UNSUBSCRIBE, CANCEL, END, and QUIT are honored instantly, and blocked sends never reach the carrier.",
            good: true,
          },
          {
            text: "US texting turns on after carrier approval, typically 3 to 7 business days. Every provider has this wait.",
          },
          {
            text: "Loonext helps you follow TCPA and CASL. Staying inside the law also depends on you only texting people who agreed to hear from you.",
          },
        ]}
      />

      <PlainDetails
        heading="What we claim, precisely"
        lead="Compliance copy is where it's easy to overpromise, so here is the careful version of what Loonext does and doesn't do."
        items={[
          {
            term: "We help you follow the rules. We don't make you 'compliant'.",
            detail:
              "Loonext handles the mechanics: registration, opt-out enforcement, consent records. Following the law (TCPA in the US, CASL in Canada) also depends on how you use it. We give you the tools and the guardrails; the accurate word is 'helps'.",
          },
          {
            term: "Your messages are never altered.",
            detail:
              "What you write is exactly what your customer receives. Loonext doesn't append anything to your texts; the guardrails act on the send instead: blocked sends to opted-out numbers, the consent record when a conversation starts, the late-night check.",
          },
          {
            term: "No blast tools, on purpose.",
            detail:
              "There's no bulk-send or purchased-list feature. Consent can't be bought or transferred, and importing a purchased, rented, or scraped list violates our acceptable use policy. The product steers you away from what breaks the rules.",
          },
          {
            term: "The late-night check is a nudge, not a lock.",
            detail:
              "It fires only when you start a new conversation between 8pm and 8am in the customer's local time, and you can always choose to send. Replies to existing conversations are never delayed.",
          },
        ]}
      />

      <PricingSnippet>
        <p>
          Compliance handling is part of every plan. There&apos;s no separate
          carrier or compliance line item on your bill, ever: the recurring
          carrier campaign fees are absorbed into the flat $29 or $79.
        </p>
        <p>
          The one exception for US shops is the one-time $29 to register your
          business with the phone companies, charged once, ever, so the first
          month is $58 and every month after is $29. Canadian businesses that
          don&apos;t text US numbers never pay it and never wait for approval.
        </p>
      </PricingSnippet>

      <RelatedLinks
        heading="The rules, in plain language"
        intro="Compliance touches everything you send, so it's worth reading the policies plainly, and seeing how the handling plays out where you work."
        links={[
          {
            label: "Acceptable use policy",
            href: "/legal/aup",
            hint: "Opt-in and opt-out in plain language, the consent rule, and the purchased-list ban.",
          },
          {
            label: "SMS messaging policy",
            href: "/legal/messaging",
            hint: "The STOP and consent policy language, in full.",
          },
          {
            label: "Loonext in Canada",
            href: "/canada",
            hint: "Canadian crews text day one: the registration wait doesn't apply.",
          },
          {
            label: "Loonext vs Podium",
            href: "/compare/podium",
            hint: "Compliance handled without a sales call or an annual contract.",
          },
        ]}
      />

      <FeatureFaq
        heading="Compliance questions, straight answers."
        faqs={[
          {
            q: "What is 10DLC, and do I really have to register?",
            a: "10DLC is the US system for registering the local numbers that businesses use to text. Registration is required by the phone companies for every business that texts US numbers; it's not optional and it's not specific to Loonext. The difference is that we file it for you and carry it through approval, instead of handing you the forms.",
          },
          {
            q: "Why does US texting take about a week to turn on?",
            a: "The carriers review and approve every business before it can text US numbers, and that review typically takes 3 to 7 business days. We submit yours the minute you pay and email you the moment it's approved. Throughout the wait, receiving texts already works, and Canadian texting works immediately.",
          },
          {
            q: "What happens when a customer replies STOP?",
            a: "They're opted out instantly, and Loonext blocks any further texts to that number until they opt back in. A send to an opted-out number is rejected in the app before it reaches the carrier, so there's no accidental message. A teammate can also mark someone opted out when they ask to stop in their own words.",
          },
          {
            q: "How is consent recorded?",
            a: "Customers who text you first are recorded as having consented automatically, the moment their first text arrives. When you start a new conversation, that send is your confirmation the customer asked to hear from you, and Loonext stamps the consent record with your name and the date. The record lives on the contact, so the answer to 'did they agree?' is a lookup, not a memory.",
          },
          {
            q: "Does Loonext add anything to my messages?",
            a: "No. What you write is exactly what your customer receives. The guardrails act on the send instead of the text: a send to an opted-out number is rejected, starting a conversation writes the consent record, and a late-night first text gets the quiet check.",
          },
          {
            q: "Are you saying Loonext makes me legally compliant?",
            a: "No. We say it helps you follow the rules, and we mean the difference. Loonext handles registration, opt-outs, and consent records, but staying within TCPA and CASL also depends on you only texting people who agreed to hear from you. We give you the tooling and the guardrails; we don't claim to absolve you of the rules.",
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
