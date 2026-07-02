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

import { Check } from "lucide-react";

import { Reveal } from "@/components/marketing/ui/reveal";
import { Section } from "@/components/marketing/ui/section";
import { ThreadDemo } from "@/components/marketing/thread-demo/thread-demo";
import { DARK_BAND_SCRIPT } from "@/components/marketing/thread-demo/script";

const BULLETS = [
  "Works on iPhone, Android, and any computer",
  "Push notifications for new conversations",
  "Nothing to install or update",
] as const;

export function DarkBand() {
  return (
    <Section bleed className="bg-stone-950 py-16 text-stone-50 sm:py-24">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <div className="grid items-center gap-12 lg:grid-cols-[1.1fr_1fr] lg:gap-16">
          <div>
            <h2 className="display-h2 text-stone-50">
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
                    <Check className="size-3" strokeWidth={2.5} aria-hidden />
                  </span>
                  {b}
                </li>
              ))}
            </ul>
          </div>

          {/* Phone-framed dark thread — the product at night. `dark` scope
              forces the app's dark tokens on the thread regardless of theme. */}
          <Reveal className="dark flex justify-center lg:justify-end">
            <ThreadDemo
              script={DARK_BAND_SCRIPT}
              framing="phone"
              pushBanner={{
                title: "JobText",
                body: "Marcus T: No hot water since this morning…",
              }}
              bodyClassName="min-h-[280px] pt-14"
            />
          </Reveal>
        </div>
      </div>
    </Section>
  );
}
