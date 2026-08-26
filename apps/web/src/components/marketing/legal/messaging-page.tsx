import {
  LegalLink,
  LegalPage,
  LegalSectionBlock,
} from "@/components/marketing/legal/legal-page";
import { LegalRichText } from "@/components/marketing/legal/legal-rich-text";
import type { MarketingLocale } from "@/i18n/marketing/footer";
import { legalMessagingCopy } from "@/i18n/marketing/legal-messaging";
import { SUPPORT_EMAIL } from "@/lib/marketing/business";

const EN_PATH = "/legal/messaging";
const FR_PATH = "/fr/messagerie";

export function MessagingPageBody({ locale = "en" }: { locale?: MarketingLocale }) {
  const copy = legalMessagingCopy(locale);
  const french = locale === "fr-CA";
  const sections = [
    { id: "program", number: "1", heading: copy.sectionProgram },
    { id: "opt-in", number: "2", heading: copy.sectionOptIn },
    { id: "opt-out", number: "3", heading: copy.sectionOptOut },
    { id: "help", number: "4", heading: copy.sectionHelp },
    { id: "frequency", number: "5", heading: copy.sectionFrequency },
    { id: "hours", number: "6", heading: copy.sectionHours },
    { id: "carriers", number: "7", heading: copy.sectionCarriers },
    { id: "privacy", number: "8", heading: copy.sectionPrivacy },
    { id: "contact", number: "9", heading: copy.sectionContact },
  ];
  const supportEmail = (
    <LegalLink href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</LegalLink>
  );
  const contact = (
    <LegalLink href={french ? "/fr/contact" : "/contact"}>{copy.contactLink}</LegalLink>
  );

  return (
    <LegalPage
      title={copy.title}
      summary={copy.summary}
      lastUpdated={copy.lastUpdated}
      lastUpdatedIso="2026-07-03"
      breadcrumbLabel={copy.breadcrumbLabel}
      path={french ? FR_PATH : EN_PATH}
      sections={sections}
      locale={locale}
    >
      <LegalSectionBlock id="program" number="1" heading={copy.sectionProgram}>
        <p>
          <LegalRichText text={copy.program} slots={{
            aup: <LegalLink href="/legal/aup">{copy.aupLink}</LegalLink>,
            terms: <LegalLink href="/legal/terms">{copy.termsLink}</LegalLink>,
          }} />
        </p>
      </LegalSectionBlock>
      <LegalSectionBlock id="opt-in" number="2" heading={copy.sectionOptIn}>
        <p><LegalRichText text={copy.optInOne} /></p>
        <p><LegalRichText text={copy.optInTwo} /></p>
      </LegalSectionBlock>
      <LegalSectionBlock id="opt-out" number="3" heading={copy.sectionOptOut}>
        <p><LegalRichText text={copy.optOut} /></p>
      </LegalSectionBlock>
      <LegalSectionBlock id="help" number="4" heading={copy.sectionHelp}>
        <p><LegalRichText text={copy.help} slots={{ supportEmail, contact }} /></p>
      </LegalSectionBlock>
      <LegalSectionBlock id="frequency" number="5" heading={copy.sectionFrequency}>
        <p><LegalRichText text={copy.frequency} /></p>
      </LegalSectionBlock>
      <LegalSectionBlock id="hours" number="6" heading={copy.sectionHours}>
        <p><LegalRichText text={copy.hoursOne} /></p>
        <p><LegalRichText text={copy.hoursIntro} /></p>
        <ul className="list-disc space-y-2 pl-6">
          <li><LegalRichText text={copy.hoursReply} /></li>
          <li><LegalRichText text={copy.hoursPerson} /></li>
        </ul>
        <p><LegalRichText text={copy.hoursFederal} /></p>
      </LegalSectionBlock>
      <LegalSectionBlock id="carriers" number="7" heading={copy.sectionCarriers}>
        <p><LegalRichText text={copy.carriers} /></p>
      </LegalSectionBlock>
      <LegalSectionBlock id="privacy" number="8" heading={copy.sectionPrivacy}>
        <p><LegalRichText text={copy.privacy} slots={{
          privacy: <LegalLink href="/legal/privacy">{copy.privacyLink}</LegalLink>,
        }} /></p>
      </LegalSectionBlock>
      <LegalSectionBlock id="contact" number="9" heading={copy.sectionContact}>
        <p><LegalRichText text={copy.contact} slots={{ supportEmail, contact }} /></p>
      </LegalSectionBlock>
    </LegalPage>
  );
}
