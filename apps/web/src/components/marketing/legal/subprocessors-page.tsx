import {
  LegalLink,
  LegalPage,
  LegalSectionBlock,
} from "@/components/marketing/legal/legal-page";
import { LegalRichText } from "@/components/marketing/legal/legal-rich-text";
import { CATALOGS } from "@/i18n/catalog";
import type { MarketingLocale } from "@/i18n/marketing/footer";
import { legalSubprocessorsCopy } from "@/i18n/marketing/legal-subprocessors";
import { PRIVACY_EMAIL } from "@/lib/marketing/business";
import { twinOf } from "@/lib/marketing/translated-pages";
import {
  AI_DISCLOSURES,
  AI_INFERENCE_LOCATION_SOURCE,
  AI_INFERENCE_LOCATION_STATEMENT,
  AI_INFERENCE_RETENTION_STATEMENT,
  AI_TRAINING_STATEMENT,
  AI_VENDOR_NAMES,
  aiModelsByVendor,
} from "@loonext/shared";

const EN_PATH = "/legal/subprocessors";
const FR_PATH = "/fr/sous-traitants";

/** Vendor names are proper nouns; every reader-facing description is a key. */
const ROWS = [
  {
    name: "Telnyx",
    purpose: "telnyxPurpose",
    data: "telnyxData",
    region: "telnyxRegion",
  },
  {
    name: "Stripe",
    purpose: "stripePurpose",
    data: "stripeData",
    region: "stripeRegion",
  },
  {
    name: "Supabase (on AWS)",
    purpose: "supabasePurpose",
    data: "supabaseData",
    region: "supabaseRegion",
  },
  {
    name: "Cloudflare",
    note: "cloudflareNote",
    purpose: "cloudflarePurpose",
    data: "cloudflareData",
    region: "cloudflareRegion",
  },
  {
    name: "Resend",
    purpose: "resendPurpose",
    data: "resendData",
    region: "resendRegion",
  },
  {
    name: "Google (Firebase Cloud Messaging)",
    purpose: "firebasePurpose",
    data: "firebaseData",
    region: "firebaseRegion",
  },
  {
    name: "Sentry",
    purpose: "sentryPurpose",
    data: "sentryData",
    region: "sentryRegion",
  },
  {
    name: "PostHog",
    purpose: "posthogPurpose",
    data: "posthogData",
    region: "posthogRegion",
  },
] as const;

function modelVendorSentence(prefix: string): string {
  const counted = aiModelsByVendor().map(({ vendor, count }) => {
    const name = AI_VENDOR_NAMES[vendor] ?? vendor;
    return `${name} (${count})`;
  });
  if (counted.length === 0) return "";
  return `${prefix} ${counted.join(", ")}.`;
}

