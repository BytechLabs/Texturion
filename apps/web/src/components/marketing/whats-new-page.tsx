import { WHATS_NEW } from "@loonext/shared";

import { EN, FR_CA } from "@/i18n/catalog";
import type { MarketingLocale } from "@/i18n/marketing/footer";
import { whatsNewCopy } from "@/i18n/marketing/whats-new";
import {
  breadcrumbJsonLd,
  type Breadcrumb,
} from "@/lib/marketing/seo";

import { FrCard, FrSection } from "./fr";
import { Breadcrumbs } from "./ui/breadcrumbs";
import { JsonLd } from "./ui/json-ld";
import { Reveal } from "./ui/reveal";

function say(locale: MarketingLocale, key: string): string {
  const catalogue = locale === "fr-CA" ? FR_CA : EN;
  const [section, name] = key.split(".");
  return (
    (catalogue as unknown as Record<string, Record<string, string>>)[section]?.[
      name
    ] ?? key
  );
}

function readableDate(iso: string, locale: MarketingLocale): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString(
    locale === "fr-CA" ? "fr-CA" : "en-GB",
    {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    },
  );
}

export function WhatsNewPageBody({
  locale = "en",
}: {
  locale?: MarketingLocale;
}) {
  const copy = whatsNewCopy(locale);
  const path = locale === "fr-CA" ? "/fr/nouveautes" : "/whats-new";
  const crumbs: Breadcrumb[] = [
    { name: copy.home, path: locale === "fr-CA" ? "/fr" : "/" },
    { name: copy.breadcrumb, path },
  ];

  return (
    <>
      <JsonLd data={breadcrumbJsonLd(crumbs)} />
      <FrSection>
        <div className="mx-auto max-w-3xl">
          <Breadcrumbs crumbs={crumbs} />
          <h1 className="fr-h1 mt-6 text-[color:var(--fr-ink)]">
            {copy.title}
          </h1>
          <p className="fr-body mt-4 text-[color:var(--fr-ink-70)]">
            {copy.intro}
          </p>

          <ol className="mt-10 space-y-4">
            {WHATS_NEW.map((entry) => (
              <li key={`${entry.date}-${say(locale, entry.title)}`}>
                <Reveal>
                  <FrCard className="p-6">
                    <time
                      dateTime={entry.date}
                      className="text-[0.8125rem] font-medium tabular-nums text-[color:var(--fr-ink-70)]"
                    >
                      {readableDate(entry.date, locale)}
                    </time>
                    <h2 className="fr-h3 mt-2 text-[color:var(--fr-ink)]">
                      {say(locale, entry.title)}
                    </h2>
                    <p className="mt-2 text-[0.9375rem] leading-relaxed text-[color:var(--fr-ink-70)]">
                      {say(locale, entry.body)}
                    </p>
                  </FrCard>
                </Reveal>
              </li>
            ))}
          </ol>

          <p className="mt-10 text-[0.9375rem] text-[color:var(--fr-ink-70)]">
            {copy.closing}
          </p>
        </div>
      </FrSection>
    </>
  );
}
