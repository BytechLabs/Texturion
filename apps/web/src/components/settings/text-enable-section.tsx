"use client";

import { LoadError, SettingsCard } from "@/components/settings/section";
import { StartTextEnableDialog } from "@/components/settings/start-text-enable-dialog";
import { TextEnableCard } from "@/components/settings/text-enable-card";
import { splitHostedNumbers } from "@/components/settings/text-enable-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useTextEnablements } from "@/lib/api/text-enablement";
import type { CompanyView, PhoneNumberSummary } from "@/lib/api/types";
import { useActiveCompany } from "@/lib/company/provider";

/**
 * Settings → Numbers text-enable section (FEATURE-GAPS voice wave, path B):
 * lists the company's keep-your-number text-enablements as calm one-status
 * cards and offers an owner/admin the "text-enable your landline" start flow.
 * Voice stays with the current carrier — this is the alternative to a full
 * port (PortSection) for owners who want to keep their carrier. Renders
 * nothing (except the start affordance) when there are no orders, so the
 * numbers page stays clean for the common new-number case.
 *
 * Each card also receives its linked `phone_numbers[source=hosted]` row
 * (matched by E.164 from the company-view numbers embed — the sanitized order
 * payload carries no row id), which powers the owner-only release of a
 * completed enablement.
 */
export function TextEnableSection({ company }: { company: CompanyView }) {
  const { role } = useActiveCompany();
  const enablements = useTextEnablements();

  // The hosted rows, newest first match preference: a non-released row wins
  // over an old released one for the same E.164 (a cancelled + restarted
  // enablement leaves a released sibling behind).
  const { hosted } = splitHostedNumbers(company.numbers);
  function hostedRowFor(phoneE164: string): PhoneNumberSummary | null {
    const rows = hosted.filter((n) => n.number_e164 === phoneE164);
    return rows.find((n) => n.status !== "released") ?? rows[0] ?? null;
  }

  const canStart = role === "owner" || role === "admin";
  const active = company.subscription_status === "active";

  if (enablements.isPending) {
    return (
      <SettingsCard title="Text-enabled numbers">
        <Skeleton className="h-32 w-full" />
      </SettingsCard>
    );
  }
  if (enablements.isError) {
    return (
      <SettingsCard title="Text-enabled numbers">
        <LoadError onRetry={() => enablements.refetch()} />
      </SettingsCard>
    );
  }

  const rows = enablements.data.data;

  // No orders yet: only surface the start affordance to O/A on an active
  // subscription (an enablement is a Telnyx-committing, post-payment action).
  if (rows.length === 0) {
    if (!canStart || !active) return null;
    return (
      <SettingsCard
        title="Text-enable your existing landline"
        description="Keep the number and the carrier you have — JobText adds texting to it. Calls don't change; the carrier review takes a few business days, and texting goes live once it completes."
      >
        <StartTextEnableDialog />
      </SettingsCard>
    );
  }

  return (
    <SettingsCard
      title="Text-enabled numbers"
      description="Adding texting to numbers that keep their current carrier."
    >
      <div className="space-y-5">
        {rows.map((order) => (
          <TextEnableCard
            key={order.id}
            order={order}
            hostedNumber={hostedRowFor(order.phone_e164)}
          />
        ))}
        {canStart && active ? (
          <div className="border-t border-border-subtle pt-4">
            <StartTextEnableDialog />
          </div>
        ) : null}
      </div>
    </SettingsCard>
  );
}
