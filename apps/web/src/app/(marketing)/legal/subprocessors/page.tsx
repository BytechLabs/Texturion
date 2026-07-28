import type { Metadata } from "next";

import {
  LegalLink,
  LegalPage,
  LegalSectionBlock,
} from "@/components/marketing/legal/legal-page";
import { AI_DISCLOSURES, AI_TRAINING_STATEMENT } from "@loonext/shared";

import { PRIVACY_EMAIL } from "@/lib/marketing/business";
import { buildMetadata } from "@/lib/marketing/seo";

const PATH = "/legal/subprocessors";
const LAST_UPDATED = "July 28, 2026";

export const metadata: Metadata = buildMetadata({
  title: "Sub-processors",
  description:
    "The third-party vendors Loonext uses to run the service, what each one processes, and the region it operates in, from the SMS carrier to payments, hosting, email, and analytics.",
  path: PATH,
});

const sections = [
  { id: "list", heading: "Current sub-processors" },
  { id: "ai", heading: "AI features" },
  { id: "changes", heading: "Changes" },
  { id: "contact", heading: "Contact" },
];

interface Row {
  name: string;
  /** Qualifier shown under the vendor name, for a vendor that wears two hats. */
  name_note?: string;
  purpose: string;
  data: string;
  region: string;
}

/** Grounded in SPEC §3 (component list) and §10 (PII posture). */
const ROWS: Row[] = [
  {
    name: "Telnyx",
    purpose: "SMS/MMS carriage, phone numbers, 10DLC registration",
    data: "Message content, contact phone numbers, business registration details",
    region: "United States",
  },
  {
    name: "Stripe",
    purpose: "Subscription payments, tax calculation, billing portal",
    data: "Billing contact, subscription and payment identifiers, tax location",
    region: "United States",
  },
  {
    name: "Supabase (on AWS)",
    purpose: "Database, authentication, and file storage",
    data: "All account, contact, and message data; MMS attachments",
    region: "United States. AWS us-east-1",
  },
  {
    name: "Cloudflare",
    // #389: this row said "hosting, CDN, and network security" and "no message
    // content stored" while the product was already sending whole message
    // threads and voicemail audio to Cloudflare Workers AI. Workers AI running
    // inside the same Cloudflare account is a good argument for not adding a
    // second vendor row — it is not an argument for this row describing only
    // hosting. See the AI section below and packages/shared/ai-disclosure.ts.
    name_note: "including Workers AI",
    purpose: "Application hosting, CDN, network security, and AI features",
    data: "Request metadata (IP, headers); message content and voicemail audio sent to Workers AI for the features listed below",
    region: "Global edge network",
  },
  {
    name: "Resend",
    purpose: "Transactional email (notifications, billing, invites)",
    data: "Recipient email address and email content",
    region: "United States",
  },
  {
    // #389: found while correcting the Cloudflare row. DATA-INVENTORY.md lists
    // Firebase Cloud Messaging and says outright that everything on that list
    // "must also appear on /legal/subprocessors" — and it did not. The push
    // preview carries the sender's name and a message snippet, so this is
    // message content reaching a vendor this page never named.
    name: "Google (Firebase Cloud Messaging)",
    purpose: "Push notifications to the Android and iPhone apps",
    data: "Device push tokens; the notification preview, which contains the sender name and a short message excerpt",
    region: "United States. Relayed on to Apple's push service for iPhones",
  },
  {
    name: "Sentry",
    purpose: "Error monitoring",
    data: "Error diagnostics with PII scrubbed, no message bodies or phone numbers",
    region: "United States",
  },
  {
    name: "PostHog",
    purpose: "Product analytics (events only)",
    data: "Event names, counts, and UUIDs, no message content; cookieless on marketing pages",
    region: "United States",
  },
];

