import type { Metadata } from "next";

import {
  LegalLink,
  LegalPage,
  LegalSectionBlock,
} from "@/components/marketing/legal/legal-page";
import { SUPPORT_EMAIL } from "@/lib/marketing/business";
import { buildMetadata } from "@/lib/marketing/seo";

const PATH = "/legal/messaging";
const LAST_UPDATED = "July 3, 2026";

export const metadata: Metadata = buildMetadata({
  title: "SMS messaging policy",
  description:
    "The Loonext SMS program disclosures: how opt-in works, reply STOP to stop and HELP for help, message frequency varies, message and data rates may apply, and numbers are never sold or shared for marketing.",
  path: PATH,
});

const sections = [
  { id: "program", heading: "1. What this program is" },
  { id: "opt-in", heading: "2. How opt-in works" },
  { id: "opt-out", heading: "3. How to stop messages (STOP)" },
  { id: "help", heading: "4. Getting help (HELP)" },
  { id: "frequency", heading: "5. Message frequency & rates" },
  { id: "carriers", heading: "6. Carrier disclaimer" },
  { id: "privacy", heading: "7. Your number stays private" },
  { id: "contact", heading: "8. Contact" },
];

export default function MessagingPolicyPage() {
  return (
    <LegalPage
      title="SMS messaging policy"
      intro="If you've received a text sent through Loonext, this page explains what the program is, how you were opted in, and how to make it stop. It is also the messaging policy every business on Loonext agrees to."
      lastUpdated={LAST_UPDATED}
      lastUpdatedIso="2026-07-03"
      breadcrumbLabel="SMS messaging policy"
      path={PATH}
      sections={sections}
    >
      <LegalSectionBlock id="program" heading="1. What this program is">
        <p>
          Loonext is a shared text inbox that local service businesses in the
          United States and Canada use to text{" "}
          <strong>their own customers</strong> — appointment questions, quotes,
          photos of the job, on-my-way updates, and replies to messages those
          customers sent. Every message
          relayed through Loonext is a conversation between one business and a
          customer of that business. Loonext is not a bulk-marketing platform
          and does not offer blast tools, see our{" "}
          <LegalLink href="/legal/aup">acceptable use policy</LegalLink>.
          &quot;Loonext,&quot; &quot;we,&quot; and &quot;us&quot; mean the
          company that operates Loonext, as defined in our{" "}
          <LegalLink href="/legal/terms">terms of service</LegalLink>.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="opt-in" heading="2. How opt-in works">
        <p>
          You receive texts from a business on Loonext in one of three ways:
          you texted the business first; you called the business (if no one
          could pick up, you may get a single text back about your call so you
          can reach them by reply); or you gave the business your number and
          agreed, in person, by phone, or in writing, to be texted. When a
          business starts a conversation you didn&apos;t initiate, it must
          attest that it has your consent first; Loonext requires that
          attestation and records it (who attested and when).
        </p>
        <p>
          Consent is per-business. Agreeing to hear from one business never
          opts you into messages from any other business, and consent cannot be
          bought, sold, or transferred between businesses. And STOP works on{" "}
          <em>any</em> message, whoever started the conversation (section 3).
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="opt-out" heading="3. How to stop messages (STOP)">
        <p>
          Reply <strong>STOP</strong> to any message and the messages stop. The
          opt-out is recorded and further sends from that business to your
          number are blocked until you opt back in (for example, by replying
          START). You don&apos;t need the exact keyword: any reasonable request
          to stop, &quot;stop texting me,&quot; &quot;take me off your
          list,&quot; a phone call, or an email to the business, is honored
          within at most 10 business days, as the FCC&apos;s 2025 consent-revocation
          rule requires. Keyword opt-outs take effect immediately.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="help" heading="4. Getting help (HELP)">
        <p>
          Reply <strong>HELP</strong> to any message and you&apos;ll receive a
          message identifying the service and how to reach support. You can
          also email{" "}
          <LegalLink href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</LegalLink>{" "}
          or use our <LegalLink href="/contact">contact page</LegalLink> at any
          time.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="frequency" heading="5. Message frequency & rates">
        <p>
          <strong>Message frequency varies.</strong> These are conversations,
          not scheduled campaigns, so how many messages you receive depends on
          what you and the business are discussing. There is no fixed schedule
          of recurring messages.{" "}
          <strong>Message and data rates may apply</strong> according to your
          mobile plan; Loonext never charges the person receiving the texts.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="carriers" heading="6. Carrier disclaimer">
        <p>
          Carriers are not liable for delayed or undelivered messages. Text
          delivery depends on the mobile carrier networks, which neither
          Loonext nor the business texting you controls, and delivery is not
          guaranteed.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="privacy" heading="7. Your number stays private">
        <p>
          Mobile numbers and SMS consent data are never shared with, or sold
          to, third parties or affiliates for their own marketing. The consent
          you give a business, and the phone number tied to it, stay inside
          Loonext and the business that collected them, and are used only to
          deliver that business&apos;s messages and to honor opt-outs. The full
          detail is in our{" "}
          <LegalLink href="/legal/privacy">privacy policy</LegalLink>.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="contact" heading="8. Contact">
        <p>
          Questions about this program, or a message you received through
          Loonext? Email{" "}
          <LegalLink href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</LegalLink>{" "}
          or use our <LegalLink href="/contact">contact page</LegalLink>. A
          real person answers.
        </p>
      </LegalSectionBlock>
    </LegalPage>
  );
}
