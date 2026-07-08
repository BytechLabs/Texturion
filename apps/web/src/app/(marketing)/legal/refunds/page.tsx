import type { Metadata } from "next";

import {
  LegalLink,
  LegalPage,
  LegalSectionBlock,
} from "@/components/marketing/legal/legal-page";
import { SUPPORT_EMAIL } from "@/lib/marketing/business";
import { buildMetadata } from "@/lib/marketing/seo";

const PATH = "/legal/refunds";
const LAST_UPDATED = "July 3, 2026";

export const metadata: Metadata = buildMetadata({
  title: "30-day money-back guarantee",
  description:
    "The Loonext 30-day money-back guarantee: a full refund of your first invoice, subscription and the one-time registration fee included, no deductions for texts you sent, requested with a single email.",
  path: PATH,
});

const sections = [
  { id: "guarantee", number: "1", heading: "The guarantee" },
  { id: "request", number: "2", heading: "How to request a refund" },
  { id: "after", number: "3", heading: "What happens next" },
  { id: "contact", number: "4", heading: "Contact" },
];

export default function RefundsPage() {
  return (
    <LegalPage
      title="30-day money-back guarantee"
      summary="Tell us within 30 days of signing up and we refund your first invoice in full, the subscription and the one-time registration fee included. One email is the whole process, no reason needed, no forms, no retention call. The refund goes back to your original payment method, usually issued within one business day."
      lastUpdated={LAST_UPDATED}
      lastUpdatedIso="2026-07-03"
      breadcrumbLabel="30-day guarantee"
      path={PATH}
      sections={sections}
    >
      <LegalSectionBlock id="guarantee" number="1" heading="The guarantee">
        <p>
          If Loonext isn&apos;t right for your crew, tell us within 30 days of
          signing up and we&apos;ll refund your first invoice in full, the
          subscription and, if you paid it, the one-time $29 registration fee.
          No &quot;minus credits used&quot;: the texts you sent during those 30
          days are on us. No forms, no retention call. The guarantee covers the
          first 30 days of your first Loonext subscription; it doesn&apos;t
          reset if you cancel and come back later. It is also part of our{" "}
          <LegalLink href="/legal/terms">terms of service</LegalLink>.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock
        id="request"
        number="2"
        heading="How to request a refund"
      >
        <p>
          Email{" "}
          <LegalLink href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</LegalLink>{" "}
          from the email address on your account within your first 30 days and
          say you&apos;d like the refund. That&apos;s the whole process. You
          don&apos;t need to give a reason, though we appreciate hearing what
          didn&apos;t work. We reply.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="after" number="3" heading="What happens next">
        <p>
          We cancel your subscription and refund your full first invoice to
          your original payment method through Stripe. We issue the refund
          promptly, typically within one business day of your email; depending
          on your bank or card issuer it can take 5 to 10 business days to
          appear on your statement.
        </p>
        <p>
          Your number follows the same 30-day hold as any cancellation (see our{" "}
          <LegalLink href="/legal/terms">terms</LegalLink>): if you resubscribe
          within 30 days you keep it; after that it is released and can&apos;t
          be recovered.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="contact" number="4" heading="Contact">
        <p>
          Questions about the guarantee? Email{" "}
          <LegalLink href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</LegalLink>{" "}
          or use our <LegalLink href="/contact">contact page</LegalLink>.
        </p>
      </LegalSectionBlock>
    </LegalPage>
  );
}
