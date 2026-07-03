/**
 * Canada + compliance, interleaved (Track B) — §3.10 / COPY §H11 + §H10.
 *
 * One med-density section so the tail never stacks look-alike text bands
 * (§1.4). Canada leads (the weapon) with the real city→area-code widget as its
 * product visual; compliance follows as four real proof points. Copy verbatim.
 * Never "makes you compliant" — "helps you follow the rules" (§3.10). Quiet-
 * hours scoped to STARTING a new late-night conversation (SPEC §5).
 */

import { FileCheck2, Leaf, MessageSquareOff, ShieldCheck, UserCheck } from "lucide-react";

import { Reveal } from "@/components/marketing/ui/reveal";
import { LedgerSection } from "@/components/marketing/ledger/ledger-section";
import { SectionEyebrow } from "@/components/marketing/ledger/section-number";
import { ArrowLink } from "@/components/marketing/ledger/arrow-link";
import { LazyCityAreaCodeWidget } from "@/components/marketing/lazy/lazy-city-area-code-widget";
import { CityAreaCodeWidgetStatic } from "@/components/marketing/interactive/city-area-code-widget-static";
import { PhotoFrame } from "@/components/marketing/photo-frame";
import { LIVE_ROUTES } from "@/lib/marketing/site";

const PROOF_POINTS = [
  {
    icon: FileCheck2,
    title: "Registration, filed for you.",
    body:
      "We register your business with the US phone companies automatically at signup. You answer a few plain questions; we handle the forms, the follow-ups, and the resubmission if anything bounces.",
  },
  {
    icon: MessageSquareOff,
    title: "STOP means stop, instantly.",
    body:
      "When a customer texts STOP, they're opted out on the spot — and JobText blocks any future send to that number until they opt back in. No accidents.",
  },
  {
    icon: UserCheck,
    title: "Consent, on the record.",
    body:
      "Starting a new conversation asks one question: did this customer ask you to text them? That answer is recorded, with a name and a date.",
  },
  {
    icon: ShieldCheck,
    title: "Your business, identified.",
    body:
      "The first text to a new contact automatically ends with your business name and “Reply STOP to opt out” — what US and Canadian rules expect, written for you.",
  },
] as const;

export function CanadaCompliance() {
  return (
    <LedgerSection n={10} id="canada" defer intrinsic={1100}>
      {/* Canada beat — leads, with the area-code widget as its product visual. */}
      <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
        <div>
          <SectionEyebrow n={10} label="Canada & the rules" />
          <span className="mt-4 flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Leaf className="size-5" strokeWidth={1.75} aria-hidden />
          </span>
          <h2 className="display-h2 mt-4 text-foreground">
            In Canada? You can text customers today.
          </h2>
          <p className="mt-5 text-lg leading-relaxed text-muted-foreground">
            The US phone-company registration doesn&apos;t apply to Canadian
            businesses texting Canadian customers — so on JobText, Canadian crews
            are texting the same day they sign up. Local numbers in every
            province, CASL-aware consent records, and a privacy policy that tells
            you plainly where your data lives.
          </p>
          <ArrowLink href={LIVE_ROUTES.canada} className="mt-6">
            How JobText works in Canada
          </ArrowLink>

          {/* Real photo (VISUALS-V2 §2): a working Canadian crew — texting
              customers the same day they sign up. Warm, on-brand, framed once. */}
          <Reveal className="mt-8 max-w-xs">
            <PhotoFrame
              id="crew-rooftop"
              aspect="5 / 4"
              sizes="(min-width: 1024px) 30vw, 80vw"
              caption={{ pill: "Live", label: "Texting day one · Toronto" }}
            />
          </Reveal>
        </div>

        <Reveal>
          {/* Deferred: the typable widget (and its NANP lookup data) load on
              viewport approach; the seeded Toronto → 416 result is meaningful
              before/without JS (§3.10). */}
          <LazyCityAreaCodeWidget fallback={<CityAreaCodeWidgetStatic />} />
        </Reveal>
      </div>

      {/* Compliance beat — the "and here's how the rules are handled" follow-on.
          Composition is FLIPPED vs the Canada beat above (photo LEFT, copy RIGHT)
          so two adjacent beats never share a silhouette (anti-bland). */}
      <div className="mt-20">
        <div className="grid items-center gap-8 lg:grid-cols-[1fr_1.4fr] lg:gap-12">
          {/* Real photo (VISUALS-V2 §2): a tradesperson focused on the job while
              JobText handles the paperwork — the done-for-you reframe (CONVERSION
              §3), on-brand and warm rather than a lone abstract illustration. */}
          <Reveal className="order-2 w-full lg:order-1">
            <PhotoFrame
              id="plumber-heater"
              className="mx-auto max-w-sm lg:mx-0"
              sizes="(min-width: 1024px) 34vw, 86vw"
              caption={{ pill: "Filed", label: "Registration · in review" }}
            />
          </Reveal>

          <div className="order-1 max-w-2xl lg:order-2">
            <p className="jt-meta text-primary">The carrier stuff, handled</p>
            <h2 className="display-h2 mt-3 text-foreground">
              Texting rules are real. We deal with them so you don&apos;t have
              to.
            </h2>
            <p className="mt-5 text-lg leading-relaxed text-muted-foreground">
              Business texting in the US and Canada comes with real rules —
              registering your business with the phone companies, honoring
              opt-outs, recording consent. Most tools hand you a compliance
              homework packet. JobText just does it.
            </p>
          </div>
        </div>

        <div className="mt-10 grid gap-6 sm:grid-cols-2">
          {PROOF_POINTS.map((point, i) => {
            const Icon = point.icon;
            return (
              <Reveal key={point.title} delay={Math.min(i, 3) * 60}>
                <div className="flex h-full gap-4 rounded-[10px] border border-border bg-card p-5">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Icon className="size-5" strokeWidth={1.75} aria-hidden />
                  </span>
                  <div>
                    <h3 className="text-[16px] font-semibold text-foreground">
                      {point.title}
                    </h3>
                    <p className="mt-1.5 text-[14px] leading-relaxed text-muted-foreground">
                      {point.body}
                    </p>
                  </div>
                </div>
              </Reveal>
            );
          })}
        </div>

        <p className="mt-8 max-w-3xl text-[15px] leading-relaxed text-muted-foreground">
          JobText helps you follow the rules — TCPA in the US, CASL in Canada —
          without becoming a compliance department. And if you{" "}
          <span className="italic">start</span> a new conversation late at night,
          we&apos;ll quietly check first: “It&apos;s 9:14pm where this customer
          is. Send anyway?” (Replies to a customer who already texted you are
          never held up.)
        </p>
      </div>
    </LedgerSection>
  );
}
