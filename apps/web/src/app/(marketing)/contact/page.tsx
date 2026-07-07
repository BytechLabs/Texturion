import type { Metadata } from "next";

import { Container } from "@/components/marketing/ui/container";
import { JsonLd } from "@/components/marketing/ui/json-ld";
import { Kicker } from "@/components/marketing/ui/kicker";
import {
  SECURITY_EMAIL,
  SUPPORT_EMAIL,
  SUPPORT_SLA,
  businessIdentityLine,
} from "@/lib/marketing/business";
import { breadcrumbJsonLd, buildMetadata } from "@/lib/marketing/seo";

import { ContactForm } from "./contact-form";

const PATH = "/contact";

export const metadata: Metadata = buildMetadata({
  title: "Contact",
  description:
    "Get in touch with Loonext. Email is our only support channel, no chat bot, no phone tree, and a real person answers, usually within one business day.",
  path: PATH,
});

export default function ContactPage() {
  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Home", path: "/" },
          { name: "Contact", path: PATH },
        ])}
      />
      <Container className="py-16 sm:py-24">
        <div className="mx-auto max-w-2xl">
          <Kicker>Contact</Kicker>
          <h1 className="display-hero mt-3">Talk to a real person.</h1>
          <p className="mt-5 text-lg leading-relaxed text-[color:var(--ink-70)]">
            Email is how we do support, deliberately. No chat widget, no phone
            tree, no &quot;press 1.&quot; {SUPPORT_SLA} A person on the team reads
            every message.
          </p>
        </div>

        <div className="mx-auto mt-12 grid max-w-4xl gap-8 lg:grid-cols-[1.2fr_1fr]">
          {/* Form */}
          <div className="panel-card rounded-xl p-6">
            <ContactForm />
          </div>

          {/* Ways to reach us */}
          <div className="space-y-6">
            <div>
              <h2 className="text-sm font-semibold text-[color:var(--day-ink)]">
                Support
              </h2>
              <p className="mt-1 text-sm text-[color:var(--ink-70)]">
                Questions, billing, anything about your account.
              </p>
              <a
                href={`mailto:${SUPPORT_EMAIL}`}
                className="mt-1 inline-block text-sm font-medium text-[color:var(--petrol)] underline-offset-4 hover:underline"
              >
                {SUPPORT_EMAIL}
              </a>
            </div>

            <div>
              <h2 className="text-sm font-semibold text-[color:var(--day-ink)]">
                Security & responsible disclosure
              </h2>
              <p className="mt-1 text-sm text-[color:var(--ink-70)]">
                Found a vulnerability? See our{" "}
                <a
                  href="/security"
                  className="font-medium text-[color:var(--petrol)] underline-offset-4 hover:underline"
                >
                  security page
                </a>
                , or email
              </p>
              <a
                href={`mailto:${SECURITY_EMAIL}`}
                className="mt-1 inline-block text-sm font-medium text-[color:var(--petrol)] underline-offset-4 hover:underline"
              >
                {SECURITY_EMAIL}
              </a>
            </div>

            <div>
              <h2 className="text-sm font-semibold text-[color:var(--day-ink)]">
                Service status
              </h2>
              <p className="mt-1 text-sm text-[color:var(--ink-70)]">
                Check whether it&apos;s us on our{" "}
                <a
                  href="/status"
                  className="font-medium text-[color:var(--petrol)] underline-offset-4 hover:underline"
                >
                  status page
                </a>
                .
              </p>
            </div>

            <div className="border-t border-[color:var(--hairline)] pt-6">
              <h2 className="text-sm font-semibold text-[color:var(--day-ink)]">
                Mailing address
              </h2>
              <p className="mt-1 text-sm text-[color:var(--ink-70)]">
                {businessIdentityLine()}
              </p>
            </div>
          </div>
        </div>
      </Container>
    </>
  );
}
