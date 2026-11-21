import {
  FeatureFaq,
  FeatureHero,
  RelatedLinks,
  UseCaseSteps,
} from "@/components/marketing/features/feature-page";
import { PanelFrame } from "@/components/marketing/fr";
import { JsonLd } from "@/components/marketing/ui/json-ld";
import type { MarketingLocale } from "@/i18n/marketing/footer";
import { remindersCopy } from "@/i18n/marketing/reminders";
import { breadcrumbJsonLd } from "@/lib/marketing/seo";
import { LIVE_ROUTES } from "@/lib/marketing/site";
import { localizedPath } from "@/lib/marketing/translated-pages";

export function RemindersPageBody({ locale }: { locale: MarketingLocale }) {
  const copy = remindersCopy(locale);
  return (
    <>
      <JsonLd data={breadcrumbJsonLd([
        { name: copy.home, path: localizedPath(LIVE_ROUTES.home, locale) },
        { name: copy.title, path: localizedPath(LIVE_ROUTES.featuresReminders, locale) },
      ])} />
      <FeatureHero
        locale={locale}
        dateline={copy.dateline}
        title={copy.title}
        sub={copy.intro}
        panel={(
          <PanelFrame caption={copy.example} ariaLabel={copy.example}>
            <div className="space-y-4 bg-[color:var(--fr-frost)] p-5 sm:p-7">
              <dl className="space-y-4">
                <div className="rounded-2xl bg-[color:var(--fr-card)] p-4">
                  <dt className="font-medium text-[color:var(--fr-ink)]">{copy.sent}</dt>
                  <dd className="mt-2 text-[color:var(--fr-ink-70)]">{copy.message}</dd>
                </div>
                <div className="ml-auto w-fit rounded-2xl bg-[color:var(--fr-card)] p-4">
                  <dt className="font-medium text-[color:var(--fr-ink)]">{copy.reply}</dt>
                  <dd className="mt-2 text-[color:var(--fr-ink-70)]">C</dd>
                </div>
              </dl>
              <p className="text-sm font-medium text-[color:var(--fr-ink)]">
                {copy.confirmed}
              </p>
            </div>
          </PanelFrame>
        )}
      />
      <UseCaseSteps ground="frost" heading={copy.steps} steps={[
        { title: copy.ruleTitle, body: copy.ruleBody },
        { title: copy.jobTitle, body: copy.jobBody },
        { title: copy.followTitle, body: copy.followBody },
      ]} />
      <FeatureFaq heading={copy.faq} faqs={[
        { q: copy.consentQuestion, a: copy.consentAnswer },
        { q: copy.replyQuestion, a: copy.replyAnswer },
      ]} />
      <RelatedLinks locale={locale} heading={copy.related} intro={copy.relatedIntro} links={[
        { label: copy.tasks, href: LIVE_ROUTES.featuresTasks, hint: copy.tasksHint },
        { label: copy.inbox, href: LIVE_ROUTES.featuresSharedInbox, hint: copy.inboxHint },
      ]} />
    </>
  );
}
