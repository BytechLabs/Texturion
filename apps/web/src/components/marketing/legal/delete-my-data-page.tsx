import {
  LegalLink,
  LegalPage,
  LegalSectionBlock,
} from "@/components/marketing/legal/legal-page";
import { LegalRichText } from "@/components/marketing/legal/legal-rich-text";
import type { MarketingLocale } from "@/i18n/marketing/footer";
import { legalDeleteMyDataCopy } from "@/i18n/marketing/legal-delete-my-data";
import { PRIVACY_EMAIL } from "@/lib/marketing/business";
import { DELETION_GAPS, type DeletionGap } from "@loonext/shared";

const EN_PATH = "/legal/delete-my-data";
const FR_PATH = "/fr/supprimer-mes-donnees";

export function DeleteMyDataPageBody({
  locale = "en",
}: {
  locale?: MarketingLocale;
}) {
  const copy = legalDeleteMyDataCopy(locale);
  const french = locale === "fr-CA";
  const sections = [
    { id: "account", number: "1", heading: copy.sectionAccount },
    { id: "workspace", number: "2", heading: copy.sectionWorkspace },
    { id: "what-goes", number: "3", heading: copy.sectionWhatGoes },
    { id: "what-stays", number: "4", heading: copy.sectionWhatStays },
    { id: "when", number: "5", heading: copy.sectionWhen },
    { id: "boundary", number: "6", heading: copy.sectionBoundary },
    { id: "help", number: "7", heading: copy.sectionHelp },
  ];
  const boundaryCopy: Record<DeletionGap, string> = {
    contact_form_message: copy.boundaryItem,
  };
  const boundaryItems = DELETION_GAPS.map((gap) => boundaryCopy[gap]);

  return (
    <LegalPage
      title={copy.title}
      summary={copy.summary}
      lastUpdated={copy.lastUpdated}
      lastUpdatedIso="2026-07-26"
      breadcrumbLabel={copy.breadcrumbLabel}
      path={french ? FR_PATH : EN_PATH}
      sections={sections}
      locale={locale}
    >
      <LegalSectionBlock id="account" number="1" heading={copy.sectionAccount}>
        <p><LegalRichText text={copy.accountOne} /></p>
        <p><LegalRichText text={copy.accountTwo} /></p>
      </LegalSectionBlock>

      <LegalSectionBlock id="workspace" number="2" heading={copy.sectionWorkspace}>
        <p><LegalRichText text={copy.workspaceOne} /></p>
      </LegalSectionBlock>

      <LegalSectionBlock id="what-goes" number="3" heading={copy.sectionWhatGoes}>
        <p><LegalRichText text={copy.whatGoesAccount} /></p>
        <p><LegalRichText text={copy.whatGoesWorkspace} /></p>
      </LegalSectionBlock>

      <LegalSectionBlock id="what-stays" number="4" heading={copy.sectionWhatStays}>
        <p><LegalRichText text={copy.whatStaysIntro} /></p>
        <p><LegalRichText text={copy.whatStaysStop} /></p>
        <p><LegalRichText text={copy.whatStaysConsent} /></p>
        <p><LegalRichText text={copy.whatStaysWork} /></p>
      </LegalSectionBlock>

      <LegalSectionBlock id="when" number="5" heading={copy.sectionWhen}>
        <p><LegalRichText text={copy.whenAccount} /></p>
        <p><LegalRichText text={copy.whenWorkspace} /></p>
      </LegalSectionBlock>

      <LegalSectionBlock id="boundary" number="6" heading={copy.sectionBoundary}>
        <p><LegalRichText text={copy.boundaryIntro} /></p>
        <ul>
          {boundaryItems.map((gap) => <li key={gap}>{gap}</li>)}
        </ul>
      </LegalSectionBlock>

      <LegalSectionBlock id="help" number="7" heading={copy.sectionHelp}>
        <p>
          <LegalRichText
            text={copy.helpUser}
            slots={{
              privacyEmail: (
                <LegalLink href={`mailto:${PRIVACY_EMAIL}`}>{PRIVACY_EMAIL}</LegalLink>
              ),
            }}
          />
        </p>
        <p><LegalRichText text={copy.helpCustomer} /></p>
      </LegalSectionBlock>
    </LegalPage>
  );
}
