/**
 * Hero (Track B) — §3.1, the signature moment (§0.1).
 *
 * LCP strategy (BLUEPRINT §3.1, panel resolution): the H1 TEXT is the
 * guaranteed LCP; the centerpiece is live DOM/CSS with NO raster image. The
 * atmosphere is Track A's GlowBackdrop (CSS gradient behind the box, never over
 * LCP text). The thread hydrates after first paint; its server render ships the
 * completed thread as static DOM so LCP + no-JS both show the finished thread.
 *
 * Copy verbatim from COPY §H1. CTAs: "Get your number" → /signup, "See pricing"
 * → /pricing (never "Book a demo"). Truth line is win-first (§0 weapon #5).
 */

import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { GlowBackdrop } from "@/components/marketing/ui/glow-backdrop";
import { Container } from "@/components/marketing/ui/container";
import { ThreadDemo } from "@/components/marketing/thread-demo/thread-demo";
import { WATER_HEATER_SCRIPT } from "@/components/marketing/thread-demo/script";
import { Button } from "@/components/ui/button";
import { HOME_ANCHORS } from "@/lib/marketing/site";

export function Hero() {
  return (
    <section className="relative overflow-hidden pb-16 pt-28 sm:pb-24 sm:pt-32">
      {/* The ONE petrol/amber atmosphere, behind the LCP box (Track A). */}
      <GlowBackdrop />

      <Container>
        <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-16">
          {/* Left: text — the LCP lives here. */}
          <div>
            <p className="text-[13px] font-semibold text-primary">
              Business texting for service crews
            </p>
            <h1 className="display-hero mt-4 text-balance text-foreground">
              Every customer text, in one inbox your whole crew can see.
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground">
              JobText gives your business its own local number for texting.
              Everyone on the team can read, reply, assign, and close
              conversations — from any phone. One flat price for the whole crew:
              $29 a month. No contracts, no sales calls. Ever.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
              <Button asChild size="lg">
                <Link href="/signup">
                  Get your number
                  <ArrowRight strokeWidth={1.75} aria-hidden />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                {/* /pricing ships later; lands on the on-page pricing beat until
                    then (site.ts guard) — zero dead links. */}
                <Link href={HOME_ANCHORS.pricing}>See pricing</Link>
              </Button>
            </div>

            {/* Truth line as a designed micro-feature, not fine print (§3.1). */}
            <p className="mt-6 max-w-xl text-[13px] leading-relaxed text-muted-foreground">
              <span className="font-medium text-foreground">
                Day one: your number is live and receiving texts,
              </span>{" "}
              and texting Canadian customers works right away. Texting US
              customers turns on in about a week, once the phone companies
              approve you — we file everything the minute you pay.
            </p>
          </div>

          {/* Right: the live-DOM centerpiece — no raster (LCP-safe). */}
          <div className="relative">
            <ThreadDemo
              script={WATER_HEATER_SCRIPT}
              framing="desktop"
              bodyClassName="min-h-[360px]"
            />
          </div>
        </div>

        {/* Quiet scroll affordance to the how-it-works walkthrough. */}
        <div className="mt-12 flex justify-center lg:mt-16">
          <a
            href="#how-it-works"
            className="text-[13px] font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            See how it works ↓
          </a>
        </div>
      </Container>
    </section>
  );
}
