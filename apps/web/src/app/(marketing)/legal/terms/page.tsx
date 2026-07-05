import type { Metadata } from "next";

import {
  LegalLink,
  LegalPage,
  LegalSectionBlock,
} from "@/components/marketing/legal/legal-page";
import { SUPPORT_EMAIL } from "@/lib/marketing/business";
import { buildMetadata } from "@/lib/marketing/seo";

const PATH = "/legal/terms";
const LAST_UPDATED = "July 2, 2026";

export const metadata: Metadata = buildMetadata({
  title: "Terms of service",
  description:
    "The Loonext terms of service: a month-to-month subscription, no annual contract, plain-language cancellation with a 30-day number hold, and the money-back guarantee.",
  path: PATH,
});

const sections = [
  { id: "agreement", heading: "1. The agreement" },
  { id: "eligibility", heading: "2. Who can sign up" },
  { id: "subscription", heading: "3. Subscription & billing" },
  { id: "numbers", heading: "4. Your phone number" },
  { id: "acceptable-use", heading: "5. Acceptable use" },
  { id: "cancellation", heading: "6. Cancellation & number hold" },
  { id: "guarantee", heading: "7. 30-day money-back guarantee" },
  { id: "availability", heading: "8. Availability & changes" },
  { id: "liability", heading: "9. Liability" },
  { id: "contact", heading: "10. Contact" },
];

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of service"
      intro="These terms cover your use of Loonext, the shared text inbox for service crews. We keep them short and plain, the way we keep everything about Loonext."
      lastUpdated={LAST_UPDATED}
      breadcrumbLabel="Terms of service"
      path={PATH}
      sections={sections}
    >
      <LegalSectionBlock id="agreement" heading="1. The agreement">
        <p>
          By creating a Loonext account or using the service, you agree to these
          terms on behalf of your business. If you don&apos;t agree, don&apos;t
          use Loonext. &quot;Loonext,&quot; &quot;we,&quot; and &quot;us&quot;
          mean the company that operates Loonext; &quot;you&quot; means the
          business that holds the account and the people it authorizes to use it.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="eligibility" heading="2. Who can sign up">
        <p>
          Loonext is built for businesses in the United States and Canada that
          text their own customers. You must be able to enter into a contract,
          run a real business, and give accurate business information when you
          register your number with the phone companies. You must have the
          consent of the people you text, see our{" "}
          <LegalLink href="/legal/aup">acceptable use policy</LegalLink>.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="subscription" heading="3. Subscription & billing">
        <p>
          Loonext is a paid, month-to-month subscription. There is no annual
          contract and nothing auto-converts from a trial, there is no trial
          that provisions a number. You pick Starter ($29/mo) or Pro ($79/mo),
          pay through Stripe, and your number is created only after your payment
          succeeds.
        </p>
        <p>
          US businesses (and Canadian businesses that turn on US texting) also
          pay a one-time $29 fee to register with the phone companies. It is
          charged once, ever, cancel and come back later and you won&apos;t pay
          it again.
        </p>
        <p>
          Prices are in US dollars, plus sales tax where it applies, calculated
          at checkout by Stripe Tax. If you send more than your plan&apos;s
          included texts, extra texts are billed at your plan&apos;s overage rate
          up to a spending cap you control. We email you at 80% and 100% of your
          included texts. Your subscription renews automatically each month until
          you cancel.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="numbers" heading="4. Your phone number">
        <p>
          The local number Loonext provisions belongs to your business account
          while your subscription is active. You can send to Canadian numbers as
          soon as the number is live; sending to US numbers turns on after the
          phone companies approve your registration (typically 3–7 business
          days). Receiving texts works right away.
        </p>
        <p>
          You can bring your existing US or Canadian number to Loonext instead
          of getting a new one, the transfer is free. Your number keeps working
          on your current carrier the whole time and switches to Loonext on the
          transfer date, which typically takes about 1–7 business days. Texting
          through Loonext turns on once the transfer completes. We show you where
          the transfer is at every step.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="acceptable-use" heading="5. Acceptable use">
        <p>
          Your use of Loonext is subject to our{" "}
          <LegalLink href="/legal/aup">acceptable use policy</LegalLink>. In
          short: text only people who have agreed to hear from you, no purchased
          or harvested lists, no SHAFT content (sex, hate, alcohol, firearms,
          tobacco), and honor every opt-out immediately. We may suspend or
          terminate accounts that break these rules or put message delivery at
          risk for everyone on the network.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="cancellation" heading="6. Cancellation & number hold">
        <p>
          You can cancel anytime from your billing settings, no phone call, no
          retention chat. Cancellation stops the next renewal; you keep access
          through the period you&apos;ve already paid for. We do not add
          cancellation friction and there are no early-termination fees.
        </p>
        <p>
          After you cancel, we hold your number for 30 days. If you resubscribe
          within that window, you keep the same number. After 30 days the number
          is released and can&apos;t be recovered.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="guarantee" heading="7. 30-day money-back guarantee">
        <p>
          If Loonext isn&apos;t right for your crew, email us within 30 days of
          signing up and we&apos;ll refund your first invoice in full, the
          subscription and the one-time registration fee included. No
          &quot;minus credits used,&quot; no forms, no retention call.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="availability" heading="8. Availability & changes">
        <p>
          We work to keep Loonext available, but we don&apos;t guarantee
          uninterrupted service, text delivery depends on the phone companies
          and carriers, which we don&apos;t control. Current service status is
          on our <LegalLink href="/status">status page</LegalLink>. We may
          update the product and these terms; when we make a material change to
          these terms, we&apos;ll update the date above and, where appropriate,
          let account owners know.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="liability" heading="9. Liability">
        <p>
          Loonext is provided &quot;as is.&quot; To the extent the law allows,
          we&apos;re not liable for indirect or consequential losses, and our
          total liability for any claim is limited to the amount you paid us in
          the three months before the claim. Nothing here limits liability that
          can&apos;t be limited by law.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="contact" heading="10. Contact">
        <p>
          Questions about these terms? Email{" "}
          <LegalLink href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</LegalLink>{" "}
          or use our <LegalLink href="/contact">contact page</LegalLink>. A real
          person answers.
        </p>
      </LegalSectionBlock>
    </LegalPage>
  );
}
