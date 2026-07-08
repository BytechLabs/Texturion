import type { Metadata } from "next";

import {
  LegalLink,
  LegalPage,
  LegalSectionBlock,
} from "@/components/marketing/legal/legal-page";
import { SUPPORT_EMAIL } from "@/lib/marketing/business";
import { buildMetadata } from "@/lib/marketing/seo";

const PATH = "/legal/aup";
const LAST_UPDATED = "July 2, 2026";

export const metadata: Metadata = buildMetadata({
  title: "Acceptable use policy",
  description:
    "The rules for texting on Loonext: consent required, no purchased or harvested lists, no SHAFT content, immediate opt-out. At least as strict as our carrier's, because those rules flow down to you.",
  path: PATH,
});

const sections = [
  { id: "why", number: "1", heading: "Why this exists" },
  { id: "consent", number: "2", heading: "Consent is required" },
  { id: "no-lists", number: "3", heading: "No purchased or harvested lists" },
  { id: "shaft", number: "4", heading: "Prohibited content (SHAFT and more)" },
  { id: "opt-out", number: "5", heading: "Opt-out is immediate" },
  { id: "identification", number: "6", heading: "Identify yourself" },
  { id: "no-abuse", number: "7", heading: "No abuse of the network" },
  { id: "enforcement", number: "8", heading: "Enforcement" },
  { id: "contact", number: "9", heading: "Contact" },
];

export default function AupPage() {
  return (
    <LegalPage
      title="Acceptable use policy"
      summary="Text only people who have agreed to hear from you. No purchased or harvested lists, no SHAFT content (sex, hate, alcohol, firearms, tobacco), and every opt-out is honored immediately. These rules are at least as strict as the carrier obligations that flow down to us, and breaking them can end your account, because one bad sender hurts delivery for every business on the network."
      lastUpdated={LAST_UPDATED}
      breadcrumbLabel="Acceptable use"
      path={PATH}
      sections={sections}
    >
      <LegalSectionBlock id="why" number="1" heading="Why this exists">
        <p>
          When you text through Loonext, you text through the phone companies and
          carriers we rely on. Their rules pass through to you, and breaking them
          hurts delivery for everyone. You accept this policy when you sign up
          (there&apos;s a checkbox), and it is part of our{" "}
          <LegalLink href="/legal/terms">terms of service</LegalLink>.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="consent" number="2" heading="Consent is required">
        <p>
          Only text people who have agreed to hear from you, because they texted
          you first, or asked you in person or by phone to text them. Consent
          cannot be bought, sold, rented, or transferred from one business to
          another. If you didn&apos;t get the consent yourself, you don&apos;t
          have it.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock
        id="no-lists"
        number="3"
        heading="No purchased or harvested lists"
      >
        <p>
          You may not upload or text numbers from purchased, rented, scraped, or
          otherwise harvested lists. Importing your own customers whom you have
          consent to text is fine; importing a list you bought is not. This ban
          is explicit and non-negotiable.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock
        id="shaft"
        number="4"
        heading="Prohibited content (SHAFT and more)"
      >
        <p>
          You may not use Loonext to send content related to{" "}
          <strong>SHAFT</strong>, sex, hate, alcohol, firearms, or tobacco
          (including cannabis and vaping), or any of the following:
        </p>
        <ul className="list-disc space-y-2 pl-6">
          <li>High-risk financial offers, payday or short-term loans, debt relief</li>
          <li>Illegal products or services, or content promoting illegal activity</li>
          <li>Deceptive, fraudulent, phishing, or &quot;get rich quick&quot; messaging</li>
          <li>Gambling where prohibited, and prescription-drug marketing</li>
          <li>Malware, or links intended to deceive or harm the recipient</li>
          <li>Harassment, threats, or hateful content toward any person or group</li>
        </ul>
        <p>
          Loonext is a conversational customer-service inbox for service
          businesses. It is not a platform for bulk marketing blasts, and we
          don&apos;t offer those tools.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="opt-out" number="5" heading="Opt-out is immediate">
        <p>
          Every recipient can opt out at any time by replying STOP (or a similar
          keyword). Loonext records the opt-out and blocks any further sends to
          that number until the person opts back in. You may not try to evade
          opt-outs, no texting from a second number, no &quot;are you sure&quot;
          follow-ups, no re-adding an opted-out contact.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock
        id="identification"
        number="6"
        heading="Identify yourself"
      >
        <p>
          Your business must be identifiable in your messages. When you start a
          conversation with a new contact, include your business name so the
          recipient knows who is texting them. Don&apos;t hide or obscure your
          identity, and don&apos;t impersonate another business or person.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock
        id="no-abuse"
        number="7"
        heading="No abuse of the network"
      >
        <p>
          Don&apos;t attempt to send spam, don&apos;t try to route around our
          rate limits or spending caps, and don&apos;t use Loonext to text
          destinations outside the United States and Canada. We enforce
          per-account rate limits and destination restrictions to protect the
          network; working around them is a violation.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="enforcement" number="8" heading="Enforcement">
        <p>
          We may investigate suspected violations and may suspend or terminate an
          account, with or without notice, depending on the severity, to protect
          recipients, the network, and our carrier standing. Serious or repeated
          violations end in termination without a refund of usage already
          incurred.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="contact" number="9" heading="Contact">
        <p>
          Not sure whether something is allowed? Ask first:{" "}
          <LegalLink href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</LegalLink>.
          To report abuse of a Loonext number, email the same address.
        </p>
      </LegalSectionBlock>
    </LegalPage>
  );
}
