import { CountryText } from "@/components/marketing/country";
import {
  LegalLink,
  LegalPage,
  LegalSectionBlock,
} from "@/components/marketing/legal/legal-page";
import { LegalRichText } from "@/components/marketing/legal/legal-rich-text";
import {
  PlanPrice,
  RegistrationFee,
} from "@/components/marketing/pricing/plan-price";
import type { MarketingLocale } from "@/i18n/marketing/footer";
import { legalTermsCopy } from "@/i18n/marketing/legal-terms";
import { SUPPORT_EMAIL } from "@/lib/marketing/business";
import { localizedPath } from "@/lib/marketing/translated-pages";

/**
 * #328 — the billing section quotes prices, so it must quote the reader's own.
 *
 * Server component rendering client ones (PlanPrice, RegistrationFee,
 * CountryText): fine, the props are plain strings and the CountryProvider is
 * mounted once in the marketing layouts above every page.
 */

export const TERMS_EN_PATH = "/legal/terms";
export const TERMS_FR_PATH = "/fr/conditions-utilisation";
export const TERMS_LAST_UPDATED_ISO = "2026-11-10";

export function TermsPageBody({ locale = "en" }: { locale?: MarketingLocale }) {
  const copy = legalTermsCopy(locale);
  const french = locale === "fr-CA";
  const sections = [
    { id: "agreement", number: "1", heading: copy.sectionAgreement },
    { id: "eligibility", number: "2", heading: copy.sectionEligibility },
    { id: "subscription", number: "3", heading: copy.sectionSubscription },
    { id: "numbers", number: "4", heading: copy.sectionNumbers },
    { id: "acceptable-use", number: "5", heading: copy.sectionAcceptableUse },
    { id: "cancellation", number: "6", heading: copy.sectionCancellation },
    { id: "guarantee", number: "7", heading: copy.sectionGuarantee },
    { id: "availability", number: "8", heading: copy.sectionAvailability },
    { id: "liability", number: "9", heading: copy.sectionLiability },
    { id: "language", number: "10", heading: copy.sectionLanguage },
    { id: "contact", number: "11", heading: copy.sectionContact },
  ];
  const aup = (
    <LegalLink href={localizedPath("/legal/aup", locale)}>{copy.aupLink}</LegalLink>
  );

  return (
    <LegalPage
      title={copy.title}
      summary={copy.summary}
      lastUpdated={copy.lastUpdated}
      lastUpdatedIso={TERMS_LAST_UPDATED_ISO}
      breadcrumbLabel={copy.breadcrumbLabel}
      path={french ? TERMS_FR_PATH : TERMS_EN_PATH}
      sections={sections}
      locale={locale}
    >
      <LegalSectionBlock id="agreement" number="1" heading={copy.sectionAgreement}>
        <p>{copy.agreement}</p>
      </LegalSectionBlock>

      <LegalSectionBlock id="eligibility" number="2" heading={copy.sectionEligibility}>
        <p><LegalRichText text={copy.eligibility} slots={{ aup }} /></p>
      </LegalSectionBlock>

      <LegalSectionBlock id="subscription" number="3" heading={copy.sectionSubscription}>
        <p>
          <LegalRichText
            text={copy.subscriptionOne}
            slots={{
              starter: <PlanPrice plan="starter" />,
              pro: <PlanPrice plan="pro" />,
            }}
          />
        </p>
        <p>
          <LegalRichText text={copy.subscriptionTwo} slots={{ fee: <RegistrationFee /> }} />
        </p>
        <p>
          <LegalRichText
            text={copy.subscriptionThree}
            slots={{
              currency: <CountryText us={copy.currencyUs} ca={copy.currencyCa} />,
            }}
          />
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="numbers" number="4" heading={copy.sectionNumbers}>
        <p>{copy.numbersOne}</p>
        <p>{copy.numbersTwo}</p>
      </LegalSectionBlock>

      <LegalSectionBlock id="acceptable-use" number="5" heading={copy.sectionAcceptableUse}>
        <p><LegalRichText text={copy.acceptableUse} slots={{ aup }} /></p>
      </LegalSectionBlock>

      <LegalSectionBlock id="cancellation" number="6" heading={copy.sectionCancellation}>
        <p>{copy.cancellationOne}</p>
        <p>{copy.cancellationTwo}</p>
      </LegalSectionBlock>

      <LegalSectionBlock id="guarantee" number="7" heading={copy.sectionGuarantee}>
        <p>
          <LegalRichText
            text={copy.guarantee}
            slots={{
              refunds: (
                <LegalLink href={localizedPath("/legal/refunds", locale)}>
                  {copy.refundsLink}
                </LegalLink>
              ),
            }}
          />
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="availability" number="8" heading={copy.sectionAvailability}>
        <p>
          <LegalRichText
            text={copy.availability}
            slots={{
              status: (
                <LegalLink href={localizedPath("/status", locale)}>
                  {copy.statusLink}
                </LegalLink>
              ),
            }}
          />
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="liability" number="9" heading={copy.sectionLiability}>
        <p>{copy.liability}</p>
      </LegalSectionBlock>

      <LegalSectionBlock id="language" number="10" heading={copy.sectionLanguage}>
        <p>{copy.languageOne}</p>
        <p>{copy.languageTwo}</p>
      </LegalSectionBlock>

      <LegalSectionBlock id="contact" number="11" heading={copy.sectionContact}>
        <p>
          <LegalRichText
            text={copy.contact}
            slots={{
              supportEmail: (
                <LegalLink href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</LegalLink>
              ),
              contactPage: (
                <LegalLink href={localizedPath("/contact", locale)}>
                  {copy.contactLink}
                </LegalLink>
              ),
            }}
          />
        </p>
      </LegalSectionBlock>
    </LegalPage>
  );
}
