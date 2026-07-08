import type { Metadata } from "next";

import {
  LegalLink,
  LegalPage,
  LegalSectionBlock,
} from "@/components/marketing/legal/legal-page";
import { PRIVACY_EMAIL } from "@/lib/marketing/business";
import { buildMetadata } from "@/lib/marketing/seo";

const PATH = "/legal/subprocessors";
const LAST_UPDATED = "July 2, 2026";

export const metadata: Metadata = buildMetadata({
  title: "Sub-processors",
  description:
    "The third-party vendors Loonext uses to run the service, what each one processes, and the region it operates in, from the SMS carrier to payments, hosting, email, and analytics.",
  path: PATH,
});

const sections = [
  { id: "list", heading: "Current sub-processors" },
  { id: "changes", heading: "Changes" },
  { id: "contact", heading: "Contact" },
];

interface Row {
  name: string;
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
    purpose: "Application hosting, CDN, and network security",
    data: "Request metadata (IP, headers); no message content stored",
    region: "Global edge network",
  },
  {
    name: "Resend",
    purpose: "Transactional email (notifications, billing, invites)",
    data: "Recipient email address and email content",
    region: "United States",
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
      summary="Seven vendors process data on our behalf so Loonext can run, from the SMS carrier to payments, hosting, email, and analytics. Each is limited to what its job requires, and message content stays out of our error and analytics tools. Data lives primarily in the United States. When this list changes, this page and the date above change with it."
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
