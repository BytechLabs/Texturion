/**
 * Dark band (Track B) — §3.8 / COPY §H7, "Built for the truck".
 *
 * The ONE dark section per page (BLUEPRINT §1.2): stone-950 background with the
 * app's real dark tokens, forced via a `.dark` scope so the thread renders in
 * its dark-mode primitives regardless of the site theme (it IS the product at
 * night). Left copy, right a phone-framed live-DOM dark thread with a push
 * banner. PWA framed as "works on every phone, no download" — NO app-store
 * badges (§13.6). Copy verbatim from §H7.
 */

import { Reveal } from "@/components/marketing/ui/reveal";
import { LedgerSection } from "@/components/marketing/ledger/ledger-section";
import { SignalCheck } from "@/components/marketing/ledger/signal-check";
import { GradientMesh } from "@/components/marketing/frame/gradient-mesh";
import { FramedShot } from "@/components/marketing/shot";

const BULLETS = [
  "Works on iPhone, Android, and any computer",
  "Push notifications for new conversations",
  "Nothing to install or update",
] as const;

export function DarkBand() {
  return (
    <LedgerSection
      n={8}
      bleed
      defer
      intrinsic={720}
      className="relative overflow-hidden bg-stone-950 py-16 text-stone-50 sm:py-24"
    >
      {/* The dark exception's one contained energy area — a teal screen-light
          wash (§1.2), forced to the dark treatment. */}
      <GradientMesh
        variant="dark"
        placement="bottom-right"
        className="opacity-90"
      />
      <div className="relative mx-auto w-full max-w-6xl px-4 sm:px-6">
        <div className="grid items-center gap-12 lg:grid-cols-[1.1fr_1fr] lg:gap-16">
          <div>
            {/* Section 08 eyebrow — inline on the dark band (spine collapses on
                bleed bands, §2.2); light-on-dark ledger meta. */}
            <p className="jt-meta flex items-center gap-2 text-teal-400">
              <span className="tabular-nums">08</span>
              <span aria-hidden className="h-px w-6 bg-teal-400/40" />
              <span className="text-stone-400">On the job site</span>
            </p>
            <h2 className="display-h2 mt-4 text-stone-50">
              Built for the truck, not the desk.
            </h2>
            <p className="mt-6 text-lg leading-relaxed text-stone-300">
              JobText works on every phone your crew already carries — no
              download, no app store, no IT day. Open the link, add it to your
              home screen, and it behaves like an app: push notifications when a
              customer texts, one-handed replies from the job site, and a dark
              mode that doesn&apos;t blind you at 6am.
            </p>
            <p className="mt-4 text-lg font-medium leading-relaxed text-stone-100">
              Your crew is in before an app store would&apos;ve finished
              loading.
            </p>

            <ul className="mt-8 space-y-3">
              {BULLETS.map((b) => (
                <li key={b} className="flex items-center gap-3 text-[15px] text-stone-200">
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-teal-500/15 text-teal-400">
                    <SignalCheck className="size-3.5 text-teal-400" />
                  </span>
                  {b}
                </li>
              ))}
            </ul>
          </div>

          {/* A REAL phone-framed dark-mode capture of the running app (VISUALS
              §3: "the dark PWA band shows a PhoneFrame + real mobile
              screenshot"). The `dark` scope forces the frame's dark tokens so
              the bezel matches the product-at-night; FramedShot serves the
              captured dark shot. Pre-sized → zero CLS, lazy below the fold. */}
          <Reveal className="dark flex justify-center lg:justify-end">
            <FramedShot
              id="mobile-thread"
              frame="phone"
              className="max-w-[280px]"
              pushBanner={{
                title: "JobText",
                body: "Marcus T: No hot water since this morning…",
              }}
            />
          </Reveal>
        </div>
      </div>
    </LedgerSection>
  );
}
