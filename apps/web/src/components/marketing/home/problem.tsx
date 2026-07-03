/**
 * The problem (§H3), the "that's my chaos" recognition beat. The human moment is
 * a real, duotone-graded photo of a shop owner buried in his phone; the three
 * pains read as a ruled register (not a 1/1/1 card grid), which keeps the
 * silhouette different from the sections around it.
 *
 * DESIGN-DIRECTION §0: no section number, no ledger spine. A composed <Display>
 * headline carries the promise; the marker highlights "one phone", the true pain.
 * Sits on the paper ground. Server component.
 */

import { PhoneOff, Smartphone, UserX } from "lucide-react";

import { Reveal } from "@/components/marketing/ui/reveal";
import { Section } from "@/components/marketing/ui/section";
import { Display } from "@/components/marketing/display";
import { PhotoFrame } from "@/components/marketing/photo-frame";

const ROWS = [
  {
    icon: Smartphone,
    title: "Buried on one phone.",
    body:
      "Quotes, bookings, and “is he coming today?” all land on the owner's personal cell, in between the family group chat. Whoever has the phone has the business.",
  },
  {
    icon: UserX,
    title: "Nobody knows who answered.",
    body:
      "Did anyone get back to the Hendersons about Thursday? You can't tell without asking around. Two people reply, or nobody does.",
  },
  {
    icon: PhoneOff,
    title: "The number leaves with the phone.",
    body:
      "When a tech moves on, their conversations, their contacts, and sometimes their customers go with them. The business should own its own number.",
  },
] as const;

export function Problem() {
  return (
    <Section defer intrinsic={560}>
      <div className="grid items-center gap-8 lg:grid-cols-[1.05fr_1fr] lg:gap-14">
        <Reveal className="max-w-2xl">
          <p className="font-mono-mkt flex items-center gap-2.5 text-[13px] font-medium tracking-[0.04em] text-[color:var(--graphite)]">
            <span aria-hidden className="h-px w-6 bg-[color:var(--petrol)]/50" />
            The problem
          </p>
          <Display as="h2" size="h2" className="mt-4">
            Your business runs on texts. Your texts run on{" "}
            <Display.Mark>one phone</Display.Mark>.
          </Display>
          <p className="mt-5 text-lg leading-relaxed text-[color:var(--ink-70)]">
            Customers would rather text than call, so they text whoever&apos;s
            number they have. That works until it doesn&apos;t.
          </p>
        </Reveal>

        {/* The recognition photo: a real owner reading a customer text, in the
            one duotone frame language, with a true corner label. */}
        <Reveal className="w-full lg:justify-self-end">
          <PhotoFrame
            id="owner-apron-phone"
            className="mx-auto w-full max-w-md lg:mx-0"
            sizes="(min-width: 1024px) 40vw, 92vw"
            caption={{ label: "Customer text, just now" }}
          />
        </Reveal>
      </div>

      {/* The three pains as a ruled register: warm hairlines, asymmetric rows.
          Reads as a work-order log, not a card grid. */}
      <div className="mt-12 border-t border-[color:var(--hairline)]">
        {ROWS.map((row, i) => {
          const Icon = row.icon;
          return (
            <Reveal key={row.title} delay={Math.min(i, 3) * 60}>
              <div className="grid items-start gap-4 border-b border-[color:var(--hairline)] py-6 sm:grid-cols-[auto_1fr] sm:gap-6">
                <div className="flex items-center gap-3">
                  <span className="flex size-9 items-center justify-center rounded-lg bg-[color:var(--petrol-12)] text-[color:var(--petrol)]">
                    <Icon className="size-5" strokeWidth={1.75} aria-hidden />
                  </span>
                </div>
                <div className="grid gap-1 sm:grid-cols-[minmax(0,16rem)_1fr] sm:items-baseline sm:gap-6">
                  <h3 className="text-lg font-semibold text-[color:var(--ink)]">
                    {row.title}
                  </h3>
                  <p className="text-[15px] leading-relaxed text-[color:var(--ink-70)]">
                    {row.body}
                  </p>
                </div>
              </div>
            </Reveal>
          );
        })}
      </div>
    </Section>
  );
}
