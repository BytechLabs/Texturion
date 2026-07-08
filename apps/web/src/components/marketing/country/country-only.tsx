"use client";

/**
 * Branch primitives the page crews use to render country-specific content
 * cleanly. SSR renders the default (us); the client swaps after hydration for a
 * returning Canadian (brief flash acceptable, same as the pricing toggle).
 *
 * Two shapes, pick whichever reads best at the call site:
 *
 *   // Block form: whole sections, headings, lists, JSX subtrees.
 *   <CountryOnly country="us">
 *     <p>US texting turns on after carrier approval, about 3 to 7 business days.</p>
 *   </CountryOnly>
 *   <CountryOnly country="ca">
 *     <p>Texting Canadian customers works the same day your number is active.</p>
 *   </CountryOnly>
 *
 *   // Inline form: a phrase, a number, a single word inside a sentence.
 *   You pay <CountryText us="a one-time $29 registration fee" ca="no registration fee" />.
 *
 * Because both read from the single site-wide context, they stay in lockstep
 * with the nav selector and the first-visit chooser.
 */

import { type ReactNode } from "react";

import { useCountry } from "./country-context";
import { type Country } from "./country-storage";

/** Render children only when the active country matches `country`. */
export function CountryOnly({
  country,
  children,
}: {
  country: Country;
  children: ReactNode;
}) {
  const { country: active } = useCountry();
  return active === country ? <>{children}</> : null;
}

/** Inline swap: render the `us` variant or the `ca` variant for the active country. */
export function CountryText({ us, ca }: { us: ReactNode; ca: ReactNode }) {
  const { country } = useCountry();
  return <>{country === "ca" ? ca : us}</>;
}
