/**
 * The problem (Track B) — §3.3 / COPY §H3.
 * Ledger identity (iteration 5): section `03` on the spine. The iter-4 risk
 * (REFERENCES §4: "three equal icon cards is the most generic shape on the
 * page") is fixed — the three pains are now stacked LEDGER ENTRIES divided by
 * petrol hairlines with tabular indices, not three bootstrap cards, in an
 * asymmetric split (craft #6, anti-bland #1/#2). Copy verbatim. Server component.
 */

import { PhoneOff, Smartphone, UserX } from "lucide-react";

import { Reveal } from "@/components/marketing/ui/reveal";
import { LedgerSection } from "@/components/marketing/ledger/ledger-section";
import { SectionEyebrow } from "@/components/marketing/ledger/section-number";
import { OneNumberManyPeople } from "@/components/marketing/art";

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
    <LedgerSection n={3} defer intrinsic={560}>
      {/* Asymmetric editorial split: copy + illustration up top, then the three
          pains as ruled ledger entries below (not a 1/1/1 card grid). */}
      <div className="grid items-center gap-8 lg:grid-cols-[1.4fr_1fr] lg:gap-12">
        <div className="max-w-2xl">
          <SectionEyebrow n={3} label="The problem" />
          <h2 className="display-h2 mt-4 text-foreground">
            Your business runs on texts. Your texts run on one phone.
          </h2>
          <p className="mt-5 text-lg leading-relaxed text-muted-foreground">
            Customers would rather text than call — so they text whoever&apos;s
            number they have. That works until it doesn&apos;t.
          </p>
        </div>

        <Reveal className="mx-auto w-full max-w-xs lg:mx-0 lg:justify-self-end">
          <OneNumberManyPeople />
        </Reveal>
      </div>

      {/* The three pains as a ruled ledger — petrol hairlines + tabular indices,
          asymmetric two-column rows. Reads as an accounting register, not cards. */}
      <div className="mt-12 border-t border-primary/20">
        {ROWS.map((row, i) => {
          const Icon = row.icon;
          return (
            <Reveal key={row.title} delay={Math.min(i, 3) * 60}>
              <div className="grid items-start gap-4 border-b border-border py-6 sm:grid-cols-[auto_1fr] sm:gap-6">
                <div className="flex items-center gap-3">
                  <span className="jt-meta tabular-nums text-primary">
                    {`0${i + 1}`}
                  </span>
                  <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Icon className="size-5" strokeWidth={1.75} aria-hidden />
                  </span>
                </div>
                <div className="grid gap-1 sm:grid-cols-[minmax(0,16rem)_1fr] sm:items-baseline sm:gap-6">
                  <h3 className="text-lg font-semibold text-foreground">
                    {row.title}
                  </h3>
                  <p className="text-[15px] leading-relaxed text-muted-foreground">
                    {row.body}
                  </p>
                </div>
              </div>
            </Reveal>
          );
        })}
      </div>
    </LedgerSection>
  );
}
