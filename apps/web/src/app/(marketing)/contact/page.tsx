import type { Metadata } from "next";

import {
  ConvergedField,
  Dateline,
  FrCard,
  FrSection,
} from "@/components/marketing/fr";
import { JsonLd } from "@/components/marketing/ui/json-ld";
import {
  HAS_BUSINESS_IDENTITY,
  LEGAL_ENTITY_NAME,
  MAILING_ADDRESS,
  SECURITY_EMAIL,
  SUPPORT_EMAIL,
} from "@/lib/marketing/business";
import { breadcrumbJsonLd, buildMetadata } from "@/lib/marketing/seo";

import { ContactForm } from "./contact-form";

const PATH = "/contact";

export const metadata: Metadata = buildMetadata({
  title: "Contact",
  description:
    "Email Loonext and a real person answers. No sales team and no phone tree: your message goes straight to the small crew who built and run the product.",
  path: PATH,
});

/** Inline cobalt link (the marketing link voice). */
function ContactLink({
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

/**
 * CONTACT (DESIGN-DIRECTION v4 §6, COPY-DECK v2): the short work-order form
 * plus the founder reply promise. The form POSTs to the PUBLIC POST /contact
 * endpoint (apps/api/src/routes/contact.ts), which forwards the message to the
 * support inbox and acknowledges the sender, so the reply promise stays
 * literally true. A pre-filled mailto remains as a fallback for people who
 * prefer their own mail client.
 */
export default function ContactPage() {
  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Home", path: "/" },
          { name: "Contact", path: PATH },
        ])}
      />
      <FrSection ground="white">
        <div className="max-w-3xl">
          <ConvergedField variant="mark" className="h-9 w-auto" />
          <div className="mt-6">
            <Dateline>GET IN TOUCH</Dateline>
          </div>
          <h1 className="fr-h1 mt-5 text-[color:var(--fr-ink)]">
            Email us. We answer.
          </h1>
          <p className="fr-body mt-5 max-w-[58ch] text-[color:var(--fr-ink-70)]">
            No sales team, no runaround. You&apos;ll get a reply from one of the
            people who built Loonext.
          </p>
        </div>

        <div className="mt-12 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          <FrCard className="p-6 sm:p-8">
            <ContactForm />
          </FrCard>

          <div className="space-y-6">
            <FrCard well className="p-6">
              <h2 className="fr-h3 text-[color:var(--fr-ink)]">Support</h2>
              <p className="mt-1.5 text-sm leading-relaxed text-[color:var(--fr-ink-70)]">
                Questions, billing, anything about your account.
              </p>
              <p className="mt-2">
                <ContactLink href={`mailto:${SUPPORT_EMAIL}`}>
                  {SUPPORT_EMAIL}
                </ContactLink>
              </p>
            </FrCard>

            <FrCard well className="p-6">
              <h2 className="fr-h3 text-[color:var(--fr-ink)]">
                Security and responsible disclosure
              </h2>
              <p className="mt-1.5 text-sm leading-relaxed text-[color:var(--fr-ink-70)]">
                Found a vulnerability? See our{" "}
                <ContactLink href="/security">security page</ContactLink>, or
                email
              </p>
              <p className="mt-2">
                <ContactLink href={`mailto:${SECURITY_EMAIL}`}>
                  {SECURITY_EMAIL}
                </ContactLink>
              </p>
            </FrCard>

            <FrCard well className="p-6">
              <h2 className="fr-h3 text-[color:var(--fr-ink)]">
                Service status
              </h2>
              <p className="mt-1.5 text-sm leading-relaxed text-[color:var(--fr-ink-70)]">
                Check whether it&apos;s us on our{" "}
                <ContactLink href="/status">status page</ContactLink>.
              </p>
            </FrCard>

            {/* Identity renders only once ops supplies the real legal entity
                and mailing address; never a placeholder (purge 7). */}
            {HAS_BUSINESS_IDENTITY && (
              <FrCard well className="p-6">
                <h2 className="fr-h3 text-[color:var(--fr-ink)]">
                  Mailing address
                </h2>
                <p className="mt-1.5 text-sm leading-relaxed text-[color:var(--fr-ink-70)]">
                  {LEGAL_ENTITY_NAME}
                  <br />
                  {MAILING_ADDRESS}
                </p>
              </FrCard>
            )}
          </div>
        </div>
      </FrSection>
    </>
  );
}
