import type { MarketingLocale } from "@/i18n/marketing/footer";
import { FrSection } from "@/components/marketing/fr";
import { waterHeaterScript } from "@/components/marketing/thread-demo/script";
import { ThreadDeepDiveStatic } from "@/components/marketing/thread-demo/thread-deep-dive-static";

import { LazyThreadDeepDive } from "./lazy-islands";

/**
 * S4 · THE FIX, SHOWN (COPY-DECK v2). Conversion job: prove the product is
 * real and simple enough for the crew, the biggest unspoken objection.
 *
 * The server ships the COMPLETED water-heater thread (ThreadDeepDiveStatic,
 * also the no-JS and reduced-motion frame); the steppable island replaces it
 * in place on viewport approach. The thread renders inside the foundation
 * PanelFrame with app tokens (Law 2) and carries no demo-labeling chip (owner
 * amendment 2026-07-08); the shared deep-dive frames handle that framing.
 */
export function FixShown({
  locale = "en",
}: {
  locale?: MarketingLocale;
} = {}) {
  const script = waterHeaterScript(locale);
  return (
    <FrSection ground="white" id="see-it-work">
      <LazyThreadDeepDive
        script={script}
        locale={locale}
        fallback={<ThreadDeepDiveStatic script={script} locale={locale} />}
      />
    </FrSection>
  );
}
