import { CountryOnly } from "@/components/marketing/country";
import { CtaButton, Dateline, PanelFrame } from "@/components/marketing/fr";
import { TruthStrip } from "@/components/marketing/home/truth-strip";
import {
  PRIMARY_CTA_LABEL,
  SECONDARY_CTA_LABEL,
  SIGNUP_HREF,
} from "@/components/marketing/nav-links";
import { LIVE_ROUTES } from "@/lib/marketing/site";
import { AppSurface } from "@/components/marketing/thread-demo/app-surface";

import { ARRIVAL_DOCK_ATTR } from "./arrival-script";
import { ArrivalLayer } from "./arrival-layer";
import { HeroInbox } from "./hero-inbox";

/**
 * S1 · HERO (COPY-DECK v2, DESIGN-DIRECTION v4, amendment 14). Conversion job:
 * make the owner feel last night's missed text in five seconds and put the
 * signup button next to the feeling.
 *
 * Amendment 14 makes the LIVE p5 "Confluence" field the compositional lead:
 * it is a FULL-BLEED canvas spanning the entire hero (not a right-column box
 * behind the card). A river of divergence-free curl-noise streamlines braids
 * across the whole width and resolves cobalt -> green into the real inbox card
 * docked at the right. The card is now a SECONDARY supporting proof element
 * that the art converges into, not a cover the art hides behind.
 *
 * Legibility without erasing the art: instead of a ground scrim washing the
 * center of the canvas, a narrow gradient lifts the page ground only behind
 * the copy column (desktop: from the left; mobile: from the top), fading to
 * fully transparent well before the center so the art reads full-strength
 * across the middle and right of the hero.
 *
 * The H1 text node stays the LCP; the field mounts into an absolutely
 * positioned, pre-sized full-bleed layer (CLS 0.00) and boots only after the
 * LCP settles (P5-SPEC gating in arrival-layer). The inbox is the REAL
 * conversation-row pattern with the app's own tokens inside the PanelFrame
 * (Law 2); the deck ships it with no caption.
 */
export function Hero() {
  return (
    <section className="relative isolate overflow-hidden bg-[color:var(--fr-ground)] pb-16 pt-14 text-[color:var(--fr-ink)] sm:pt-20 lg:pb-24">
      {/* THE CENTERPIECE: full-bleed live generative art spanning the hero.
          pointer-events none, aria-hidden, sits behind all content (z-0). */}
      <div className="pointer-events-none absolute inset-0 z-0" aria-hidden="true">
        <ArrivalLayer />
      </div>

      {/* Legibility scrim (mobile/tablet): the page ground fades in from the
          TOP behind the stacked copy, then clears so the field runs full
          strength down toward the inbox card. Decorative; above the art,
          below the content. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-0 lg:hidden"
        style={{
          background:
            "linear-gradient(to bottom, var(--fr-ground) 0%, var(--fr-ground) 24%, transparent 62%)",
        }}
      />
      {/* Legibility scrim (desktop): the page ground holds behind the copy
          column on the LEFT and clears before the center, so the art is the
          dominant, unobstructed canvas across the middle and right. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-0 hidden lg:block"
        style={{
          background:
            "linear-gradient(to right, var(--fr-ground) 0%, var(--fr-ground) 22%, transparent 56%)",
        }}
      />

      <div className="relative z-10 mx-auto w-full max-w-[72rem] px-6 md:px-8">
        <div className="grid items-center gap-10 lg:grid-cols-12 lg:gap-8">
          {/* LEFT (7/12): the pitch. The H1 is the LCP; nothing above it but
              the dateline chip. */}
          <div className="lg:col-span-7">
            <Dateline>9:04 PM · TUESDAY</Dateline>

            <h1 className="fr-h1 mt-5 max-w-[16ch]">
              Somebody texted your business at 9:04 last night. Did anybody
              see it?
            </h1>

            <p className="fr-body mt-6 max-w-[56ch] text-[color:var(--fr-ink-70)]">
              Loonext gives your business a local number and a shared text
              inbox. The whole crew reads, replies, assigns, and closes from
              any phone, so the next 9 PM text gets answered by whoever is
              free instead of dying on somebody&apos;s personal cell. $29 a
              month for the whole team, flat.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <CtaButton href={SIGNUP_HREF}>{PRIMARY_CTA_LABEL}</CtaButton>
              <CtaButton href={LIVE_ROUTES.pricing} variant="secondary">
                {SECONDARY_CTA_LABEL}
              </CtaButton>
            </div>

            {/* The truth line branches on the site-wide country context: a US
                visitor reads the honest carrier-wait story, a Canadian visitor
                reads the same-day story. Never both at once. SSR default is US
                (the whole line is complete before hydration). */}
            <CountryOnly country="us">
              <TruthStrip
                className="mt-8 max-w-[36rem]"
                lines={[
                  {
                    text: "Your number is live and receiving texts the day you sign up. Texting US customers turns on in about a week, once the phone companies approve you. We file everything the minute you pay.",
                    tick: true,
                  },
                ]}
              />
            </CountryOnly>
            <CountryOnly country="ca">
              <TruthStrip
                className="mt-8 max-w-[36rem]"
                lines={[
                  {
                    text: "Your number is live the day you sign up, and you can text Canadian customers the same day. No registration, no fee, no waiting. We set you up the minute you pay.",
                    tick: true,
                  },
                ]}
              />
            </CountryOnly>
          </div>

          {/* RIGHT (5/12): the real inbox card, the SECONDARY supporting proof
              element the field resolves into. It carries the dock marker, so
              the live streamlines steer to its left edge and warm to green as
              they settle here. */}
          <div className="min-w-0 lg:col-span-5">
            <div
              {...{ [ARRIVAL_DOCK_ATTR]: "" }}
              className="mx-auto w-full max-w-[22.5rem] lg:ml-auto lg:mr-0"
            >
              <PanelFrame
                ariaLabel="Customer conversations waiting in the Loonext inbox"
              >
                <AppSurface>
                  <HeroInbox />
                </AppSurface>
              </PanelFrame>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
