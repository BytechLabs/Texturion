import { HomeJsonLd } from "@/components/marketing/home-json-ld";
import { Hero } from "@/components/marketing/hero/hero";
import { Bento } from "@/components/marketing/home/bento";
import { DoTheMath } from "@/components/marketing/home/do-the-math";
import { Faq } from "@/components/marketing/home/faq";
import { FinalCta } from "@/components/marketing/home/final-cta";
import { FixShown } from "@/components/marketing/home/fix-shown";
import { Pattern } from "@/components/marketing/home/pattern";
import { RulesCanada } from "@/components/marketing/home/rules-canada";
import { TheDeal } from "@/components/marketing/home/the-deal";
import { ThreeSteps } from "@/components/marketing/home/three-steps";
import { TruthBar } from "@/components/marketing/home/truth-bar";
import type { MarketingLocale } from "@/i18n/marketing/footer";

/**
 * The home page's eleven sections, composed once for both languages.
 *
 * The route files own the URL and its metadata; this owns the arc. Splitting
 * it this way is what the feature pages already do, and it matters more here:
 * the ordering IS the argument (DESIGN-DIRECTION v4), so two copies of it
 * would be two arguments that drift.
 *
 * `HomeJsonLd` is the WebSite + SoftwareApplication node and renders once per
 * page, per the SEO-lane contract.
 */
export function HomePageBody({
  locale = "en",
}: {
  locale?: MarketingLocale;
}) {
  return (
    <>
      <HomeJsonLd />
      <Hero locale={locale} />
      <TruthBar locale={locale} />
      <Pattern locale={locale} />
      <FixShown locale={locale} />
      <ThreeSteps locale={locale} />
      <Bento locale={locale} />
      <DoTheMath locale={locale} />
      <TheDeal locale={locale} />
      <RulesCanada locale={locale} />
      <Faq locale={locale} />
      <FinalCta locale={locale} />
    </>
  );
}