export default function SubprocessorsPage() {
  return (
    <LegalPage
      title="Sub-processors"
      summary="Eight vendors process data on our behalf so Loonext can run, from the SMS carrier to payments, hosting, email, and analytics. Each is limited to what its job requires, and message content stays out of our error and analytics tools. Three features send message content or voicemail audio to an AI model, and they are named in full below. Data lives primarily in the United States. When this list changes, this page and the date above change with it."
      lastUpdated={LAST_UPDATED}
      breadcrumbLabel="Sub-processors"
      path={PATH}
      sections={sections}
    >
      <LegalSectionBlock id="list" heading="Current sub-processors">
        {/* The Honesty Ledger treatment (v4 §5.3): Frost row striping, no
            rules, vendor names emphasized, regions in the mono voice. */}
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[0.9375rem]">
            <thead>
              <tr className="text-left">
                <th
                  scope="col"
                  className="fr-eyebrow px-4 py-3 text-[color:var(--fr-ink-55)]"
                >
                  Vendor
                </th>
                <th
                  scope="col"
                  className="fr-eyebrow px-4 py-3 text-[color:var(--fr-ink-55)]"
                >
                  What it does
                </th>
                <th
                  scope="col"
                  className="fr-eyebrow px-4 py-3 text-[color:var(--fr-ink-55)]"
                >
                  Data it touches
                </th>
                <th
                  scope="col"
                  className="fr-eyebrow px-4 py-3 text-[color:var(--fr-ink-55)]"
                >
                  Region
                </th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row, i) => (
                <tr
                  key={row.name}
                  className={
                    i % 2 === 0 ? "bg-[color:var(--fr-frost)]" : undefined
                  }
                >
                  <td className="rounded-l-[6px] px-4 py-3 align-top font-semibold text-[color:var(--fr-ink)]">
                    {row.name}
                    {row.name_note && (
                      <span className="block text-[0.8125rem] font-normal text-[color:var(--fr-ink-55)]">
                        {row.name_note}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 align-top text-[color:var(--fr-ink-70)]">
                    {row.purpose}
                  </td>
                  <td className="px-4 py-3 align-top text-[color:var(--fr-ink-70)]">
                    {row.data}
                  </td>
                  <td className="fr-mono-data rounded-r-[6px] px-4 py-3 align-top text-[0.8125rem] text-[color:var(--fr-ink-70)]">
                    {row.region}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[0.9375rem] text-[color:var(--fr-ink-55)]">
          Data lives primarily in the United States (Supabase on AWS{" "}
          <span className="fr-mono-data">us-east-1</span>). We keep message
          content out of Sentry and PostHog by design, see our{" "}
          <LegalLink href="/security">security page</LegalLink> and{" "}
          <LegalLink href="/legal/privacy">privacy policy</LegalLink>.
        </p>
      </LegalSectionBlock>

      {/* #389. Rendered from the SHARED disclosure list, not retyped here: a
          test in the API package asserts that list covers every feature in the
          AI cost registry, so a new AI feature cannot ship without appearing
          on this page. The old row drifted precisely because the public page
          and the internal inventory were two independent documents. */}
      <LegalSectionBlock id="ai" heading="AI features">
        <p>
          Three features send content to an AI model. All of them run on
          Cloudflare Workers AI, inside the same Cloudflare account and network
          boundary as the rest of the application, which is why Cloudflare
          appears once above rather than twice. What each one sends, and the
          model that receives it:
        </p>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[0.9375rem]">
            <thead>
              <tr className="text-left">
                <th scope="col" className="fr-eyebrow px-4 py-3 text-[color:var(--fr-ink-55)]">
                  Feature
                </th>
                <th scope="col" className="fr-eyebrow px-4 py-3 text-[color:var(--fr-ink-55)]">
                  What it sends
                </th>
                <th scope="col" className="fr-eyebrow px-4 py-3 text-[color:var(--fr-ink-55)]">
                  Model
                </th>
                <th scope="col" className="fr-eyebrow px-4 py-3 text-[color:var(--fr-ink-55)]">
                  On by default
                </th>
              </tr>
            </thead>
            <tbody>
              {AI_DISCLOSURES.map((row, i) => (
                <tr
                  key={row.key}
                  className={i % 2 === 0 ? "bg-[color:var(--fr-frost)]" : undefined}
                >
                  <td className="rounded-l-[6px] px-4 py-3 align-top font-semibold text-[color:var(--fr-ink)]">
                    {row.label}
                  </td>
                  <td className="px-4 py-3 align-top text-[color:var(--fr-ink-70)]">
                    {row.sends}
                  </td>
                  <td className="fr-mono-data px-4 py-3 align-top text-[0.8125rem] text-[color:var(--fr-ink-70)]">
                    {row.models.join(", ")}
                  </td>
                  <td className="rounded-r-[6px] px-4 py-3 align-top text-[color:var(--fr-ink-70)]">
                    {row.defaultOn ? "Yes" : "No"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          Two of those models are published by OpenAI and one by Meta. They run
          on Cloudflare&rsquo;s infrastructure under Cloudflare&rsquo;s terms;
          we do not send your data to OpenAI or Meta directly. We name them
          because who wrote the model is something you would reasonably want to
          know before a customer&rsquo;s voicemail is transcribed by it.
        </p>
        <p>
          On training, Cloudflare&rsquo;s published Workers AI policy states:{" "}
          <em>&ldquo;{AI_TRAINING_STATEMENT}.&rdquo;</em> We do not use message
          content or voicemail audio to train anything either. Transcripts and
          drafts are stored in your workspace like any other message data, and
          are deleted with it.
        </p>
        <p>
          Every one of these features can be turned off for your whole
          workspace in Settings, and each has a monthly ceiling.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="changes" heading="Changes">
        <p>
          If we add or replace a sub-processor, we&apos;ll update this page and
          the date above. This list is the authoritative record of who processes
          data for Loonext.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="contact" heading="Contact">
        <p>
          Questions about our sub-processors or data handling? Email{" "}
          <LegalLink href={`mailto:${PRIVACY_EMAIL}`}>{PRIVACY_EMAIL}</LegalLink>
          .
        </p>
      </LegalSectionBlock>
    </LegalPage>
  );
}
