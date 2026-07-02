/**
 * The problem (Track B) — §3.3 / COPY §H3. Three pain cards, no screenshots
 * (breather before the demo). Copy verbatim. Server component with staggered
 * reveals (§1.5). petrol lucide icons (G2).
 */

import { PhoneOff, Smartphone, UserX } from "lucide-react";

import { Reveal } from "@/components/marketing/ui/reveal";
import { Section } from "@/components/marketing/ui/section";
import { OneNumberManyPeople } from "@/components/marketing/art";

const CARDS = [
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
    <Section defer intrinsic={520}>
      <div className="grid items-center gap-8 lg:grid-cols-[1.4fr_1fr] lg:gap-12">
        <div className="max-w-2xl">
          <h2 className="display-h2 text-foreground">
            Your business runs on texts. Your texts run on one phone.
          </h2>
          <p className="mt-5 text-lg leading-relaxed text-muted-foreground">
            Customers would rather text than call — so they text whoever&apos;s
            number they have. That works until it doesn&apos;t.
          </p>
        </div>

        {/* The shared-inbox idea, drawn (VISUALS §3): one number, the whole
            crew can see it. A spot illustration, not a screenshot. */}
        <Reveal className="mx-auto w-full max-w-xs lg:mx-0 lg:justify-self-end">
          <OneNumberManyPeople />
        </Reveal>
      </div>

      <div className="mt-12 grid gap-6 md:grid-cols-3">
        {CARDS.map((card, i) => {
          const Icon = card.icon;
          return (
            <Reveal key={card.title} delay={Math.min(i, 3) * 60}>
              <div className="h-full rounded-[10px] border border-border bg-card p-6">
                <span className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="size-5" strokeWidth={1.75} aria-hidden />
                </span>
                <h3 className="mt-4 text-lg font-semibold text-foreground">
                  {card.title}
                </h3>
                <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">
                  {card.body}
                </p>
              </div>
            </Reveal>
          );
        })}
      </div>
    </Section>
  );
}
