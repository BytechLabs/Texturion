import type { Metadata } from "next";

import {
  LegalLink,
  LegalPage,
  LegalSectionBlock,
} from "@/components/marketing/legal/legal-page";
import { SUPPORT_EMAIL } from "@/lib/marketing/business";
import { buildMetadata } from "@/lib/marketing/seo";

const PATH = "/legal/fair-use";
const LAST_UPDATED = "July 11, 2026";

export const metadata: Metadata = buildMetadata({
  title: "Fair use policy",
  description:
    "Loonext is flat-rate texting for a real crew under an automated fair-use policy. This page is the one place the concrete numbers live: Starter includes 500 texts a month, Pro 2,500, extra texts are 3¢ (Starter) or 2.5¢ (Pro) each up to a spending cap you control, a sent photo counts as three texts, calling is included on every plan with 2,500 (Starter) or 6,000 (Pro) calling minutes across forwarding and outbound calls and extra minutes at 1¢ each under the same cap, and storage is free with no caps.",
  path: PATH,
});

const sections = [
  { id: "why", number: "1", heading: "Why this exists" },
  { id: "included", number: "2", heading: "What your plan includes" },
  { id: "overage", number: "3", heading: "Overage and your spending cap" },
  { id: "what-for", number: "4", heading: "What Loonext is for" },
  { id: "reasonable", number: "5", heading: "Reasonable use" },
  { id: "numbers", number: "6", heading: "Phone numbers" },
  { id: "add-ons", number: "7", heading: "Voice and picture messages" },
  { id: "storage", number: "8", heading: "Storage" },
  { id: "enforcement", number: "9", heading: "If usage is out of bounds" },
  { id: "contact", number: "10", heading: "Contact" },
];

