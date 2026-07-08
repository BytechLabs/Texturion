import { Check } from "lucide-react";
import Link from "next/link";

import { Eyebrow, FrCard, FrSection } from "@/components/marketing/fr";
import { LIVE_ROUTES } from "@/lib/marketing/site";

/**
 * S10 · RULES, HANDLED + CANADA (COPY-DECK v2, the split band). Conversion
 * job: clear the two silent disqualifiers: compliance fear, and "does this
 * work where I am."
 *
 * Left: the four carrier proof points. Right: the Canada card with its three
 * chips; the "Texting works day one" chip carries the whitelisted Canada
 * day-one green tick. Copy verbatim per deck.
 */

const PROOF_POINTS: readonly { title: string; body: string }[] = [
  {
    title: "Registration, filed for you.",
    body: "We register your business with the US phone companies automatically at signup. You answer a few plain questions; we handle the forms, the follow-ups, and the resubmission if anything bounces.",
  },
  {
    title: "STOP means stop, instantly.",
    body: "When a customer texts STOP, they're opted out on the spot, and Loonext blocks any future send to that number until they opt back in.",
  },
  {
    title: "Consent, on the record.",
    body: "Every conversation you start is recorded with who started it and when, so your opt-in trail is real if a carrier ever asks.",
  },
  {
    title: "Opt-outs honored, however they're said.",
    body: 'The rules count "please stop texting me" the same as STOP, so one click marks a customer opted out and Loonext blocks every send until they ask back in.',
  },
];

const CANADA_CHIPS: readonly { label: string; tick?: boolean }[] = [
  { label: "Local Canadian numbers" },
  { label: "Texting works day one", tick: true },
  { label: "Plain-English privacy" },
];

export function RulesCanada() {
  return (
    <FrSection ground="white" id="rules">
      <div className="grid gap-12 lg:grid-cols-2 lg:gap-16">
        {/* Left: the carrier stuff, handled. */}
        <div>
          <Eyebrow>The carrier stuff, handled</Eyebrow>
          <h2 className="fr-h2 mt-4 max-w-[20ch]">
            Texting rules are real. We deal with them so you don&apos;t have
            to.
          </h2>
          <dl className="mt-10 space-y-7">
            {PROOF_POINTS.map((point) => (
              <div key={point.title}>
                <dt className="fr-h3 text-[color:var(--fr-ink)]">
                  {point.title}
                </dt>
                <dd className="font-body-mkt mt-1.5 text-[15px] leading-[1.65] text-[color:var(--fr-ink-70)]">
                  {point.body}
                </dd>
              </div>
            ))}
          </dl>
        </div>

        {/* Right: the Canada card. */}
        <div className="lg:pt-14">
          <FrCard className="p-6 sm:p-8">
            <h3 className="font-display text-2xl font-extrabold leading-[1.15] text-[color:var(--fr-ink)]">
              In Canada? You can text customers today.
            </h3>
            <p className="font-body-mkt mt-4 text-[15px] leading-[1.65] text-[color:var(--fr-ink-70)]">
              The US phone-company registration doesn&apos;t apply to Canadian
              businesses texting Canadian customers, so on Loonext, Canadian
              crews are texting the same day they sign up. Local numbers in
              every province, CASL-aware consent records, and a privacy policy
              that says plainly where your data lives.
            </p>
            <ul className="mt-6 flex flex-wrap gap-2.5">
              {CANADA_CHIPS.map((chip) => (
                <li
                  key={chip.label}
                  className="font-mono-mkt flex items-center gap-1.5 rounded-[6px] bg-[color:var(--fr-frost)] px-3 py-2 text-[0.8125rem] text-[color:var(--fr-ink)]"
                >
                  {chip.tick ? (
                    <Check
                      className="size-3.5 shrink-0 text-[color:var(--fr-green)]"
                      strokeWidth={2.5}
                      aria-hidden
                    />
                  ) : null}
                  {chip.label}
                </li>
              ))}
            </ul>
            <p className="mt-6">
              <Link
                href={LIVE_ROUTES.canada}
                className="font-body-mkt text-[0.9375rem] font-semibold text-[color:var(--fr-cobalt)] underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--fr-cobalt)]"
              >
                How Loonext works in Canada
              </Link>
            </p>
          </FrCard>
        </div>
      </div>
    </FrSection>
  );
}
