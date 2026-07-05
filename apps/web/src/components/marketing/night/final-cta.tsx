import Link from "next/link";

import { Composer, RollNumber } from "@/components/marketing/night/kit";
import { Odometer } from "@/components/marketing/night/odometer";
import { Reveal } from "@/components/marketing/ui/reveal";
import { Section } from "@/components/marketing/ui/section";

/**
 * S7 — Final CTA ("Quiet daylight" v3 spec §6 S7, copy deck S7). The page's
 * ONE dark moment: a flat --ink-11pm band (no vignette, no gradient, no
 * glow), bounded by nothing but its own padding. Centered single column:
 * small mono "Tonight, 9:47 PM" caption, the quiet odometer number, the
 * Besley H2 in --moonlight, one --dusk body line, the composer-styled CTA,
 * and the honesty + reassurance lines. The FAQ that used to live down here
 * is its own light section now (faq.tsx).
 *
 * Requires <NightCss /> mounted above (the integrator does this once) for
 * the nx-roll contract. Server component; the only JS is the ~0.5KB
 * <Odometer> trigger island.
 *
 * HONESTY RULE (task-critical): the composer is a PICTURE of the product's
 * composer wrapped in one real link, never a fake input. Screen readers get
 * exactly one link named "Start for $29 a month" (aria-label on the <a>; the
 * visual inside is aria-hidden).
 *
 * Dark-band focus = 2px --signal-aqua outline (the one place aqua survives).
 */

/* Section CSS, prefix "nxf-". ONE inert style block (repo ledger-css
   pattern), unlayered on purpose so these base declarations beat Tailwind
   utilities. The only transition (CTA rim) is reduced-motion gated; without
   it the state still swaps, just instantly. */
const CSS = `
/* The odometer number: --moonlight, the quiet v3 scale (spec §4), normal
   width (v3 §3: no condensed mono anywhere). */
.nxf-number {
  display: block;
  font-size: clamp(2rem, 4.5vw, 3.5rem);
  font-weight: 500;
  line-height: 1;
  color: var(--moonlight);
}
/* display-h2 paints day-ink (the daylight default); this is the one dark
   band, so the H2 must read moonlight. Unlayered so it wins. */
.nxf-h2 {
  color: var(--moonlight);
}
/* The link-wrapped composer visual. Radius matches the product composer
   (8px) so the focus ring hugs the drawn shape. Dark-ground focus = 2px
   aqua, 2px offset. */
.nxf-cta {
  display: block;
  border-radius: 8px;
}
.nxf-cta:focus-visible {
  outline: 2px solid var(--signal-aqua);
  outline-offset: 2px;
}
/* Hovering/focusing the one real CTA swaps the composer's rim to aqua — a
   border-color change, not a glow. */
.nxf-cta:hover .nxf-composer,
.nxf-cta:focus-visible .nxf-composer {
  border-color: var(--signal-aqua);
}
@media (prefers-reduced-motion: no-preference) {
  .nxf-composer {
    transition: border-color 180ms cubic-bezier(0.2, 0.8, 0.2, 1);
  }
}
`;

export function FinalCta() {
  return (
    <Section
      id="start"
      defer
      intrinsic={680}
      className="ground-night py-20 sm:py-28"
    >
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      <div className="mx-auto flex max-w-3xl flex-col items-center text-center">
        <Reveal>
          <p className="font-mono-mkt text-[0.8125rem] tracking-[0.02em] text-[color:var(--dusk)]">
            Tonight, 9:47 PM
          </p>
        </Reveal>

        {/* The odometer (v3 movement #4). The island arms this wrapper once
            on view; the RollNumber's strips render pre-seated, so no-JS,
            reduced motion, and pre-arm all read the resolved number.
            aria-label is the static accessible name per the copy deck. */}
        <Odometer className="mt-8 w-full">
          <RollNumber
            text="(555) 014-4028"
            label="Your local number, 555 014 4028"
            stagger={36}
            className="nxf-number font-mono-mkt"
          />
        </Odometer>
        <p className="font-mono-mkt mt-3 text-[0.75rem] tracking-[0.04em] text-[color:var(--dusk)]">
          your local number
        </p>

        <Reveal>
          <h2 className="nxf-h2 display-h2 mt-8">Start before tonight’s texts.</h2>
        </Reveal>
        <Reveal>
          <p className="font-body-mkt mt-4 max-w-xl text-base leading-relaxed text-[color:var(--dusk)]">
            Pick a local number, add the crew, and the next 9:47 pm text lands where
            the whole shop can see it.
          </p>
        </Reveal>

        {/* The composer-styled CTA: white input surface, petrol button. One
            real <a>; everything inside is a picture (aria-hidden), so AT
            hears exactly one link. */}
        <Reveal className="mt-10 w-full max-w-xl">
          <Link href="/signup" aria-label="Start for $29 a month" className="nxf-cta">
            <Composer
              aria-hidden="true"
              placeholder="Pick your local number"
              className="nxf-composer"
              button={
                <span className="shrink-0 rounded-lg bg-[color:var(--petrol)] px-4 py-2.5 text-sm font-semibold whitespace-nowrap text-white">
                  Start for $29 a month
                </span>
              }
            />
          </Link>
          {/* Honesty line + reassurance, same size as each other (the
              carrier wait is never smaller than its neighbors). */}
          <p className="font-body-mkt mt-4 text-sm text-[color:var(--dusk)]">
            Canada texts right away. US texting turns on in about a week.
          </p>
          <p className="font-body-mkt mt-1.5 text-sm text-[color:var(--dusk)]">
            Month to month. 30-day money back. No sales calls.
          </p>
        </Reveal>
      </div>
    </Section>
  );
}