export function SubprocessorsPageBody({
  locale = "en",
}: {
  locale?: MarketingLocale;
}) {
  const copy = legalSubprocessorsCopy(locale);
  const french = locale === "fr-CA";
  const catalogue = CATALOGS[locale];
  const say = (key: string): string => {
    const [section, name] = key.split(".");
    return (catalogue as unknown as Record<string, Record<string, string>>)[section]?.[name] ?? key;
  };
  const sections = [
    { id: "list", heading: copy.sectionList },
    { id: "ai", heading: copy.sectionAi },
    { id: "changes", heading: copy.sectionChanges },
    { id: "contact", heading: copy.sectionContact },
  ];
  const featureCount = String(AI_DISCLOSURES.length);
  const vendorCount = String(ROWS.length);
  const securityTwin = french ? twinOf("/security") : undefined;
  const securityPath =
    securityTwin?.locale === "fr-CA" ? securityTwin.path : "/security";
  const summary = copy.summary
    .replace("{vendorCount}", vendorCount)
    .replace("{featureCount}", featureCount);
  const rowCopy = copy as unknown as Record<string, string>;

  return (
    <LegalPage
      title={copy.title}
      summary={summary}
      lastUpdated={copy.lastUpdated}
      lastUpdatedIso="2026-07-30"
      breadcrumbLabel={copy.breadcrumbLabel}
      path={french ? FR_PATH : EN_PATH}
      sections={sections}
      locale={locale}
    >
      <LegalSectionBlock id="list" heading={copy.sectionList}>
        <div className="overflow-x-auto" tabIndex={0}>
          <table className="w-full border-collapse text-[0.9375rem]">
            <thead>
              <tr className="text-left">
                <th scope="col" className="fr-eyebrow px-4 py-3 text-[color:var(--fr-ink-55)]">
                  {copy.columnVendor}
                </th>
                <th scope="col" className="fr-eyebrow px-4 py-3 text-[color:var(--fr-ink-55)]">
                  {copy.columnPurpose}
                </th>
                <th scope="col" className="fr-eyebrow px-4 py-3 text-[color:var(--fr-ink-55)]">
                  {copy.columnData}
                </th>
                <th scope="col" className="fr-eyebrow px-4 py-3 text-[color:var(--fr-ink-55)]">
                  {copy.columnRegion}
                </th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row, index) => (
                <tr
                  key={row.name}
                  className={index % 2 === 0 ? "bg-[color:var(--fr-frost)]" : undefined}
                >
                  <td className="rounded-l-[6px] px-4 py-3 align-top font-semibold text-[color:var(--fr-ink)]">
                    {row.name}
                    {"note" in row && (
                      <span className="block text-[0.8125rem] font-normal text-[color:var(--fr-ink-55)]">
                        {rowCopy[row.note]}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 align-top text-[color:var(--fr-ink-70)]">
                    {rowCopy[row.purpose]}
                  </td>
                  <td className="px-4 py-3 align-top text-[color:var(--fr-ink-70)]">
                    {rowCopy[row.data]}
                  </td>
                  <td className="fr-mono-data rounded-r-[6px] px-4 py-3 align-top text-[0.8125rem] text-[color:var(--fr-ink-70)]">
                    {rowCopy[row.region]}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[0.9375rem] text-[color:var(--fr-ink-55)]">
          <LegalRichText text={copy.listNote} slots={{
            security: <LegalLink href={securityPath}>{copy.securityLink}</LegalLink>,
            privacy: <LegalLink href="/legal/privacy">{copy.privacyLink}</LegalLink>,
          }} />
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="ai" heading={copy.sectionAi}>
        <p>
          <LegalRichText
            text={copy.aiIntro}
            slots={{ featureCount }}
          />
        </p>
        <div className="overflow-x-auto" tabIndex={0}>
          <table className="w-full border-collapse text-[0.9375rem]">
            <thead>
              <tr className="text-left">
                <th scope="col" className="fr-eyebrow px-4 py-3 text-[color:var(--fr-ink-55)]">
                  {copy.columnFeature}
                </th>
                <th scope="col" className="fr-eyebrow px-4 py-3 text-[color:var(--fr-ink-55)]">
                  {copy.columnSends}
                </th>
                <th scope="col" className="fr-eyebrow px-4 py-3 text-[color:var(--fr-ink-55)]">
                  {copy.columnModel}
                </th>
                <th scope="col" className="fr-eyebrow px-4 py-3 text-[color:var(--fr-ink-55)]">
                  {copy.columnDefault}
                </th>
              </tr>
            </thead>
            <tbody>
              {AI_DISCLOSURES.map((row, index) => (
                <tr
                  key={row.key}
                  className={index % 2 === 0 ? "bg-[color:var(--fr-frost)]" : undefined}
                >
                  <td className="rounded-l-[6px] px-4 py-3 align-top font-semibold text-[color:var(--fr-ink)]">
                    {say(row.label)}
                  </td>
                  <td className="px-4 py-3 align-top text-[color:var(--fr-ink-70)]">
                    {say(row.sends)}
                  </td>
                  <td className="fr-mono-data px-4 py-3 align-top text-[0.8125rem] text-[color:var(--fr-ink-70)]">
                    {row.models.join(", ")}
                  </td>
                  <td className="rounded-r-[6px] px-4 py-3 align-top text-[color:var(--fr-ink-70)]">
                    {row.defaultOn ? copy.yes : copy.no}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>{modelVendorSentence(copy.modelVendorPrefix)} {copy.modelVendorAfter}</p>
        <p>
          <strong>{copy.whereLabel}</strong>{" "}
          {say(AI_INFERENCE_LOCATION_STATEMENT)}{" "}
          <LegalRichText text={copy.whereAfter} slots={{
            source: (
              <LegalLink href={AI_INFERENCE_LOCATION_SOURCE}>{copy.sourceLink}</LegalLink>
            ),
            verifiedDate: copy.verifiedDate,
          }} />
        </p>
        <p>{say(AI_INFERENCE_RETENTION_STATEMENT)}</p>
        <p>
          {copy.trainingBefore}{" "}
          <em>&ldquo;{AI_TRAINING_STATEMENT}.&rdquo;</em>{" "}
          {copy.trainingAfter}
        </p>
        {copy.trainingGloss ? <p>{copy.trainingGloss}</p> : null}
        <p>{copy.aiControls}</p>
      </LegalSectionBlock>

      <LegalSectionBlock id="changes" heading={copy.sectionChanges}>
        <p>{copy.changes}</p>
      </LegalSectionBlock>

      <LegalSectionBlock id="contact" heading={copy.sectionContact}>
        <p>
          <LegalRichText text={copy.contact} slots={{
            privacyEmail: (
              <LegalLink href={`mailto:${PRIVACY_EMAIL}`}>{PRIVACY_EMAIL}</LegalLink>
            ),
          }} />
        </p>
      </LegalSectionBlock>
    </LegalPage>
  );
}
