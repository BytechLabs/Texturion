/**
 * S1 — the hero (v3 "Quiet daylight" spec §6 S1, copy deck S1).
 *
 * Porcelain ground (the .mkt-scope default --paper; no vignette, no dark, no
 * glow), 7/5 split: the pitch left, ONE clean thread card right (panel-card,
 * living DOM via the night kit — never a raster). The H1 is the LCP: a
 * server-rendered text node in full color from the first frame.
 *
 * MOTION (spec §4; night-css v3 contract): this server markup IS the finished
 * scene — bubble landed, ticks delivered, dot steady — so no-JS and
 * reduced-motion users read it untouched. <HeroReplay /> (the only client JS
 * here) arms data-anim="replay" on this section once for motion-tolerant
 * users; arming IS firing, and the keyframes play the whole beat:
 * the inbound bubble soft-LANDs (300ms, 250ms delay — the bare .nx-land
 * defaults), the unread dot double-pulses in step with it, and the delivery
 * ticks run queued → sent → delivered from 700ms (--nx-tick-delay below), all
 * resolved by ~2.2s. Opacity/transform only, so the replay can never shift
 * layout under the LCP.
 *
 * NOT deferred (spec: hero and the first section after it stay undeferred),
 * and <NightCss /> must already be mounted above this section by the
 * integrator or the nx- classes do not exist.
 */

import Link from "next/link";

import { Container } from "@/components/marketing/ui/container";
import {
  InBubble,
  OutBubble,
  UnreadDot,
} from "@/components/marketing/night/kit";

import { HeroReplay } from "./hero-replay";

export function NightHero() {
  return (
    <section
      id="tonight"
      className="scroll-mt-20 pb-16 pt-28 sm:pb-24 sm:pt-32"
    >
      {/* Arms the one-shot replay on this section root; renders nothing. */}
      <HeroReplay />

      <Container>
        <div className="grid items-center gap-12 lg:grid-cols-12 lg:gap-10">
          {/* LEFT (7/12) — the pitch. The H1 text node is the guaranteed LCP:
              no raster anywhere in the hero. No eyebrow (v3 §1: the H1 itself
              is the only clock on the page). */}
          <div className="lg:col-span-7">
            <h1 className="display-hero max-w-[14ch]">
              Your best lead texts at 9:47 pm.
            </h1>

            <p className="mt-6 max-w-[52ch] text-base leading-[1.65] text-[color:var(--ink-70)] sm:text-[1.0625rem]">
              JobText gives your shop one local number and a shared inbox the
              whole crew can see. Every customer text gets answered, assigned,
              and closed. $29 a month flat for the team, not per person.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-3">
              {/* Primary CTA: petrol fill, white text; focus on light = 2px
                  petrol outline. Hover moves opacity only. */}
              <Link
                href="/signup"
                className="inline-flex items-center justify-center rounded-lg bg-[color:var(--petrol)] px-5 py-2.5 text-[0.9375rem] font-semibold text-white transition-opacity duration-200 hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--petrol)]"
              >
                Start with one number
              </Link>
              {/* Quiet pricing link: petrol text link, same-page anchor. */}
              <Link
                href="#pricing"
                className="rounded-sm text-[0.9375rem] font-medium text-[color:var(--petrol)] underline decoration-1 underline-offset-4 transition-colors duration-200 hover:text-[color:var(--day-ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--petrol)]"
              >
                See pricing
              </Link>
            </div>

            {/* Honesty microline: the carrier-approval truth may never be
                hidden or shrunk below its neighbors. */}
            <p className="mt-5 max-w-[46ch] text-sm leading-[1.5] text-[color:var(--ink-55)]">
              Canada texts right away. US numbers take about a week for carrier
              approval. We show you the countdown.
            </p>
          </div>

          {/* RIGHT (5/12) — ONE clean thread card: slim header row + the two
              verbatim bubbles. No conversation list, no quiet-hours dialog,
              no composer (v3 §6 S1: the card is the hero's only ornament). */}
          <div className="min-w-0 lg:col-span-5">
            <section
              // Distinct from S3's deck-verbatim stage label: two landmarks
              // sharing one accessible name is an AT navigation trap, and the
              // deck defines the "Demo:" string for the S3 stage only.
              aria-label="Preview: a Reyes Plumbing conversation in the JobText inbox"
              className="panel-card font-body-mkt overflow-hidden rounded-xl text-left text-sm leading-[1.45] text-[color:var(--day-ink)]"
            >
              {/* Slim header row: name · unread dot · mono "now". The dot's
                  double-pulse is timed to the inbound bubble's land (250ms). */}
              <header className="flex items-center gap-2 border-b border-[color:var(--rule-light)] px-4 py-2.5 sm:px-5">
                <span className="min-w-0 truncate text-[0.8125rem] font-semibold">
                  Dana Whitfield
                </span>
                <UnreadDot
                  className="shrink-0"
                  style={{ "--nx-delay": "250ms" } as React.CSSProperties}
                />
                <span className="font-mono-mkt ml-auto shrink-0 text-[0.6875rem] text-[color:var(--ink-55)]">
                  now
                </span>
              </header>

              <ul aria-label="Conversation" className="flex flex-col gap-2.5 p-4 sm:p-5">
                {/* The 9:47 pm text — the one landing message. Bare .nx-land
                    is already the spec's 300ms / 250ms. */}
                <InBubble className="nx-land">
                  Hi, saw your truck on Cedar St. Our water heater is leaking
                  into the garage. Too late to text?
                </InBubble>

                {/* The reply: static bubble, ticks step once from 700ms (after
                    the inbound has settled), delivered by 1.5s. The append
                    slot carries the page's ONLY dash — the product's literal
                    auto-append line, UI truth. */}
                <OutBubble
                  style={{ "--nx-tick-delay": "700ms" } as React.CSSProperties}
                  append="— Reyes Plumbing. Reply STOP to opt out."
                >
                  Not too late. Shut the cold valve on top of the tank if you
                  can reach it. We can be there at 8 tomorrow morning.
                </OutBubble>
              </ul>
            </section>
          </div>
        </div>
      </Container>
    </section>
  );
}
