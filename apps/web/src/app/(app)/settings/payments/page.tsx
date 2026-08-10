"use client";

import { PaymentsCard } from "@/components/settings/payments-card";
import { SettingsPage } from "@/components/settings/section";
import { useT } from "@/i18n/provider";

/**
 * #224 — Settings → Getting paid.
 *
 * Its own section rather than a card on Billing, and the two are adjacent in
 * the nav for exactly that reason: Billing is what WE charge the business,
 * this is what the business charges a homeowner. One screen holding both would
 * put "your plan renews on the 3rd" beside "your bank account" and make neither
 * legible. *Applying: Chunking, and the Safety principle — a section whose
 * subject is unambiguous is one somebody trusts.*
 */
export default function PaymentsSettingsPage() {
  const t = useT();
  return (
    <SettingsPage
      title={t("payments.settingsTitle")}
      description={t("payments.settingsDescription")}
    >
      <PaymentsCard />
    </SettingsPage>
  );
}
