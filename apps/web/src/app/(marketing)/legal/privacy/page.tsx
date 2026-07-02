import type { Metadata } from "next";

import {
  LegalLink,
  LegalPage,
  LegalSectionBlock,
} from "@/components/marketing/legal/legal-page";
import {
  PRIVACY_EMAIL,
  PRIVACY_OFFICER_NAME,
} from "@/lib/marketing/business";
import { buildMetadata } from "@/lib/marketing/seo";

const PATH = "/legal/privacy";
const LAST_UPDATED = "July 2, 2026";

export const metadata: Metadata = buildMetadata({
  title: "Privacy policy",
  description:
    "How JobText handles your data under PIPEDA and Quebec Law 25: US data processing named plainly, and a firm commitment that mobile numbers and SMS consent data are never sold or shared for third-party marketing.",
  path: PATH,
});

const sections = [
  { id: "scope", heading: "1. Scope" },
  { id: "what-we-collect", heading: "2. What we collect" },
  { id: "why", heading: "3. Why we use it" },
  { id: "sms-consent", heading: "4. SMS & consent data" },
  { id: "where", heading: "5. Where your data lives" },
  { id: "sharing", heading: "6. Who we share with" },
  { id: "retention", heading: "7. How long we keep it" },
  { id: "your-rights", heading: "8. Your rights" },
  { id: "law-25", heading: "9. Quebec Law 25" },
  { id: "security", heading: "10. Security" },
  { id: "contact", heading: "11. Privacy contact" },
];

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy policy"
      intro="One policy for both countries. It follows Canada's PIPEDA and Quebec's Law 25, and it tells you plainly where your data is processed — in the United States."
      lastUpdated={LAST_UPDATED}
      breadcrumbLabel="Privacy policy"
      path={PATH}
      sections={sections}
    >
      <LegalSectionBlock id="scope" heading="1. Scope">
        <p>
          This policy covers the personal information JobText handles when a
          business uses the service to text its customers. Two groups of people
          are involved: the <strong>account users</strong> on a business&apos;s
          crew, and the <strong>contacts</strong> those businesses text. The
          business is the party that decides who to text and why; JobText
          processes that data to run the shared inbox on the business&apos;s
          behalf.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="what-we-collect" heading="2. What we collect">
        <p>We collect only what the service needs to work:</p>
        <ul className="list-disc space-y-2 pl-6">
          <li>
            <strong>Account data:</strong> your name, email, and the business
            details you provide to register with the phone companies (legal
            business name, address, and a business identifier such as an EIN or
            BN). For the sole-proprietor path we collect the last four digits of
            an SSN/SIN and a mobile number for a one-time verification code — we
            never collect or store a full SSN/SIN.
          </li>
          <li>
            <strong>Contact & message data:</strong> the phone numbers, names,
            notes, and message content that flow through your inbox. This is your
            business&apos;s data; we hold it so your crew can see and reply to
            it.
          </li>
          <li>
            <strong>Billing data:</strong> handled by Stripe. We store customer
            and subscription identifiers, not full card numbers.
          </li>
          <li>
            <strong>Product analytics:</strong> cookieless, event-level usage
            (page views, feature clicks, counts). We do not put message content,
            names, addresses, or phone numbers into analytics.
          </li>
        </ul>
      </LegalSectionBlock>

      <LegalSectionBlock id="why" heading="3. Why we use it">
        <p>
          To provide the inbox, provision and register your number, send and
          receive texts, bill your subscription, prevent abuse and fraud, meet
          our legal and carrier obligations, and answer your support requests.
          We do not use your message content to train models or to advertise.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="sms-consent" heading="4. SMS & consent data">
        <p className="rounded-lg border border-border bg-card p-4 text-foreground">
          <strong>
            Mobile numbers and SMS consent data are never shared with, or sold
            to, third parties or affiliates for their own marketing.
          </strong>{" "}
          The consent a customer gives to be texted, and the phone number tied to
          it, stay inside JobText and the business that collected them. They are
          used only to deliver that business&apos;s messages and to honor
          opt-outs.
        </p>
        <p>
          When a business starts a conversation with a new contact, JobText
          records that consent was attested — a name and a date — and
          automatically adds the business&apos;s identity and a &quot;Reply STOP
          to opt out&quot; line to the first message. When someone texts STOP,
          the opt-out is recorded and future sends to that number are blocked.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="where" heading="5. Where your data lives">
        <p>
          JobText processes and stores data in the <strong>United States</strong>
          . Our database, authentication, and file storage run on Supabase in the
          AWS <code className="rounded bg-muted px-1 py-0.5 text-sm">us-east-1</code>{" "}
          region. If you are in Canada, your data is transferred to and processed
          in the United States — we state this plainly rather than burying it.
          The full list of the vendors that process data on our behalf, and the
          region each operates in, is on our{" "}
          <LegalLink href="/legal/subprocessors">
            sub-processors page
          </LegalLink>
          .
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="sharing" heading="6. Who we share with">
        <p>
          We share data only with the sub-processors that make the service run —
          the phone carrier (Telnyx), payments (Stripe), infrastructure
          (Supabase/AWS, Cloudflare), email (Resend), and error/analytics tooling
          (Sentry, PostHog) — each limited to what its job requires and listed on
          our <LegalLink href="/legal/subprocessors">sub-processors page</LegalLink>
          . We may disclose data if the law requires it. We do not sell personal
          information.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="retention" heading="7. How long we keep it">
        <p>
          We keep account and message data while your subscription is active and
          for a reasonable period afterward to meet legal, tax, and carrier
          record-keeping duties, then delete or anonymize it. Opt-out records are
          kept as long as needed to keep honoring the opt-out. You can ask us to
          delete your data, subject to those obligations.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="your-rights" heading="8. Your rights">
        <p>
          Under PIPEDA and Law 25 you can ask to access, correct, or delete your
          personal information, and to withdraw consent. Email{" "}
          <LegalLink href={`mailto:${PRIVACY_EMAIL}`}>{PRIVACY_EMAIL}</LegalLink>{" "}
          and we&apos;ll respond within the timelines the law requires. If a
          contact of one of our business customers asks us to exercise a right,
          we&apos;ll route the request to that business, which controls the data.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="law-25" heading="9. Quebec Law 25">
        <p>
          For Quebec residents, Law 25 gives you additional rights, including the
          right to be informed of the use and disclosure of your information and
          the right to portability. As required by Law 25, JobText has a
          designated person responsible for the protection of personal
          information:{" "}
          <strong>
            {PRIVACY_OFFICER_NAME ??
              "our Privacy Officer (name provided at launch)"}
          </strong>
          , reachable at{" "}
          <LegalLink href={`mailto:${PRIVACY_EMAIL}`}>{PRIVACY_EMAIL}</LegalLink>
          . We disclose above that personal information is transferred to and
          processed in the United States.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="security" heading="10. Security">
        <p>
          Data is encrypted in transit and at rest, each business&apos;s data is
          isolated from every other tenant, and we keep message content out of our
          analytics and error logs. The details are on our{" "}
          <LegalLink href="/security">security page</LegalLink>.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="contact" heading="11. Privacy contact">
        <p>
          Questions or requests? Email{" "}
          <LegalLink href={`mailto:${PRIVACY_EMAIL}`}>{PRIVACY_EMAIL}</LegalLink>
          . If you&apos;re in Canada and aren&apos;t satisfied with our response,
          you can contact the Office of the Privacy Commissioner of Canada, or the
          Commission d&apos;accès à l&apos;information du Québec for Quebec
          residents.
        </p>
      </LegalSectionBlock>
    </LegalPage>
  );
}
