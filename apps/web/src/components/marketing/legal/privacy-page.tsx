import {
  AI_DISCLOSURES,
  AI_INFERENCE_LOCATION_STATEMENT,
  AI_INFERENCE_RETENTION_STATEMENT,
  AI_TRAINING_STATEMENT,
  SUBPROCESSORS,
} from "@loonext/shared";

import {
  LegalLink,
  LegalPage,
  LegalSectionBlock,
} from "@/components/marketing/legal/legal-page";
import { LegalRichText } from "@/components/marketing/legal/legal-rich-text";
import { CATALOGS } from "@/i18n/catalog";
import type { MarketingLocale } from "@/i18n/marketing/footer";
import { legalSubprocessorsCopy } from "@/i18n/marketing/legal-subprocessors";
import { legalPrivacyCopy } from "@/i18n/marketing/legal-privacy";
import {
  LEGAL_ENTITY_NAME,
  MAILING_ADDRESS,
  PRIVACY_EMAIL,
} from "@/lib/marketing/business";
import { localizedPath } from "@/lib/marketing/translated-pages";

export const PRIVACY_EN_PATH = "/legal/privacy";
export const PRIVACY_FR_PATH = "/fr/confidentialite";

const LIST = "list-disc space-y-2 pl-6";

export function PrivacyPageBody({ locale = "en" }: { locale?: MarketingLocale }) {
  const copy = legalPrivacyCopy(locale);
  const french = locale === "fr-CA";
  // `catalog.ts` is plain data, safe on the server; the provider's own
  // translator is a client module and would fail the build here.
  const catalogue = CATALOGS[locale];
  const say = (key: string): string => {
    const [section, name] = key.split(".");
    return (
      (catalogue as unknown as Record<string, Record<string, string>>)[section]?.[name] ?? key
    );
  };

  const sections = [
    { id: "scope", number: "1", heading: copy.sectionScope },
    { id: "what-we-collect", number: "2", heading: copy.sectionCollect },
    { id: "why", number: "3", heading: copy.sectionWhy },
    { id: "sms-consent", number: "4", heading: copy.sectionSmsConsent },
    { id: "where", number: "5", heading: copy.sectionWhere },
    { id: "on-your-phone", number: "5a", heading: copy.sectionPhone },
    { id: "your-calendar", number: "5b", heading: copy.sectionCalendar },
    { id: "sharing", number: "6", heading: copy.sectionSharing },
    { id: "ai", number: "7", heading: copy.sectionAi },
    { id: "retention", number: "8", heading: copy.sectionRetention },
    { id: "your-rights", number: "9", heading: copy.sectionRights },
    { id: "law-25", number: "10", heading: copy.sectionLaw25 },
    { id: "security", number: "11", heading: copy.sectionSecurity },
    { id: "contact", number: "12", heading: copy.sectionContact },
  ];

  const subprocessors = (
    <LegalLink href={localizedPath("/legal/subprocessors", locale)}>
      {copy.subprocessorsLink}
    </LegalLink>
  );
  const remove = (
    <LegalLink href={localizedPath("/legal/delete-my-data", locale)}>
      {copy.deleteLink}
    </LegalLink>
  );
  const privacyEmail = (
    <LegalLink href={`mailto:${PRIVACY_EMAIL}`}>{PRIVACY_EMAIL}</LegalLink>
  );
  const aiFeatures = new Intl.ListFormat(locale, {
    style: "long",
    type: "conjunction",
  }).format(AI_DISCLOSURES.map((row) => say(row.label)));

  const vendorCopy = legalSubprocessorsCopy(locale);
  const vendors = SUBPROCESSORS.map((row) =>
    "note" in row ? `${row.name} (${vendorCopy[row.note]})` : row.name,
  );

  return (
    <LegalPage
      title={copy.title}
      summary={copy.summary}
      lastUpdated={copy.lastUpdated}
      lastUpdatedIso="2026-11-17"
      breadcrumbLabel={copy.breadcrumbLabel}
      path={french ? PRIVACY_FR_PATH : PRIVACY_EN_PATH}
      sections={sections}
      locale={locale}
    >
      <LegalSectionBlock id="scope" number="1" heading={copy.sectionScope}>
        {LEGAL_ENTITY_NAME ? (
          <p><LegalRichText text={copy.operator} slots={{ entity: LEGAL_ENTITY_NAME }} /></p>
        ) : null}
        <p><LegalRichText text={copy.scope} /></p>
      </LegalSectionBlock>

      <LegalSectionBlock id="what-we-collect" number="2" heading={copy.sectionCollect}>
        <p>{copy.collectIntro}</p>
        <ul className={LIST}>
          <li><LegalRichText text={copy.collectAccount} /></li>
          <li><LegalRichText text={copy.collectContact} /></li>
          <li><LegalRichText text={copy.collectBilling} /></li>
          <li><LegalRichText text={copy.collectDevice} /></li>
          <li>
            <LegalRichText
              text={copy.collectAnalytics}
              slots={{
                cookies: (
                  <LegalLink href={localizedPath("/legal/cookies", locale)}>
                    {copy.cookiesLink}
                  </LegalLink>
                ),
              }}
            />
          </li>
        </ul>
      </LegalSectionBlock>

      <LegalSectionBlock id="why" number="3" heading={copy.sectionWhy}>
        <p>{copy.why}</p>
      </LegalSectionBlock>

      <LegalSectionBlock id="sms-consent" number="4" heading={copy.sectionSmsConsent}>
        <p className="rounded-xl bg-[color:var(--fr-frost)] p-4 text-[color:var(--fr-ink)]">
          <LegalRichText text={copy.smsConsentCallout} />
        </p>
        <p>{copy.smsConsentBody}</p>
      </LegalSectionBlock>

      <LegalSectionBlock id="where" number="5" heading={copy.sectionWhere}>
        <p>
          <LegalRichText
            text={copy.whereOne}
            slots={{ region: <span className="fr-mono-data">us-east-1</span> }}
          />
        </p>
        <p>
          <LegalRichText
            text={copy.whereTwo}
            slots={{
              location: say(AI_INFERENCE_LOCATION_STATEMENT),
              retention: say(AI_INFERENCE_RETENTION_STATEMENT),
            }}
          />
        </p>
        <p>
          <LegalRichText
            text={copy.whereThree}
            slots={{
              subprocessors,
              osmPrivacy: (
                <LegalLink href="https://osmfoundation.org/wiki/Privacy_Policy">
                  {copy.osmPrivacyLink}
                </LegalLink>
              ),
            }}
          />
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="on-your-phone" number="5a" heading={copy.sectionPhone}>
        <p>{copy.phoneIntro}</p>
        <ul>
          <li><LegalRichText text={copy.phoneSignIn} /></li>
          <li><LegalRichText text={copy.phoneRecent} /></li>
          <li><LegalRichText text={copy.phoneOffline} /></li>
        </ul>
        <p><LegalRichText text={copy.phoneDeleted} /></p>
        <p>
          <LegalRichText
            text={copy.phoneNotifications}
            slots={{ pushSwitch: say("settingsMore.pushContentLabel") }}
          />
        </p>
        <p><LegalRichText text={copy.phoneLock} /></p>
        <p><LegalRichText text={copy.phoneHandOver} /></p>
        <p><LegalRichText text={copy.phonePhotos} /></p>
        <p><LegalRichText text={copy.phoneAddressBook} /></p>
      </LegalSectionBlock>

      <LegalSectionBlock id="your-calendar" number="5b" heading={copy.sectionCalendar}>
        <p>{copy.calendarIntro}</p>
        <ul className={LIST}>
          <li><LegalRichText text={copy.calendarAsk} /></li>
          <li><LegalRichText text={copy.calendarWrite} /></li>
          <li><LegalRichText text={copy.calendarKeep} /></li>
          <li><LegalRichText text={copy.calendarSee} /></li>
        </ul>
        <p><LegalRichText text={copy.calendarGoogle} /></p>
        <p><LegalRichText text={copy.calendarEnding} /></p>
      </LegalSectionBlock>

      <LegalSectionBlock id="sharing" number="6" heading={copy.sectionSharing}>
        <p><LegalRichText text={copy.sharingOne} slots={{
          subprocessors,
          vendors: new Intl.ListFormat(locale).format(vendors),
        }} /></p>
        <p>{copy.sharingTwo}</p>
        <p>{copy.sharingThree}</p>
      </LegalSectionBlock>

      <LegalSectionBlock id="ai" number="7" heading={copy.sectionAi}>
        <p>
          <LegalRichText
            text={copy.aiOne}
            slots={{
              featureCount: String(AI_DISCLOSURES.length),
              features: aiFeatures,
              subprocessors,
            }}
          />
        </p>
        <p>
          <LegalRichText
            text={copy.aiTwo}
            slots={{ training: <em>&ldquo;{AI_TRAINING_STATEMENT}.&rdquo;</em> }}
          />
        </p>
        <p>{copy.aiThree}</p>
      </LegalSectionBlock>

      <LegalSectionBlock id="retention" number="8" heading={copy.sectionRetention}>
        <p>{copy.retentionOne}</p>
        <p><LegalRichText text={copy.retentionTwo} slots={{ delete: remove }} /></p>
        <p><LegalRichText text={copy.retentionThree} /></p>
        <p><LegalRichText text={copy.retentionFour} /></p>
        <p><LegalRichText text={copy.retentionFive} slots={{ privacyEmail }} /></p>
      </LegalSectionBlock>

      <LegalSectionBlock id="your-rights" number="9" heading={copy.sectionRights}>
        <p>
          <LegalRichText text={copy.rights} slots={{ delete: remove, privacyEmail }} />
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="law-25" number="10" heading={copy.sectionLaw25}>
        <p>
          <LegalRichText
            text={copy.law25}
            slots={{
              officer: copy.officerTitle,
              privacyEmail,
            }}
          />
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="security" number="11" heading={copy.sectionSecurity}>
        <p>
          <LegalRichText
            text={copy.security}
            slots={{
              security: (
                <LegalLink href={localizedPath("/security", locale)}>
                  {copy.securityLink}
                </LegalLink>
              ),
            }}
          />
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="contact" number="12" heading={copy.sectionContact}>
        <p><LegalRichText text={copy.contact} slots={{ privacyEmail }} /></p>
        {MAILING_ADDRESS ? <address className="not-italic">{MAILING_ADDRESS}</address> : null}
      </LegalSectionBlock>
    </LegalPage>
  );
}
