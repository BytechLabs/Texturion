import { CheckCircle2 } from "lucide-react";
import type { Metadata } from "next";

import { Container } from "@/components/marketing/ui/container";
import { JsonLd } from "@/components/marketing/ui/json-ld";
import { SUPPORT_EMAIL } from "@/lib/marketing/business";
import { breadcrumbJsonLd, buildMetadata } from "@/lib/marketing/seo";

const PATH = "/status";

export const metadata: Metadata = buildMetadata({
  title: "Status",
  description:
    "JobText service status. A live, hosted status page with incident history is on the way at status.jobtext.app; this page won't fake live metrics until it's wired up.",
  path: PATH,
});

/**
 * Honest static status page (BLUEPRINT §2, §14): states the current posture
 * plainly and says the live, hosted status page (Instatus/BetterStack at
 * status.jobtext.app) is being stood up. We do NOT fabricate live uptime numbers
 * or component metrics — that would be the opposite of the trust this page is
 * meant to earn.
 */
export default function StatusPage() {
  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Home", path: "/" },
          { name: "Status", path: PATH },
        ])}
      />
      <Container className="py-16 sm:py-24">
        <div className="mx-auto max-w-2xl">
          <p className="text-sm font-semibold text-primary">Status</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            Is it down, or is it me?
          </h1>
          <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
            JobText hard-gates outbound texting on carrier approval and sells
            trust through honesty, so a real status page matters. Here&apos;s
            where things stand.
          </p>

          <div className="mt-8 flex items-center gap-3 rounded-lg border border-border bg-card p-5">
            <CheckCircle2
              className="size-6 shrink-0 text-[var(--success)]"
              strokeWidth={1.75}
              aria-hidden="true"
            />
            <div>
              <p className="font-medium text-foreground">
                All systems operational
              </p>
              <p className="text-sm text-muted-foreground">
                No incidents reported.
              </p>
            </div>
          </div>

          <div className="mt-8 space-y-4 text-sm leading-relaxed text-muted-foreground">
            <p>
              A live, hosted status page — with real-time component health and a
              full incident history — is being stood up at{" "}
              <span className="font-medium text-foreground">
                status.jobtext.app
              </span>
              . Until it&apos;s wired up, we won&apos;t show fabricated uptime
              numbers here; when it&apos;s live, this page will point straight to
              it.
            </p>
            <p>
              Two things worth knowing about how texting works, so an outage and
              normal behavior don&apos;t get confused:
            </p>
            <ul className="list-disc space-y-2 pl-6">
              <li>
                <strong className="text-foreground/90">
                  US texting activates after carrier approval
                </strong>{" "}
                (typically 3–7 business days after you pay). If your US texts
                aren&apos;t sending yet, that&apos;s the approval wait, not an
                outage — receiving texts and texting Canadian numbers work the
                whole time.
              </li>
              <li>
                <strong className="text-foreground/90">
                  Delivery depends on the phone companies and carriers
                </strong>
                , which we don&apos;t control. When they have trouble, texts can
                be delayed even though JobText itself is up.
              </li>
            </ul>
            <p>
              Seeing something that looks like an outage? Email{" "}
              <a
                href={`mailto:${SUPPORT_EMAIL}`}
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                {SUPPORT_EMAIL}
              </a>{" "}
              and we&apos;ll take a look.
            </p>
          </div>
        </div>
      </Container>
    </>
  );
}
