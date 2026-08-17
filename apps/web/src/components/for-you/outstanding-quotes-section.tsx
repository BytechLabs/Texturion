"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { billingCurrencyOf, formatMoney } from "@loonext/shared";

import { useT } from "@/i18n/provider";
import { useOutstandingQuotes } from "@/lib/api/quotes";
import { formatRelativeTime } from "@/lib/format/time";
import { Section } from "@/components/for-you/section";

/** #287: a morning's worth. The rest is the thread list's job. */
const OUTSTANDING_QUOTES_LIMIT = 6;

/**
 * #287 — the quotes nobody has answered yet.
 *
 * ## Why this is a queue and not a number
 *
 * The issue calls outstanding quotes "the highest-value thing in the business"
 * and says the product "cannot tell you which ones are outstanding". A COUNT
 * cannot: "3 waiting" is a fact, and the work is knowing WHICH three and being
 * one tap from the thread. The pipeline card above already carries the figure;
 * this is the list under it.
 *
 * ## Why it is not hideable
 *
 * `dashboard-panels.ts` draws the line at work: the measures come off, the
 * queues do not, because "hiding Unassigned is a way to stop seeing leads that
 * nobody has claimed". Money a customer was asked for and has not answered is
 * the same kind of thing — and it is the one queue whose cost is counted in
 * revenue rather than in goodwill.
 *
 * ## Sorted oldest first
 *
 * The opposite of the transcript's order, and deliberately. A quote sent this
 * morning needs nothing; one sent nine days ago is the one going cold. *Applying:
 * Loss Aversion — the top of this list is money about to be lost, not the most
 * recent thing that happened.*
 */
export function OutstandingQuotesSection() {
  const t = useT();
  const quotes = useOutstandingQuotes();
  const rows = (quotes.data?.data ?? [])
    .slice()
    .sort((a, b) => (a.sent_at ?? "").localeCompare(b.sent_at ?? ""))
    .slice(0, OUTSTANDING_QUOTES_LIMIT);

  // Absent entirely when nothing is waiting. A workspace that has answered
  // everything is told nothing, the same way the measures disappear rather
  // than showing an encouraging zero.
  if (rows.length === 0) return null;

  return (
    <Section label={t("quotes.outstandingTitle")} count={rows.length}>
      {rows.map((quote) => (
        <Link
          key={quote.id}
          href={`/inbox/${quote.conversation_id}`}
          className="flex items-center gap-2.5 px-3 py-2.5 text-[13px] transition-colors duration-150 ease-out hover:bg-app-hover"
        >
          <span className="tabular-nums font-medium">
            {formatMoney(quote.amount_cents, billingCurrencyOf(quote.currency))}
          </span>
          <span className="min-w-0 flex-1 truncate text-app-muted">
            {quote.description}
          </span>
          {/* WHEN it went out, not when it expires. "Sent 9 days ago" is the
              fact that decides whether to chase; the deadline is the reason
              the row will vanish on its own. */}
          <span className="shrink-0 text-[12px] text-app-muted-2">
            {quote.sent_at ? formatRelativeTime(quote.sent_at) : ""}
          </span>
          <ArrowRight className="size-3.5 shrink-0 text-app-muted-2" strokeWidth={1.75} aria-hidden />
        </Link>
      ))}
    </Section>
  );
}
