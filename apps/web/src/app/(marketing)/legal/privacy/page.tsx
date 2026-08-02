import type { Metadata } from "next";

import {
  AI_INFERENCE_LOCATION_STATEMENT,
  AI_INFERENCE_RETENTION_STATEMENT,
  AI_TRAINING_STATEMENT,
} from "@loonext/shared";

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
const LAST_UPDATED = "July 30, 2026";

export const metadata: Metadata = buildMetadata({
  title: "Privacy policy",
  description:
    "How Loonext handles your data under PIPEDA and Quebec Law 25: US data processing named plainly, and a firm commitment that mobile numbers and SMS consent data are never sold or shared for third-party marketing.",
  path: PATH,
});

const sections = [
  { id: "scope", number: "1", heading: "Scope" },
  { id: "what-we-collect", number: "2", heading: "What we collect" },
  { id: "why", number: "3", heading: "Why we use it" },
  { id: "sms-consent", number: "4", heading: "SMS and consent data" },
  { id: "where", number: "5", heading: "Where your data lives" },
  { id: "sharing", number: "6", heading: "Who we share with" },
  { id: "ai", number: "7", heading: "AI features" },
  { id: "retention", number: "8", heading: "How long we keep it" },
  { id: "your-rights", number: "9", heading: "Your rights" },
  { id: "law-25", number: "10", heading: "Quebec Law 25" },
  { id: "security", number: "11", heading: "Security" },
  { id: "contact", number: "12", heading: "Privacy contact" },
];

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy policy"
      summary="We collect only what the service needs to run your inbox: account details, the contacts and messages your business handles, and billing through Stripe. Your data is processed and stored in the United States, and we say so plainly, with one exception we name rather than bury: AI inference runs on Cloudflare’s global network and cannot be confined to a country. Mobile numbers and SMS consent data are never sold or shared with third parties for their own marketing. You can ask to see, correct, or delete your information at any time."
      lastUpdated={LAST_UPDATED}
      breadcrumbLabel="Privacy policy"
      path={PATH}
      sections={sections}
    >
      <LegalSectionBlock id="scope" number="1" heading="Scope">
        <p>
          This policy covers the personal information Loonext handles when a
          business uses the service to text its customers. It follows
          Canada&apos;s PIPEDA and Quebec&apos;s Law 25 and applies in both
          countries we serve. Two groups of people are involved: the{" "}
          <strong>account users</strong> on a business&apos;s crew, and the{" "}
          <strong>contacts</strong> those businesses text. The business is the
          party that decides who to text and why; Loonext processes that data to
          run the shared inbox on the business&apos;s behalf.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock
        id="what-we-collect"
        number="2"
        heading="What we collect"
      >
        <p>We collect only what the service needs to work:</p>
        <ul className="list-disc space-y-2 pl-6">
          <li>
            <strong>Account data:</strong> your name, email, and the business
            details you provide to register with the phone companies (legal
            business name, address, and a business identifier such as an EIN or
            BN). For the sole-proprietor path we collect the last four digits of
            an SSN/SIN and a mobile number for a one-time verification code, we
            never collect or store a full SSN/SIN.
          </li>
          <li>
            <strong>Contact and message data:</strong> the phone numbers, names,
            notes, and message content that flow through your inbox. This is your
            business&apos;s data; we hold it so your crew can see and reply to
            it.
          </li>
          <li>
            <strong>Billing data:</strong> handled by Stripe. We store customer
            and subscription identifiers, not full card numbers.
          </li>
          <li>
            <strong>Sign-in and device data:</strong> for each device signed in
            to your account we keep which app it is, when it last used the
            service, and the approximate city the request came from. It is
            there so you and your workspace owner can see what has access and
            end it, on the &ldquo;signed-in devices&rdquo; screen in Settings.
            We keep the city, not the IP address, and only for as long as the
            record is useful (90 days after a device stops being signed in).
          </li>
          <li>
            <strong>Product analytics:</strong> cookieless, event-level usage
            (page views, feature clicks, counts). We do not put message content,
            names, addresses, or phone numbers into analytics. Our{" "}
            <LegalLink href="/legal/cookies">cookie policy</LegalLink> lists every
            cookie and browser-storage item we use.
          </li>
        </ul>
      </LegalSectionBlock>

      <LegalSectionBlock id="why" number="3" heading="Why we use it">
        <p>
          To provide the inbox, provision and register your number, send and
          receive texts, bill your subscription, prevent abuse and fraud, meet
          our legal and carrier obligations, and answer your support requests.
          We do not use your message content to train models or to advertise.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock
        id="sms-consent"
        number="4"
        heading="SMS and consent data"
      >
        <p className="rounded-xl bg-[color:var(--fr-frost)] p-4 text-[color:var(--fr-ink)]">
          <strong>
            Mobile numbers and SMS consent data are never shared with, or sold
            to, third parties or affiliates for their own marketing.
          </strong>{" "}
          The consent a customer gives to be texted, and the phone number tied to
          it, stay inside Loonext and the business that collected them. They are
          used only to deliver that business&apos;s messages and to honor
          opt-outs.
        </p>
        <p>
          When a business starts a conversation with a new contact, Loonext
          records that consent was attested, a name and a date. When someone
          texts STOP, the opt-out is recorded and future sends to that number
          are blocked.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="where" number="5" heading="Where your data lives">
        <p>
          Loonext processes and stores data in the <strong>United States</strong>
          . Our database, authentication, and file storage run on Supabase in the
          AWS <span className="fr-mono-data">us-east-1</span> region. If you are
          in Canada, your data is transferred to and processed in the United
          States, we state this plainly rather than burying it.
        </p>
        <p>
          {/* #318 V7: this section used to stop at the sentence above, which
              was true of storage and not true of AI inference. Naming the
              exception is the whole point of the section. */}
          <strong>One exception, and we would rather name it than have you
          find it.</strong> {AI_INFERENCE_LOCATION_STATEMENT} It applies only
          to the features in section 7, only to what those features send, and
          only while the request is being answered.{" "}
          {AI_INFERENCE_RETENTION_STATEMENT}
        </p>
        <p>
          The full list of
          the vendors that process data on our behalf, and the region each
          operates in, is on our{" "}
          <LegalLink href="/legal/subprocessors">
            sub-processors page
          </LegalLink>
          .
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="sharing" number="6" heading="Who we share with">
        <p>
          We share data only with the sub-processors that make the service run,
          the phone carrier (Telnyx), payments (Stripe), infrastructure
          (Supabase/AWS, Cloudflare), email (Resend), and error/analytics tooling
          (Sentry, PostHog), each limited to what its job requires and listed on
          our <LegalLink href="/legal/subprocessors">sub-processors page</LegalLink>
          . We may disclose data if the law requires it. We do not sell personal
          information.
        </p>
        {/* #430: push services were not named here at all, and they receive
            message content by design — the notification payload IS the
            content. Naming them is the disclosure; the workspace switch is
            what makes the disclosure actionable rather than merely honest. */}
        <p>
          Push notifications reach phones through Apple, Google, and the
          browser&rsquo;s own push service, so those services carry whatever the
          notification says. By default that is the contact&rsquo;s name and the
          first line of their message, which is what lets a crew tell a lead
          from a &ldquo;thanks&rdquo; without unlocking a phone. An owner or
          admin can turn message text off for the whole workspace in
          Settings &rarr; Notifications; after that the notification carries the
          name only, and the words are never sent to a push service at all. This
          is a workspace decision rather than a per-person one, because the
          content usually belongs to the customer rather than to the person
          holding the phone.
        </p>
      </LegalSectionBlock>

      {/* #389: the privacy page said nothing whatsoever about automated
          processing while three features were already sending message content
          and voicemail audio to a model. D46 is the internal posture; this is
          the customer-facing version of it, which did not exist. */}
      <LegalSectionBlock id="ai" number="7" heading="AI features">
        <p>
          Three features send content to an AI model: suggested replies, task
          details, and voicemail transcripts. They all run on Cloudflare Workers
          AI, inside the same Cloudflare account that already hosts the
          application. Our{" "}
          <LegalLink href="/legal/subprocessors">sub-processors page</LegalLink>{" "}
          names each feature, exactly what it sends, the model that receives it,
          and whether it is on by default.
        </p>
        <p>
          Cloudflare&rsquo;s published Workers AI policy states:{" "}
          <em>&ldquo;{AI_TRAINING_STATEMENT}.&rdquo;</em> We do not use message
          content or voicemail audio to train anything either. What comes back
          is stored in your workspace like any other message data and is deleted
          with it.
        </p>
        <p>
          Some of this content belongs to the people your business texts and
          calls, not to you or to us. A voicemail is somebody&rsquo;s voice and a
          thread is somebody&rsquo;s words. That is why every one of these
          features can be switched off for your whole workspace, and why a
          drafted reply is never sent automatically. A person reads it, edits
          it, and decides.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock
        id="retention"
        number="8"
        heading="How long we keep it"
      >
        <p>
          We keep account and message data while your subscription is active and
          for a reasonable period afterward to meet legal, tax, and carrier
          record-keeping duties, then delete or anonymize it. Opt-out records are
          kept as long as needed to keep honoring the opt-out.
        </p>
        <p>
          You do not have to ask us. You can delete your own account, or close a
          whole workspace, from inside Loonext. See{" "}
          <LegalLink href="/legal/delete-my-data">delete your data</LegalLink>{" "}
          for exactly what each one removes. Closing a workspace erases
          everything in it 30 days later, which is a window in which a workspace
          closed by mistake can still be recovered; after that nobody can undo
          it. Two things outlive it: do-not-text records, which belong to the
          person who sent the STOP rather than to the business that received it,
          and a stripped record that consent existed, which Canadian anti-spam
          law requires us to hold for three years with names and message
          contents removed.
        </p>
        <p>
          {/* #284/D77: the numbers, published. "What is your retention policy"
              is the first compliance question any buyer asks. */}
          The defaults, by kind of data. Texts, conversations, job photos and
          call records are kept for <strong>seven years</strong> after the last
          activity on them, because a contractor in a warranty dispute over a
          two-year-old job needs those texts, and deleting them sooner would
          cause the harm the deletion was meant to prevent. Voicemail{" "}
          <em>recordings</em> are the exception and are kept for{" "}
          <strong>one year</strong>: the transcript keeps what was said, while
          the recording is somebody&rsquo;s actual voice in their home and is
          worth far less after the first few weeks. The transcript itself stays
          with the call record for the full seven years, which is what makes
          deleting the audio safe rather than lossy. Audit logs are kept for 12
          months. Do-not-text records are kept indefinitely, because they belong
          to the person who sent the STOP.
        </p>
        <p>
          {/* #340: the contact form collects data from people who never become
              customers, so none of the account-based windows above cover it. */}
          If you write to us through the contact form on this site without ever
          creating an account, we keep your name, email, company and message for
          up to a year so we can reply and follow up, then delete them. We also
          record the IP address the form was submitted from, purely to tell a
          spam flood from a real enquiry, and that is deleted after 30 days,
          sooner than the rest, because it stops being useful sooner. You can
          ask us to delete a contact-form submission at any time by emailing{" "}
          <LegalLink href={`mailto:${PRIVACY_EMAIL}`}>{PRIVACY_EMAIL}</LegalLink>
          , and you do not need an account to do it.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="your-rights" number="9" heading="Your rights">
        <p>
          Under PIPEDA and Law 25 you can access, correct, or delete your
          personal information, and withdraw consent. Deletion is self-serve and
          takes effect immediately;{" "}
          <LegalLink href="/legal/delete-my-data">delete your data</LegalLink>{" "}
          has the steps. For anything else, or if you have lost access to your
          account, email{" "}
          <LegalLink href={`mailto:${PRIVACY_EMAIL}`}>{PRIVACY_EMAIL}</LegalLink>{" "}
          and we&apos;ll respond within the timelines the law requires. If a
          contact of one of our business customers asks us to exercise a right,
          we&apos;ll route the request to that business, which controls the data.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="law-25" number="10" heading="Quebec Law 25">
        <p>
          For Quebec residents, Law 25 gives you additional rights, including the
          right to be informed of the use and disclosure of your information and
          the right to portability. As required by Law 25, Loonext has a
          designated person responsible for the protection of personal
          information:{" "}
          <strong>{PRIVACY_OFFICER_NAME ?? "our Privacy Officer"}</strong>,
          reachable at{" "}
          <LegalLink href={`mailto:${PRIVACY_EMAIL}`}>{PRIVACY_EMAIL}</LegalLink>
          . We disclose above that personal information is transferred to and
          processed in the United States, that the features in section 7 send
          message content or voicemail audio to an AI model on
          Cloudflare&rsquo;s global network, and that this inference in
          particular is not confined to any one country.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="security" number="11" heading="Security">
        <p>
          Data is encrypted in transit and at rest, each business&apos;s data is
          isolated from every other tenant, and we keep message content out of our
          analytics and error logs. The details are on our{" "}
          <LegalLink href="/security">security page</LegalLink>.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="contact" number="12" heading="Privacy contact">
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
