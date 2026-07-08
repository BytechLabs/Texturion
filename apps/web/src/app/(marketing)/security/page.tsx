import type { Metadata } from "next";

import {
  ConvergedField,
  Dateline,
  FrCard,
  FrSection,
} from "@/components/marketing/fr";
import { JsonLd } from "@/components/marketing/ui/json-ld";
import { SECURITY_EMAIL } from "@/lib/marketing/business";
import { breadcrumbJsonLd, buildMetadata } from "@/lib/marketing/seo";

const PATH = "/security";

export const metadata: Metadata = buildMetadata({
  title: "Security",
  description:
    "How Loonext protects your data, in plain terms: encryption in transit and at rest, message content kept out of analytics and error logs, data stored in the United States, sub-processors listed publicly, and documented 30-day data handling on cancellation.",
  path: PATH,
});

/**
 * SECURITY (DESIGN-DIRECTION v4 §6, COPY-DECK v2): verifiable claims as a
 * checked list, green ticks (the Answered Green whitelist: guarantee checks),
 * no certifications we don't hold, no padlock imagery. Every claim below is
 * something the product does today (SPEC §10); nothing aspirational.
 */

/** The green tick (§2 green whitelist: guarantee/verification checks). */
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

/** Inline cobalt link (the marketing link voice outside product frames). */
function SecLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      className="font-medium text-[color:var(--fr-cobalt)] underline decoration-[color:var(--fr-cobalt)]/35 underline-offset-4 transition-colors duration-200 ease-out hover:decoration-[color:var(--fr-cobalt)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--fr-cobalt)]"
    >
      {children}
    </a>
  );
}

/** The checked-claims list from the deck, in the deck's order. */
const CLAIMS: { title: string; body: React.ReactNode }[] = [
  {
    title: "Encrypted in transit and at rest",
    body: (
      <>
        Traffic to Loonext runs over HTTPS/TLS, and your data, the messages,
        contacts, and attachments, is encrypted at rest by our infrastructure
        providers. Message attachments live in a private, per-business storage
        bucket and are served only through short-lived signed links.
      </>
    ),
  },
  {
    title: "Message content stays out of analytics and error logs",
    body: (
      <>
        We keep message content, names, addresses, and phone numbers out of our
        error monitoring (Sentry) and product analytics (PostHog). Error
        reports strip request and response bodies and redact phone-number
        patterns; analytics record events, counts, and IDs only, never message
        text.
      </>
    ),
  },
  {
    title: "Your data is stored in the United States",
    body: (
      <>
        Loonext processes and stores data in the United States: our database,
        authentication, and file storage run on Supabase in the AWS{" "}
        <span className="fr-mono-data">us-east-1</span> region. How we handle
        personal information is in our{" "}
        <SecLink href="/legal/privacy">privacy policy</SecLink>.
      </>
    ),
  },
  {
    title: "Sub-processors listed publicly",
    body: (
      <>
        Every vendor that processes data on our behalf, what it touches, and
        the region it operates in is on our{" "}
        <SecLink href="/legal/subprocessors">sub-processors page</SecLink>.
        When a vendor changes, that page and its date change with it.
      </>
    ),
  },
  {
    title: "30-day data handling on cancellation, as documented",
    body: (
      <>
        Cancel and your number is held for 30 days, then released. Account and
        message data is kept afterward only as long as legal, tax, and carrier
        record-keeping duties require, then deleted or anonymized, exactly as
        documented in our <SecLink href="/legal/terms">terms</SecLink> and{" "}
        <SecLink href="/legal/privacy">privacy policy</SecLink>.
      </>
    ),
  },
];

/** The mechanics behind the claims, each one shipped and verifiable. */
const MECHANICS: { title: string; body: string }[] = [
  {
    title: "Every business is an isolated tenant",
    body: "Each database query is scoped to one business by its ID, and Postgres row-level security is enabled deny-by-default on every table as a second line of defense, so one business can never see another's conversations, contacts, or numbers. Realtime updates are gated the same way: you only join your own company's channel.",
  },
  {
    title: "Signed webhooks, verified on arrival",
    body: "Texts and payments reach us through webhooks, and we verify every one cryptographically before acting on it: Ed25519 signatures on carrier events, HMAC signatures on payment events. Anything that doesn't check out is rejected. A signature is the webhook's only way in.",
  },
  {
    title: "Least-privilege keys and secrets",
    body: "Server credentials are stored as encrypted secrets, never in the code or the repo. Payment access uses a restricted key limited to what billing needs; database access uses an independently revocable key. The browser only ever receives the minimal public configuration it needs.",
  },
  {
    title: "Abuse defenses built in",
    body: "Outbound texting is restricted to US and Canadian destinations, rate-limited per business, and bounded by a spending cap you control, layered defenses against SMS pumping and runaway bills. Opt-outs are enforced automatically at send time.",
  },
];

export default function SecurityPage() {
  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Home", path: "/" },
          { name: "Security", path: PATH },
        ])}
      />
      <FrSection ground="white" className="pb-10 md:pb-14">
        <div className="max-w-3xl">
          <ConvergedField variant="mark" className="h-9 w-auto" />
          <div className="mt-6">
            <Dateline>ENCRYPTED IN TRANSIT AND AT REST</Dateline>
          </div>
          <h1 className="fr-h1 mt-5 text-[color:var(--fr-ink)]">
            Security, in plain terms.
          </h1>
          <p className="fr-body mt-5 max-w-[62ch] text-[color:var(--fr-ink-70)]">
            Every item on this page is something the product does today. No
            certifications we don&apos;t hold, and questions go to a person:{" "}
            <SecLink href={`mailto:${SECURITY_EMAIL}`}>
              {SECURITY_EMAIL}
            </SecLink>
            .
          </p>
        </div>

        <ul className="mt-12 max-w-3xl space-y-8">
          {CLAIMS.map(({ title, body }) => (
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
            The mechanics behind those claims.
          </h2>
        </div>
        <div className="mt-10 grid gap-6 sm:grid-cols-2">
          {MECHANICS.map(({ title, body }) => (
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
        <FrCard well className="max-w-3xl p-6 sm:p-8">
          <h2 className="fr-h3 text-[color:var(--fr-ink)]">
            Responsible disclosure
          </h2>
          <p className="fr-body mt-3 text-[color:var(--fr-ink-70)]">
            Found a vulnerability? We want to hear from you. Email{" "}
            <SecLink href={`mailto:${SECURITY_EMAIL}`}>
              {SECURITY_EMAIL}
            </SecLink>{" "}
            with the details and steps to reproduce. Please give us a reasonable
            chance to fix the issue before disclosing it publicly, and don&apos;t
            access or modify data that isn&apos;t yours while testing.
            We&apos;ll acknowledge your report and keep you posted on the fix.
          </p>
        </FrCard>
      </FrSection>
    </>
  );
}
