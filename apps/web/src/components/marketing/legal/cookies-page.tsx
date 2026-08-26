import { ConsentPreferences } from "@/components/marketing/consent";
import {
  LegalLink,
  LegalPage,
  LegalSectionBlock,
} from "@/components/marketing/legal/legal-page";
import { LegalRichText } from "@/components/marketing/legal/legal-rich-text";
import type { MarketingLocale } from "@/i18n/marketing/footer";
import { legalCookiesCopy } from "@/i18n/marketing/legal-cookies";
import { SUPPORT_EMAIL } from "@/lib/marketing/business";

const EN_PATH = "/legal/cookies";
const FR_PATH = "/fr/temoins";

export function CookiesPageBody({ locale = "en" }: { locale?: MarketingLocale }) {
  const copy = legalCookiesCopy(locale);
  const french = locale === "fr-CA";
  const sections = [
    { id: "short", number: "1", heading: copy.sectionShort },
    { id: "essential", number: "2", heading: copy.sectionEssential },
    { id: "consent", number: "3", heading: copy.sectionConsent },
    { id: "analytics", number: "4", heading: copy.sectionAnalytics },
    { id: "storage", number: "5", heading: copy.sectionStorage },
    { id: "choices", number: "6", heading: copy.sectionChoices },
    { id: "contact", number: "7", heading: copy.sectionContact },
  ];
  const privacy = <LegalLink href="/legal/privacy">{copy.privacyLink}</LegalLink>;
  const subprocessors = (
    <LegalLink href={french ? "/fr/sous-traitants" : "/legal/subprocessors"}>
      {copy.subprocessorsLink}
    </LegalLink>
  );

  return (
    <LegalPage
      title={copy.title}
      summary={copy.summary}
      lastUpdated={copy.lastUpdated}
      lastUpdatedIso="2026-08-01"
      breadcrumbLabel={copy.breadcrumbLabel}
      path={french ? FR_PATH : EN_PATH}
      sections={sections}
      locale={locale}
    >
      <LegalSectionBlock id="short" number="1" heading={copy.sectionShort}>
        <p><LegalRichText text={copy.short} slots={{ privacy }} /></p>
      </LegalSectionBlock>
      <LegalSectionBlock id="essential" number="2" heading={copy.sectionEssential}>
        <p><LegalRichText text={copy.essentialIntro} /></p>
        <ul>
          <li><LegalRichText text={copy.essentialSession} /></li>
          <li><LegalRichText text={copy.essentialWorkspace} /></li>
          <li><LegalRichText text={copy.essentialChoice} /></li>
        </ul>
        <p><LegalRichText text={copy.essentialEnd} /></p>
      </LegalSectionBlock>
      <LegalSectionBlock id="consent" number="3" heading={copy.sectionConsent}>
        <p><LegalRichText text={copy.consentOne} /></p>
        <p><LegalRichText text={copy.consentTwo} slots={{ subprocessors }} /></p>
      </LegalSectionBlock>
      <LegalSectionBlock id="analytics" number="4" heading={copy.sectionAnalytics}>
        <p><LegalRichText text={copy.analytics} slots={{ subprocessors }} /></p>
      </LegalSectionBlock>
      <LegalSectionBlock id="storage" number="5" heading={copy.sectionStorage}>
        <p><LegalRichText text={copy.storageOne} /></p>
        <p><LegalRichText text={copy.storageTwo} /></p>
      </LegalSectionBlock>
      <LegalSectionBlock id="choices" number="6" heading={copy.sectionChoices}>
        <p><LegalRichText text={copy.choicesIntro} /></p>
        <ConsentPreferences locale={locale} />
        <noscript><p><LegalRichText text={copy.choicesNoScript} /></p></noscript>
        <p><LegalRichText text={copy.choicesBrowser} /></p>
      </LegalSectionBlock>
      <LegalSectionBlock id="contact" number="7" heading={copy.sectionContact}>
        <p><LegalRichText text={copy.contact} slots={{
          supportEmail: (
            <LegalLink href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</LegalLink>
          ),
          privacy,
        }} /></p>
      </LegalSectionBlock>
    </LegalPage>
  );
}
