/**
 * Back-compat re-export. The country context is now SITE-WIDE and lives in
 * components/marketing/country (owner ruling v1, 2026-07-08). The pricing plan
 * components (country-toggle, plan-builder, first-week-timeline, and the
 * plan-builder tests) import from this path; keeping it as a thin re-export
 * means a SINGLE provider and context instance backs BOTH the nav selector and
 * the pricing toggle. There is no second provider.
 *
 * Note: the pricing page no longer wraps its plan section in its own
 * CountryProvider; the marketing layout provides the one site-wide provider, so
 * the nav control and the pricing toggle move the same state. CountryProvider is
 * still exported here for the plan-builder unit tests, which render a branch
 * deterministically with `initialCountry`.
 */

export {
  COUNTRY_OPTIONS,
  CountryProvider,
  useCountry,
  type Country,
  type CountryLabel,
} from "@/components/marketing/country/country-context";
