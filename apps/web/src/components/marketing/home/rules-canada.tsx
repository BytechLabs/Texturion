import { homeCopy, type HomeCopy } from "@/i18n/marketing/home";
import type { MarketingLocale } from "@/i18n/marketing/footer";
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

const usProofPoints = (copy: HomeCopy): readonly ProofPoint[] => [
  { title: copy.rulesRegTitle, body: copy.rulesRegBody },
  { title: copy.rulesStopTitle, body: copy.rulesStopBody },
  { title: copy.rulesConsentTitle, body: copy.rulesConsentBodyUs },
  { title: copy.rulesOptOutTitle, body: copy.rulesOptOutBody },
];

const caProofPoints = (copy: HomeCopy): readonly ProofPoint[] => [
  { title: copy.rulesNoRegTitle, body: copy.rulesNoRegBody },
  { title: copy.rulesStopTitle, body: copy.rulesStopBody },
  { title: copy.rulesConsentTitle, body: copy.rulesConsentBodyCa },
  { title: copy.rulesOptOutTitle, body: copy.rulesOptOutBody },
];

interface Chip {
  label: string;
  tick?: boolean;
}

const usChips = (copy: HomeCopy): readonly Chip[] => [
  { label: copy.rulesChipFiled },
  { label: copy.rulesChipReceiving, tick: true },
  { label: copy.rulesChipPrivacy },
];

const canadaChips = (copy: HomeCopy): readonly Chip[] => [
  { label: copy.rulesChipLocal },
  { label: copy.rulesChipDayOne, tick: true },
  { label: copy.rulesChipPrivacy },
];

/** The left column: the country's four compliance proof points. */
function ProofColumn({
  eyebrow,
  points,
  copy,
}: {
  eyebrow: string;
  points: readonly ProofPoint[];
  copy: HomeCopy;
}) {
  return (
    <div>
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2 className="fr-h2 mt-4 max-w-[20ch]">
        {copy.rulesCardHeading}
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
            className="font-body-mkt text-[0.9375rem] font-semibold text-[color:var(--fr-olive)] underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--fr-olive)]"
          >
            {linkLabel}
          </Link>
        </p>
      </FrCard>
    </div>
  );
}

export function RulesCanada({
  locale = "en",
}: {
  locale?: MarketingLocale;
} = {}) {
  const copy = homeCopy(locale);
  const US_PROOF_POINTS = usProofPoints(copy);
  const CA_PROOF_POINTS = caProofPoints(copy);
  const US_CHIPS = usChips(copy);
  const CANADA_CHIPS = canadaChips(copy);
  return (
    <FrSection ground="white" id="rules">
      {/* US (SSR default): the carrier proof points + the registration-tracked
          reassurance card. No Canadian content. */}
      <CountryOnly country="us">
        <div className="grid gap-12 lg:grid-cols-2 lg:gap-16">
          <ProofColumn
            eyebrow={copy.rulesEyebrowUs}
            points={US_PROOF_POINTS}
            copy={copy}
          />
          <ReassuranceCard
            heading={copy.rulesTitleUs}
            body={copy.rulesBodyUs}
            chips={US_CHIPS}
            linkHref={LIVE_ROUTES.featuresCompliance}
            linkLabel={copy.rulesLinkUs}
          />
        </div>
      </CountryOnly>

      {/* Canada: the CASL-framed proof points + the day-one story, stated. No
          US registration, wait, or fee. */}
      <CountryOnly country="ca">
        <div className="grid gap-12 lg:grid-cols-2 lg:gap-16">
          <ProofColumn
            eyebrow={copy.rulesEyebrowCa}
            points={CA_PROOF_POINTS}
            copy={copy}
          />
          <ReassuranceCard
            heading={copy.rulesTitleCa}
            body={copy.rulesBodyCa}
            chips={CANADA_CHIPS}
            linkHref={LIVE_ROUTES.canada}
            linkLabel={copy.rulesLinkCa}
          />
        </div>
      </CountryOnly>
    </FrSection>
  );
}
