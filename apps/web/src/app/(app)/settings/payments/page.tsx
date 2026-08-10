"use client";

import { PaymentsCard } from "@/components/settings/payments-card";
import { SettingsPage } from "@/components/settings/section";

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
  return (
    <SettingsPage
      title="Getting paid"
      description="Ask a customer for a deposit or a final payment, right in the thread."
    >
      <PaymentsCard />
    </SettingsPage>
  );
}
