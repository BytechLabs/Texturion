import { FrCard, FrSection } from "@/components/marketing/fr";
import type { MarketingLocale } from "@/i18n/marketing/footer";
import { statusCopy } from "@/i18n/marketing/status";
import { SUPPORT_EMAIL } from "@/lib/marketing/business";

export function StatusResultPage({
  locale = "en",
  result,
}: {
  locale?: MarketingLocale;
  result: "subscribed" | "unsubscribed";
}) {
  const copy = statusCopy(locale);
  const subscribed = result === "subscribed";

  return (
    <FrSection ground="white">
      <div className="mx-auto max-w-2xl">
        <h1 className="fr-h1 text-[color:var(--fr-ink)]">
          {subscribed ? copy.subscribedTitle : copy.unsubscribedTitle}
        </h1>
        <FrCard className="mt-8 p-6 sm:p-8">
          <p className="fr-body text-[color:var(--fr-ink-70)]">
            {subscribed ? copy.subscribedBody : copy.unsubscribedBody}
          </p>
          {subscribed ? (
            <p className="mt-4 text-sm leading-relaxed text-[color:var(--fr-ink-70)]">
              {copy.subscribedDetailBefore}{" "}
              <a
                href={`mailto:${SUPPORT_EMAIL}`}
                className="font-medium text-[color:var(--fr-olive)] underline decoration-[color:var(--fr-olive)]/35 underline-offset-4"
              >
                {SUPPORT_EMAIL}
              </a>
              .
            </p>
          ) : null}
        </FrCard>
      </div>
    </FrSection>
  );
}
