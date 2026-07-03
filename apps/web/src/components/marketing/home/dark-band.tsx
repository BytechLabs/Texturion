/**
 * "Built for the truck" (§H7). The PWA / on-the-job-site beat: JobText runs on
 * the phone your crew already carries, no download, with push notifications and
 * a real dark mode.
 *
 * DESIGN-DIRECTION §3: the deep-petrol band is used exactly ONCE on the page, at
 * the final CTA crescendo. So this section does NOT paint a second dark ground.
 * It stays on the paper panel; the ONE dark element is the real dark-mode phone
 * screenshot (the product genuinely is dark at 6am), framed and contained. The
 * copy carries the story; the dark screenshot carries the proof. No fake "live"
 * dots, no app-store badges (the PWA story is honest).
 */

import { Reveal } from "@/components/marketing/ui/reveal";
import { Section } from "@/components/marketing/ui/section";
import { Display, MarkerCheck } from "@/components/marketing/display";
import { FramedShot } from "@/components/marketing/shot";

const BULLETS = [
  "Works on iPhone, Android, and any computer",
  "Push notifications for new conversations",
  "Nothing to install or update",
] as const;

export function DarkBand() {
  return (
    <Section defer intrinsic={640} className="relative">
      <div className="grid items-center gap-12 lg:grid-cols-[1.1fr_1fr] lg:gap-16">
        <div>
          <p className="font-mono-mkt flex items-center gap-2.5 text-[13px] font-medium tracking-[0.04em] text-[color:var(--graphite)]">
            <span aria-hidden className="h-px w-6 bg-[color:var(--petrol)]/50" />
            On the job site
          </p>
          <Display as="h2" size="h2" className="mt-4">
            Built for the truck, not the{" "}
            <Display.Emph>desk</Display.Emph>.
          </Display>
          <p className="mt-6 text-lg leading-relaxed text-[color:var(--ink-70)]">
            JobText works on every phone your crew already carries: no download,
            no app store, no IT day. Open the link, add it to your home screen,
            and it behaves like an app. Push notifications when a customer texts,
            one-handed replies from the job site, and a dark mode that does not
            blind you at 6am.
          </p>
          <p className="mt-4 text-lg font-medium leading-relaxed text-[color:var(--ink)]">
            Your crew is in before an app store would have finished loading.
          </p>

          <ul className="mt-8 space-y-3">
            {BULLETS.map((b) => (
              <li
                key={b}
                className="flex items-center gap-3 text-[15px] text-[color:var(--ink)]"
              >
                <span className="flex size-6 shrink-0 items-center justify-center">
                  <MarkerCheck className="size-5" color="petrol" draw={false} />
                </span>
                {b}
              </li>
            ))}
          </ul>
        </div>

        {/* The one dark element: a REAL dark-mode phone capture of the running
            app (the product at night). The `dark` scope forces the frame's dark
            tokens so the bezel matches the product-at-night; FramedShot serves
            the captured dark shot. Pre-sized → zero CLS, lazy below the fold. */}
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
    </Section>
  );
}
