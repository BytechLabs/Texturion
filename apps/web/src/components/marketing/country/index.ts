/**
 * Site-wide country selection: the single entry point for the page crews.
 *
 * Import the branch helpers and the country hook from here:
 *   import { CountryOnly, CountryText, useCountry } from "@/components/marketing/country";
 *
 * The provider is mounted once in the (marketing) layout; the CountrySelector
 * lives in the nav and the HeroCountryChooser on the home hero. Everything reads
 * one context, so every surface stays in lockstep.
 */

export {
  COUNTRY_OPTIONS,
  CountryProvider,
  useCountry,
  type Country,
  type CountryLabel,
} from "./country-context";
export { CountryOnly, CountryText } from "./country-only";
export { CountrySelector } from "./country-selector";
export { HeroCountryChooser } from "./hero-country-chooser";
