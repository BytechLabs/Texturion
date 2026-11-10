import {
  LegalLink,
  LegalPage,
  LegalSectionBlock,
} from "@/components/marketing/legal/legal-page";
import { LegalRichText } from "@/components/marketing/legal/legal-rich-text";
import type { MarketingLocale } from "@/i18n/marketing/footer";
import { legalAupCopy } from "@/i18n/marketing/legal-aup";
import { SUPPORT_EMAIL } from "@/lib/marketing/business";
import { localizedPath } from "@/lib/marketing/translated-pages";

export const AUP_EN_PATH = "/legal/aup";
export const AUP_FR_PATH = "/fr/utilisation-acceptable";

const LIST = "list-disc space-y-2 pl-6";

export function AupPageBody({ locale = "en" }: { locale?: MarketingLocale }) {
  const copy = legalAupCopy(locale);
  const french = locale === "fr-CA";
  const sections = [
    { id: "why", number: "1", heading: copy.sectionWhy },
    { id: "consent", number: "2", heading: copy.sectionConsent },
    { id: "no-lists", number: "3", heading: copy.sectionNoLists },
    { id: "shaft", number: "4", heading: copy.sectionShaft },
    { id: "opt-out", number: "5", heading: copy.sectionOptOut },
    { id: "identification", number: "6", heading: copy.sectionIdentification },
    { id: "no-abuse", number: "7", heading: copy.sectionNoAbuse },
    { id: "enforcement", number: "8", heading: copy.sectionEnforcement },
    { id: "contact", number: "9", heading: copy.sectionContact },
  ];
  const email = (
    <LegalLink href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</LegalLink>
  );

  return (
    <LegalPage
      title={copy.title}
      summary={copy.summary}
      lastUpdated={copy.lastUpdated}
      lastUpdatedIso="2026-07-02"
      breadcrumbLabel={copy.breadcrumbLabel}
      path={french ? AUP_FR_PATH : AUP_EN_PATH}
      sections={sections}
      locale={locale}
    >
      <LegalSectionBlock id="why" number="1" heading={copy.sectionWhy}>
        <p>
          <LegalRichText
            text={copy.why}
            slots={{
              terms: (
                <LegalLink href={localizedPath("/legal/terms", locale)}>
                  {copy.termsLink}
                </LegalLink>
              ),
            }}
          />
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="consent" number="2" heading={copy.sectionConsent}>
        <p>{copy.consent}</p>
      </LegalSectionBlock>

      <LegalSectionBlock id="no-lists" number="3" heading={copy.sectionNoLists}>
        <p>{copy.noLists}</p>
      </LegalSectionBlock>

      <LegalSectionBlock id="shaft" number="4" heading={copy.sectionShaft}>
        <p><LegalRichText text={copy.shaftIntro} /></p>
        <ul className={LIST}>
          <li>{copy.shaftOne}</li>
          <li>{copy.shaftTwo}</li>
          <li>{copy.shaftThree}</li>
          <li>{copy.shaftFour}</li>
          <li>{copy.shaftFive}</li>
          <li>{copy.shaftSix}</li>
        </ul>
        <p>{copy.shaftEnd}</p>
      </LegalSectionBlock>

      <LegalSectionBlock id="opt-out" number="5" heading={copy.sectionOptOut}>
        <p>{copy.optOut}</p>
      </LegalSectionBlock>

      <LegalSectionBlock id="identification" number="6" heading={copy.sectionIdentification}>
        <p>{copy.identification}</p>
      </LegalSectionBlock>

      <LegalSectionBlock id="no-abuse" number="7" heading={copy.sectionNoAbuse}>
        <p>{copy.noAbuse}</p>
      </LegalSectionBlock>

      <LegalSectionBlock id="enforcement" number="8" heading={copy.sectionEnforcement}>
        <p>{copy.enforcementIntro}</p>
        <p className="font-medium">{copy.enforcementLookHeading}</p>
        <p>{copy.enforcementLookOne}</p>
        <p>{copy.enforcementLookTwo}</p>
        <p className="font-medium">{copy.enforcementStepsHeading}</p>
        <ul className={LIST}>
          <li><LegalRichText text={copy.stepAsk} /></li>
          <li><LegalRichText text={copy.stepRateLimit} /></li>
          <li><LegalRichText text={copy.stepSuspend} /></li>
          <li><LegalRichText text={copy.stepTerminate} /></li>
        </ul>
        <p>{copy.enforcementPerson}</p>
        <p className="font-medium">{copy.enforcementSkipHeading}</p>
        <p>{copy.enforcementSkip}</p>
      </LegalSectionBlock>

      <LegalSectionBlock id="contact" number="9" heading={copy.sectionContact}>
        <p><LegalRichText text={copy.contactOne} slots={{ supportEmail: email }} /></p>
        <p><LegalRichText text={copy.contactTwo} /></p>
      </LegalSectionBlock>
    </LegalPage>
  );
}
