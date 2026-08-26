import type { ReactNode } from "react";

import type { MarketingLocale } from "@/i18n/marketing/footer";
import { securityCopy } from "@/i18n/marketing/security";
import { SECURITY_EMAIL } from "@/lib/marketing/business";
import { breadcrumbJsonLd } from "@/lib/marketing/seo";

import {
  ConvergedField,
  Dateline,
  FrCard,
  FrSection,
} from "./fr";
import { JsonLd } from "./ui/json-ld";

const AWS_REGION = "us-east-1";

function Tick() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="mt-1 size-5 shrink-0"
      fill="none"
      stroke="var(--fr-green)"
      strokeWidth="2.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M4 12.5 10 18.5 20 6" />
    </svg>
  );
}

function SecLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      className="font-medium text-[color:var(--fr-olive)] underline decoration-[color:var(--fr-olive)]/35 underline-offset-4 transition-colors duration-200 ease-out hover:decoration-[color:var(--fr-olive)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--fr-olive)]"
    >
      {children}
    </a>
  );
}

export function SecurityPageBody({
  locale = "en",
}: {
  locale?: MarketingLocale;
}) {
  const copy = securityCopy(locale);
  const french = locale === "fr-CA";
  const path = french ? "/fr/securite" : "/security";
  const privacy = "/legal/privacy";
  const terms = "/legal/terms";
  const subprocessors = french ? "/fr/sous-traitants" : "/legal/subprocessors";
  const deletion = french
    ? "/fr/supprimer-mes-donnees"
    : "/legal/delete-my-data";
  const claims: { title: string; body: ReactNode }[] = [
    { title: copy.claimEncryptionTitle, body: copy.claimEncryptionBody },
    { title: copy.claimLogsTitle, body: copy.claimLogsBody },
    {
      title: copy.claimRegionTitle,
      body: (
        <>
          {copy.claimRegionBefore}{" "}
          <span className="fr-mono-data">{AWS_REGION}</span>{" "}
          {copy.claimRegionAfter}{" "}
          <SecLink href={privacy}>{copy.privacyLink}</SecLink>.
        </>
      ),
    },
    {
      title: copy.claimSubprocessorsTitle,
      body: (
        <>
          {copy.claimSubprocessorsBefore}{" "}
          <SecLink href={subprocessors}>{copy.subprocessorsLink}</SecLink>.{" "}
          {copy.claimSubprocessorsAfter}
        </>
      ),
    },
    {
      title: copy.claimDeletionTitle,
      body: (
        <>
          {copy.claimDeletionBefore}{" "}
          <SecLink href={terms}>{copy.termsLink}</SecLink> {copy.and}{" "}
          <SecLink href={privacy}>{copy.privacyLink}</SecLink>.{" "}
          {copy.claimDeletionMiddle}{" "}
          <SecLink href={deletion}>{copy.deletionLink}</SecLink>.
        </>
      ),
    },
  ];
  const mechanics = [
    { title: copy.tenantTitle, body: copy.tenantBody },
    { title: copy.webhooksTitle, body: copy.webhooksBody },
    { title: copy.keysTitle, body: copy.keysBody },
    { title: copy.abuseTitle, body: copy.abuseBody },
  ];

  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: copy.home, path: french ? "/fr" : "/" },
          { name: copy.breadcrumb, path },
        ])}
      />
      <FrSection ground="white" className="pb-10 md:pb-14">
        <div className="max-w-3xl">
          <ConvergedField variant="mark" className="h-9 w-auto" />
          <div className="mt-6">
            <Dateline>{copy.dateline}</Dateline>
          </div>
          <h1 className="fr-h1 mt-5 text-[color:var(--fr-ink)]">
            {copy.title}
          </h1>
          <p className="fr-body mt-5 max-w-[62ch] text-[color:var(--fr-ink-70)]">
            {copy.introBefore}{" "}
            <SecLink href={`mailto:${SECURITY_EMAIL}`}>
              {SECURITY_EMAIL}
            </SecLink>
            .
          </p>
        </div>

        <ul className="mt-12 max-w-3xl space-y-8">
          {claims.map(({ title, body }) => (
            <li key={title} className="flex gap-4">
              <Tick />
              <div>
                <h2 className="fr-h3 text-[color:var(--fr-ink)]">{title}</h2>
                <p className="fr-body mt-2 text-[color:var(--fr-ink-70)]">
                  {body}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </FrSection>

      <FrSection ground="frost">
        <div className="max-w-3xl">
          <h2 className="fr-h2 text-[color:var(--fr-ink)]">
            {copy.mechanicsTitle}
          </h2>
        </div>
        <div className="mt-10 grid gap-6 sm:grid-cols-2">
          {mechanics.map(({ title, body }) => (
            <FrCard key={title} className="p-6">
              <h3 className="fr-h3 text-[color:var(--fr-ink)]">{title}</h3>
              <p className="mt-2 text-[0.9375rem] leading-relaxed text-[color:var(--fr-ink-70)]">
                {body}
              </p>
            </FrCard>
          ))}
        </div>
      </FrSection>

      <FrSection ground="white">
        <div className="grid max-w-3xl gap-6 sm:grid-cols-2">
          <FrCard className="p-6">
            <h2 className="fr-h3 text-[color:var(--fr-ink)]">
              {copy.breachTitle}
            </h2>
            <p className="fr-body mt-3 text-[color:var(--fr-ink-70)]">
              {copy.breachBody}
            </p>
          </FrCard>
          <FrCard className="p-6">
            <h2 className="fr-h3 text-[color:var(--fr-ink)]">
              {copy.missingTitle}
            </h2>
            <p className="fr-body mt-3 text-[color:var(--fr-ink-70)]">
              {copy.missingBody}
            </p>
          </FrCard>
        </div>
      </FrSection>

      <FrSection ground="white">
        <FrCard well className="max-w-3xl p-6 sm:p-8">
          <h2 className="fr-h3 text-[color:var(--fr-ink)]">
            {copy.certificationsTitle}
          </h2>
          <p className="fr-body mt-3 text-[color:var(--fr-ink-70)]">
            {copy.certificationsBody}
          </p>
          <p className="fr-body mt-3 text-[color:var(--fr-ink-70)]">
            {copy.certificationsSignal}
          </p>
        </FrCard>
      </FrSection>

      <FrSection ground="white">
        <FrCard well className="max-w-3xl p-6 sm:p-8">
          <h2 className="fr-h3 text-[color:var(--fr-ink)]">
            {copy.disclosureTitle}
          </h2>
          <p className="fr-body mt-3 text-[color:var(--fr-ink-70)]">
            {copy.disclosureBefore}{" "}
            <SecLink href={`mailto:${SECURITY_EMAIL}`}>
              {SECURITY_EMAIL}
            </SecLink>{" "}
            {copy.disclosureAfter}
          </p>
        </FrCard>
      </FrSection>
    </>
  );
}
