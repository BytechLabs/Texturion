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
 * S1 · HERO (COPY-DECK v2, DESIGN-DIRECTION v4). Conversion job: make the
 * owner feel last night's missed text in five seconds and put the signup
 * button next to the feeling.
 *
 * The H1 text node is the LCP on every load; the Arrival Field mounts into a
 * pre-sized, absolutely positioned layer behind the inbox card (CLS 0.00)
 * and boots only after the LCP settles (P5-SPEC gating in arrival-layer).
 * The inbox is the REAL conversation-row pattern with the app's own tokens
 * inside the PanelFrame (Law 2); the deck ships it with no caption.
 *
 * Canvas boxes per P5-SPEC: desktop ≥1024px, the hero's right column at a
 * fixed 560px; tablet, a 320px band between the H1 block and the inbox card;
 * mobile, a 200px band directly above the inbox card.
 */
export function Hero() {
  return (
    <section className="bg-[color:var(--fr-ground)] pb-16 pt-14 text-[color:var(--fr-ink)] sm:pt-20 lg:pb-24">
      <div className="mx-auto w-full max-w-[72rem] px-6 md:px-8">
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
              Loonext gives your business one local number and one shared text
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

            <TruthStrip
              className="mt-8 max-w-[36rem]"
              lines={[
                {
                  text: "Your number is live and receiving texts on day one, and Canadian crews can text customers right away. Texting US customers turns on in about a week, once the phone companies approve you. We file everything the minute you pay.",
                  tick: true,
                },
              ]}
            />
          </div>

          {/* RIGHT (5/12): the pre-sized Arrival Field box + the real inbox.
              On mobile/tablet the field is a band above the card; on desktop
              the layer spans the column (plus the gutter) at 560px and the
              card docks at its right edge. */}
          <div className="min-w-0 lg:col-span-5">
            <div className="relative lg:h-[560px]">
              <div className="relative h-[200px] sm:h-[320px] lg:absolute lg:-left-16 lg:inset-y-0 lg:right-0 lg:h-auto">
                <ArrivalLayer />
              </div>
              <div
                {...{ [ARRIVAL_DOCK_ATTR]: "" }}
                className="relative mt-4 lg:absolute lg:right-0 lg:top-1/2 lg:mt-0 lg:w-[22.5rem] lg:max-w-full lg:-translate-y-1/2"
              >
                <PanelFrame
                  chromeUrl="loonext.com/inbox"
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
      </div>
    </section>
  );
}
