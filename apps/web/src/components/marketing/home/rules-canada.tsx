import { Check } from "lucide-react";
import Link from "next/link";

import { CountryOnly } from "@/components/marketing/country";
import { Eyebrow, FrCard, FrSection } from "@/components/marketing/fr";
import { LIVE_ROUTES } from "@/lib/marketing/site";

/**
 * S10 · RULES, HANDLED (COPY-DECK v2, the split band), country-aware (owner
 * ruling v1, 2026-07-08): the two countries never share this band.
 *
 * Conversion job: clear the two silent disqualifiers, compliance fear and
 * "does this work where I am." The two-column split holds in both modes: left
 * is the compliance proof points, right is the country's reassurance card.
 * Neither mode shows the other country's registration, wait, fee, or day-one
 * carve-out, and no column is ever empty.
 *
 * US (SSR default): the carrier proof points (registration filed for you, STOP,
 * consent, opt-outs) and a right-hand card that reassures the US visitor the
 * 10DLC registration is filed at signup, carried through carrier approval, and
 * that we email them the moment US texting goes live. No "In Canada?" content.
 *
 * Canada: the same STOP/consent/opt-out mechanics, reframed for CASL, plus the
 * plain fact that there is no US registration to file for Canada-to-Canada
 * texting. The right-hand card is the Canada day-one story, stated as fact (the
 * visitor already chose Canada). No US registration, wait, or fee.
 *
 * Server component; the branch primitives read the shared country context.
 */

interface ProofPoint {
  title: string;
  body: string;
}

const US_PROOF_POINTS: readonly ProofPoint[] = [
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

const CA_PROOF_POINTS: readonly ProofPoint[] = [
  {
    title: "No registration to file.",
    body: "Texting Canadian customers doesn't go through the US phone-company registration, so there's nothing to file and nothing to wait on. You pick a local number and start the same day.",
  },
  {
    title: "STOP means stop, instantly.",
    body: "When a customer texts STOP, they're opted out on the spot, and Loonext blocks any future send to that number until they opt back in.",
  },
  {
    title: "Consent, on the record.",
    body: "Every conversation you start is recorded with who started it and when, so your CASL consent trail is a real name and date, not a memory.",
  },
  {
    title: "Opt-outs honored, however they're said.",
    body: 'The rules count "please stop texting me" the same as STOP, so one click marks a customer opted out and Loonext blocks every send until they ask back in.',
  },
];

interface Chip {
  label: string;
  tick?: boolean;
}

const US_CHIPS: readonly Chip[] = [
  { label: "Filed for you at signup" },
  { label: "Receiving texts, day one", tick: true },
  { label: "Plain-English privacy" },
];

const CANADA_CHIPS: readonly Chip[] = [
  { label: "Local Canadian numbers" },
  { label: "Texting works day one", tick: true },
  { label: "Plain-English privacy" },
];

/** The left column: the country's four compliance proof points. */
function ProofColumn({
  eyebrow,
  points,
}: {
  eyebrow: string;
  points: readonly ProofPoint[];
}) {
  return (
    <div>
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2 className="fr-h2 mt-4 max-w-[20ch]">
        Texting rules are real. We deal with them so you don&apos;t have to.
      </h2>
      <dl className="mt-10 space-y-7">
        {points.map((point) => (
          <div key={point.title}>
            <dt className="fr-h3 text-[color:var(--fr-ink)]">{point.title}</dt>
            <dd className="font-body-mkt mt-1.5 text-[15px] leading-[1.65] text-[color:var(--fr-ink-70)]">
              {point.body}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** The right column: the country's reassurance card with its three chips. */
function ReassuranceCard({
  heading,
  body,
  chips,
  linkHref,
  linkLabel,
}: {
  heading: string;
  body: string;
  chips: readonly Chip[];
  linkHref: string;
  linkLabel: string;
}) {
  return (
    <div className="lg:pt-14">
      <FrCard className="p-6 sm:p-8">
        <h3 className="font-display text-2xl font-extrabold leading-[1.15] text-[color:var(--fr-ink)]">
          {heading}
        </h3>
        <p className="font-body-mkt mt-4 text-[15px] leading-[1.65] text-[color:var(--fr-ink-70)]">
          {body}
        </p>
        <ul className="mt-6 flex flex-wrap gap-2.5">
          {chips.map((chip) => (
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
            href={linkHref}
            className="font-body-mkt text-[0.9375rem] font-semibold text-[color:var(--fr-cobalt)] underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--fr-cobalt)]"
          >
            {linkLabel}
          </Link>
        </p>
      </FrCard>
    </div>
  );
}

export function RulesCanada() {
  return (
    <FrSection ground="white" id="rules">
      {/* US (SSR default): the carrier proof points + the registration-tracked
          reassurance card. No Canadian content. */}
      <CountryOnly country="us">
        <div className="grid gap-12 lg:grid-cols-2 lg:gap-16">
          <ProofColumn
            eyebrow="The carrier stuff, handled"
            points={US_PROOF_POINTS}
          />
          <ReassuranceCard
            heading="Your registration, filed and tracked."
            body="The US registration is filed the minute you pay and carried all the way through carrier approval, resubmissions included. Receiving texts works right away, and we email you the moment US texting goes live, usually 3 to 7 business days after signup."
            chips={US_CHIPS}
            linkHref={LIVE_ROUTES.featuresCompliance}
            linkLabel="How Loonext handles the rules"
          />
        </div>
      </CountryOnly>

      {/* Canada: the CASL-framed proof points + the day-one story, stated. No
          US registration, wait, or fee. */}
      <CountryOnly country="ca">
        <div className="grid gap-12 lg:grid-cols-2 lg:gap-16">
          <ProofColumn eyebrow="The rules, handled" points={CA_PROOF_POINTS} />
          <ReassuranceCard
            heading="Texting Canadian customers, day one."
            body="The US phone-company registration doesn't apply to a Canadian business texting Canadian customers, so on Loonext you're texting the same day you sign up. Local numbers in every province, CASL-aware consent records, and a privacy policy that says plainly where your data lives."
            chips={CANADA_CHIPS}
            linkHref={LIVE_ROUTES.canada}
            linkLabel="How Loonext works in Canada"
          />
        </div>
      </CountryOnly>
    </FrSection>
  );
}
