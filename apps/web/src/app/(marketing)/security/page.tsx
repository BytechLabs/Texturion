import {
  KeyRound,
  Lock,
  ScrollText,
  ShieldCheck,
  ShieldOff,
  Webhook,
} from "lucide-react";
import type { Metadata } from "next";

import { Container } from "@/components/marketing/ui/container";
import { JsonLd } from "@/components/marketing/ui/json-ld";
import { Kicker } from "@/components/marketing/ui/kicker";
import { SECURITY_EMAIL } from "@/lib/marketing/business";
import { breadcrumbJsonLd, buildMetadata } from "@/lib/marketing/seo";

const PATH = "/security";

export const metadata: Metadata = buildMetadata({
  title: "Security",
  description:
    "How Loonext protects your data in plain language: tenant isolation with row-level security, encryption in transit and at rest, signed webhooks, least-privilege keys, and message content kept out of analytics and error logs.",
  path: PATH,
});

/**
 * Each point describes only what SPEC §10 actually implements, no SOC 2 claim,
 * no badge we don't hold (BLUEPRINT §2, §13.8). This page also feeds the
 * sub-processors page and the home security strip.
 */
const POINTS = [
  {
    Icon: ShieldCheck,
    title: "Your data is isolated from every other business",
    body: "Every business on Loonext is a separate tenant. Each database query is scoped to one business by its ID, and Postgres row-level security is enabled deny-by-default on every table as a second line of defense, so one business can never see another's conversations, contacts, or numbers. Realtime updates are gated the same way: you only join your own company's channel.",
  },
  {
    Icon: Lock,
    title: "Encrypted in transit and at rest",
    body: "Traffic to Loonext runs over HTTPS/TLS. Your data, messages, contacts, and attachments, is encrypted at rest by our infrastructure providers. Message attachments live in a private, per-business storage bucket and are served only through short-lived signed links.",
  },
  {
    Icon: Webhook,
    title: "Signed webhooks, verified on arrival",
    body: "Texts and payments reach us through webhooks. We verify every one cryptographically before acting on it. Ed25519 signatures on carrier events, HMAC signatures on payment events, and reject anything that doesn't check out. A signature is the webhook's only way in.",
  },
  {
    Icon: KeyRound,
    title: "Least-privilege keys and secrets",
    body: "Server credentials are stored as encrypted secrets, never in the code or the repo. Payment access uses a restricted key limited to what billing needs; database access uses an independently revocable key. The browser only ever receives the minimal public configuration it needs.",
  },
  {
    Icon: ShieldOff,
    title: "Your messages stay out of our analytics and error logs",
    body: "We keep message content, names, addresses, and phone numbers out of our error monitoring (Sentry) and product analytics (PostHog). Error reports strip request and response bodies and redact phone-number patterns; analytics record events, counts, and IDs only, never message text. This is a real, verifiable policy, not a promise for later.",
  },
  {
    Icon: ScrollText,
    title: "Abuse defenses built in",
    body: "Outbound texting is restricted to US and Canadian destinations, rate-limited per business, and bounded by a spending cap you control, layered defenses against SMS pumping and runaway bills. Opt-outs are enforced automatically at send time.",
  },
] as const;

export default function SecurityPage() {
  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Home", path: "/" },
          { name: "Security", path: PATH },
        ])}
      />
      <Container className="py-16 sm:py-24">
        <div className="mx-auto max-w-2xl text-center">
          <Kicker>Security</Kicker>
          <h1 className="display-hero mt-3 text-balance">
            The honest version of &quot;we take security seriously.&quot;
          </h1>
          <p className="mt-5 text-lg leading-relaxed text-[color:var(--ink-70)]">
            No badges we don&apos;t hold, no jargon. Here is exactly how Loonext
            protects your business&apos;s data, each point is something the
            product actually does today.
          </p>
        </div>

        <div className="mx-auto mt-12 grid max-w-4xl gap-4 sm:grid-cols-2">
          {POINTS.map(({ Icon, title, body }) => (
            <div key={title} className="panel-card rounded-xl p-6">
              <span className="flex size-9 items-center justify-center rounded-lg bg-[color:var(--petrol-12)] text-[color:var(--petrol)]">
                <Icon className="size-5" strokeWidth={1.75} aria-hidden="true" />
              </span>
              <h2 className="mt-4 text-base font-semibold text-[color:var(--day-ink)]">
                {title}
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-[color:var(--ink-70)]">
                {body}
              </p>
            </div>
          ))}
        </div>

        {/* Data residency + sub-processors */}
        <div className="panel-card mx-auto mt-6 max-w-4xl rounded-xl p-6">
          <h2 className="text-base font-semibold text-[color:var(--day-ink)]">
            Where your data lives
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-[color:var(--ink-70)]">
            Loonext processes and stores data in the United States (Supabase on
            AWS us-east-1). The full list of vendors that process data on our
            behalf, and the region each operates in, is on our{" "}
            <a
              href="/legal/subprocessors"
              className="font-medium text-[color:var(--petrol)] underline-offset-4 hover:underline"
            >
              sub-processors page
            </a>
            , and how we handle personal information is in our{" "}
            <a
              href="/legal/privacy"
              className="font-medium text-[color:var(--petrol)] underline-offset-4 hover:underline"
            >
              privacy policy
            </a>
            .
          </p>
        </div>

        {/* Responsible disclosure */}
        <div className="panel-card mx-auto mt-6 max-w-4xl rounded-xl p-6">
          <h2 className="text-base font-semibold text-[color:var(--day-ink)]">
            Responsible disclosure
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-[color:var(--ink-70)]">
            Found a vulnerability? We want to hear from you. Email{" "}
            <a
              href={`mailto:${SECURITY_EMAIL}`}
              className="font-medium text-[color:var(--petrol)] underline-offset-4 hover:underline"
            >
              {SECURITY_EMAIL}
            </a>{" "}
            with the details and steps to reproduce. Please give us a reasonable
            chance to fix the issue before disclosing it publicly, and don&apos;t
            access or modify data that isn&apos;t yours while testing. We&apos;ll
            acknowledge your report and keep you posted on the fix.
          </p>
        </div>
      </Container>
    </>
  );
}