export default function FairUsePage() {
  return (
    <LegalPage
      title="Fair use policy"
      summary="Loonext is a flat monthly price with texting included under an automated fair-use policy, and this page is the one place the concrete mechanics live. Starter includes 500 texts a month and Pro includes 2,500; extra texts are billed at 3¢ (Starter) or 2.5¢ (Pro) each up to a monthly spending cap you control, which pauses sending before a bill can surprise you. Calling is included on every plan and works the same way: 2,500 calling minutes on Starter and 6,000 on Pro, both directions, extra minutes at 1¢ each under the same cap. Storage is free, with no caps. We reserve a narrow right to step in only when usage stops looking like one business texting its own customers."
      lastUpdated={LAST_UPDATED}
      lastUpdatedIso="2026-07-11"
      breadcrumbLabel="Fair use"
      path={PATH}
      sections={sections}
    >
      <LegalSectionBlock id="why" number="1" heading="Why this exists">
        <p>
          Loonext charges one flat price for the whole crew, with a set number of
          texts included. That only works when usage looks like a business
          texting its own customers. So this page tells you exactly what is
          included, what happens when you go past it, and the one line we hold,
          with no surprises. It is part of our{" "}
          <LegalLink href="/legal/terms">terms of service</LegalLink> and sits
          next to the{" "}
          <LegalLink href="/legal/aup">acceptable use policy</LegalLink>, which
          covers who you may text and what you may say.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock
        id="included"
        number="2"
        heading="What your plan includes"
      >
        <p>
          Starter is $29/mo for up to 3 people and includes 500 texts a month on
          one number. Pro is $79/mo for up to 15 people, includes 2,500 texts,
          and adds a second number. A text is counted in segments (about 160
          characters each), the same way the carriers count them, so one long
          message can use more than one segment. This page is the canonical
          home of those figures; the{" "}
          <LegalLink href="/pricing">pricing page</LegalLink> describes plans
          in plain fair-use terms and points here for the mechanics.
          Think of the allowances as a fair-use line for one business texting its own
          customers, not a target: almost every crew stays well inside them
          without thinking about it, and a busy month now and then is fine.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock
        id="overage"
        number="3"
        heading="Overage and your spending cap"
      >
        <p>
          If you send more than your plan includes, each extra segment is billed
          at 3&cent; on Starter or 2.5&cent; on Pro, up to a monthly spending
          cap you control (3&times; your included texts by default, adjustable
          in billing settings). You are never billed by surprise: we alert the
          account owner at 80% and again at 100% of your included texts, so paid
          overage never begins unnoticed, and sending pauses the moment you reach
          your cap. Raise the cap, upgrade, or wait for the next cycle. Your call.
          Beyond those fixed points, we also watch how your usage is pacing across
          the whole period and reach out early if you are on track to run past
          what your plan comfortably covers, so you can adjust before it adds up
          rather than hear about it after.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="what-for" number="4" heading="What Loonext is for">
        <p>
          Loonext is a shared inbox for conversational texting with customers who
          agreed to hear from you: quotes, scheduling, on-my-way texts, and
          follow-ups. It is not a bulk-marketing platform, a mass-campaign
          blaster, an application-to-person (A2P) messaging gateway, a
          lead-generation tool for texting strangers, or a service to resell. We
          do not build those tools, and using Loonext as one falls outside fair
          use. What you may send, and to whom, is governed by the{" "}
          <LegalLink href="/legal/aup">acceptable use policy</LegalLink>.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="reasonable" number="5" heading="Reasonable use">
        <p>
          Almost every business stays well inside its plan. For the rare account
          whose usage stops looking normal, fair, and reasonable for one business
          texting its own customers, we reserve the right to review it and, where
          needed, to rate-limit it, ask you to move to a plan that fits, or in
          serious cases suspend it. The signals we weigh include volume far above
          the plan with few replies coming back, automated or bulk sending,
          one-to-many blasts, many messages to numbers that never consented, or a
          single account shared across separate businesses. Whenever we
          reasonably can, we tell you first and give you a fair chance to adjust
          or upgrade before we act.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="numbers" number="6" heading="Phone numbers">
        <p>
          Your plan includes its numbers (one on Starter, two on Pro), and you
          can choose, release, and set up a replacement number yourself at no
          extra charge. Getting a fresh number when you genuinely need one is
          part of the plan. Rapidly cycling through numbers is not: because each
          new number is a real cost and heavy churn hurts delivery for everyone,
          the number of times you can set up a new number is limited, and
          churning numbers to dodge opt-outs or carrier filtering breaks both
          this policy and the{" "}
          <LegalLink href="/legal/aup">acceptable use policy</LegalLink>.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock
        id="add-ons"
        number="7"
        heading="Voice and picture messages"
      >
        <p>
          Picture messages are included on every plan, both directions.
          Receiving photos is free; each photo you send counts as three texts
          from your monthly allowance and follows the same overage rules as any
          other text you send. Calling is included on every plan and follows
          the same fair-use mechanics as texting: Starter
          includes 2,500 calling minutes a month and Pro includes 6,000,
          shared by both directions. A minute is a minute you actually
          talked, whether a customer&apos;s call was forwarded to your cell or you
          called a customer from the app, always from your business number;
          ringing that goes unanswered never counts. Extra minutes are billed
          at 1&cent; each, under the same monthly spending cap you control,
          and we alert the owner at 80% and again at 100% of the included
          minutes so paid overage never begins unnoticed. Only at your cap
          does calling pause for the rest of the cycle: missed callers still
          get your text-back, and the texting in your base plan keeps working
          either way.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="storage" number="8" heading="Storage">
        <p>
          Storage is free. Files you attach to notes and the pictures customers
          send you are kept with no storage caps, no storage add-on, and no
          meter: uploads never pause and inbound photos never stop being saved
          because of space. The one line we hold is the same reasonable-use
          line as everything else: if a workspace&apos;s storage stops looking
          like one business keeping its own customer conversations (for
          example, using Loonext as a general file locker), we will contact
          you and work it out person to person. Nothing is blocked
          automatically.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock
        id="enforcement"
        number="9"
        heading="If usage is out of bounds"
      >
        <p>
          Depending on severity, we may rate-limit an account, ask you to
          upgrade, pause a feature, or, for serious or repeated abuse, suspend or
          end the account to protect recipients, delivery, and the network we all
          share. Where we reasonably can, we give notice and a reasonable period
          to put things right first. This policy is enforced consistently with
          our <LegalLink href="/legal/terms">terms of service</LegalLink> and{" "}
          <LegalLink href="/legal/aup">acceptable use policy</LegalLink>, and if
          you decide Loonext is not for you, the{" "}
          <LegalLink href="/legal/refunds">30-day money-back guarantee</LegalLink>{" "}
          still applies.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="contact" number="10" heading="Contact">
        <p>
          Expecting a busy month, or not sure whether a use fits? Tell us first
          and we will help you land on the right plan:{" "}
          <LegalLink href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</LegalLink>.
        </p>
      </LegalSectionBlock>
    </LegalPage>
  );
}
