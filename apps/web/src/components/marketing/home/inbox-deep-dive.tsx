/**
 * Inbox deep-dive section (Track B) — §3.4 / COPY §H4.
 * Ledger identity (iteration 5): section `04` on the spine. Carries the SAME
 * ledger-row grammar as the hero desk — the recurring `#0119 · filed · Dale`
 * ticket-meta header (REFERENCES #9 / ELEVATE #2: the row literally reappears),
 * so the deep-dive reads as the same instrument, not a new UI. The steppable
 * island is deferred (LazyThreadDeepDive); the server ships the COMPLETED
 * annotated thread as static DOM (meaningful with JS off / reduced-motion).
 */

import { LedgerSection } from "@/components/marketing/ledger/ledger-section";
import { SectionEyebrow } from "@/components/marketing/ledger/section-number";
import { LedgerRow, TicketMeta } from "@/components/marketing/ledger/ticket";
import { LazyThreadDeepDive } from "@/components/marketing/lazy/lazy-thread-deep-dive";
import { ThreadDeepDiveStatic } from "@/components/marketing/thread-demo/thread-deep-dive-static";
import { WATER_HEATER_SCRIPT } from "@/components/marketing/thread-demo/script";

export function InboxDeepDive() {
  return (
    <LedgerSection n={4} defer intrinsic={960}>
      {/* The recurring ledger-row header — the hero's ticket, reappearing. */}
      <LedgerRow status="filed" className="mb-10 max-w-md">
        <div className="flex items-center justify-between gap-3 px-3 py-2">
          <SectionEyebrow n={4} label="The same job, slowed down" />
          <TicketMeta id="#0119" status="filed" assignee="Dale" />
        </div>
      </LedgerRow>

      <LazyThreadDeepDive
        script={WATER_HEATER_SCRIPT}
        fallback={<ThreadDeepDiveStatic script={WATER_HEATER_SCRIPT} />}
      />
    </LedgerSection>
  );
}
