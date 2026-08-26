import {
  LegalLink,
  LegalPage,
  LegalSectionBlock,
} from "@/components/marketing/legal/legal-page";
import { LegalRichText } from "@/components/marketing/legal/legal-rich-text";
import { PlanPrice } from "@/components/marketing/pricing/plan-price";
import type { MarketingLocale } from "@/i18n/marketing/footer";
import { legalFairUseCopy } from "@/i18n/marketing/legal-fair-use";
import { SUPPORT_EMAIL } from "@/lib/marketing/business";

const EN_PATH = "/legal/fair-use";
const FR_PATH = "/fr/utilisation-equitable";

export function FairUsePageBody({ locale = "en" }: { locale?: MarketingLocale }) {
  const copy = legalFairUseCopy(locale);
  const french = locale === "fr-CA";
  const sections = [
    { id: "why", number: "1", heading: copy.sectionWhy },
    { id: "included", number: "2", heading: copy.sectionIncluded },
    { id: "overage", number: "3", heading: copy.sectionOverage },
    { id: "carrier-limits", number: "4", heading: copy.sectionCarrierLimits },
    { id: "what-for", number: "5", heading: copy.sectionWhatFor },
    { id: "reasonable", number: "6", heading: copy.sectionReasonable },
    { id: "numbers", number: "7", heading: copy.sectionNumbers },
    { id: "add-ons", number: "8", heading: copy.sectionAddOns },
    { id: "storage", number: "9", heading: copy.sectionStorage },
    { id: "enforcement", number: "10", heading: copy.sectionEnforcement },
    { id: "contact", number: "11", heading: copy.sectionContact },
  ];
  const terms = <LegalLink href="/legal/terms">{copy.termsLink}</LegalLink>;
  const aup = <LegalLink href="/legal/aup">{copy.aupLink}</LegalLink>;

  return (
    <LegalPage
      title={copy.title}
      summary={copy.summary}
      lastUpdated={copy.lastUpdated}
      lastUpdatedIso="2026-07-11"
      breadcrumbLabel={copy.breadcrumbLabel}
      path={french ? FR_PATH : EN_PATH}
      sections={sections}
      locale={locale}
    >
      <LegalSectionBlock id="why" number="1" heading={copy.sectionWhy}>
        <p><LegalRichText text={copy.why} slots={{ terms, aup }} /></p>
      </LegalSectionBlock>
      <LegalSectionBlock id="included" number="2" heading={copy.sectionIncluded}>
        <p><LegalRichText text={copy.included} slots={{
          starterPrice: <PlanPrice plan="starter" />,
          proPrice: <PlanPrice plan="pro" />,
          pricing: (
            <LegalLink href={french ? "/fr/tarifs" : "/pricing"}>{copy.pricingLink}</LegalLink>
          ),
        }} /></p>
      </LegalSectionBlock>
      <LegalSectionBlock id="overage" number="3" heading={copy.sectionOverage}>
        <p><LegalRichText text={copy.overage} /></p>
      </LegalSectionBlock>
      <LegalSectionBlock id="carrier-limits" number="4" heading={copy.sectionCarrierLimits}>
        <p><LegalRichText text={copy.carrierOne} /></p>
        <p><LegalRichText text={copy.carrierTwo} /></p>
        <p><LegalRichText text={copy.carrierThree} /></p>
      </LegalSectionBlock>
      <LegalSectionBlock id="what-for" number="5" heading={copy.sectionWhatFor}>
        <p><LegalRichText text={copy.whatFor} slots={{ aup }} /></p>
      </LegalSectionBlock>
      <LegalSectionBlock id="reasonable" number="6" heading={copy.sectionReasonable}>
        <p><LegalRichText text={copy.reasonable} /></p>
      </LegalSectionBlock>
      <LegalSectionBlock id="numbers" number="7" heading={copy.sectionNumbers}>
        <p><LegalRichText text={copy.numbers} slots={{ aup }} /></p>
      </LegalSectionBlock>
      <LegalSectionBlock id="add-ons" number="8" heading={copy.sectionAddOns}>
        <p><LegalRichText text={copy.addOns} /></p>
      </LegalSectionBlock>
      <LegalSectionBlock id="storage" number="9" heading={copy.sectionStorage}>
        <p><LegalRichText text={copy.storage} /></p>
      </LegalSectionBlock>
      <LegalSectionBlock id="enforcement" number="10" heading={copy.sectionEnforcement}>
        <p><LegalRichText text={copy.enforcement} slots={{
          terms,
          aup,
          refunds: (
            <LegalLink href={french ? "/fr/remboursements" : "/legal/refunds"}>
              {copy.refundsLink}
            </LegalLink>
          ),
        }} /></p>
      </LegalSectionBlock>
      <LegalSectionBlock id="contact" number="11" heading={copy.sectionContact}>
        <p><LegalRichText text={copy.contact} slots={{
          supportEmail: (
            <LegalLink href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</LegalLink>
          ),
        }} /></p>
      </LegalSectionBlock>
    </LegalPage>
  );
}
