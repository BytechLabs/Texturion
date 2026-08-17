"use client";

import Link from "next/link";
import { useState } from "react";

import {
  billingCurrencyOf,
  followUpPresets,
  formatMoney,
  roleHasCapability,
} from "@loonext/shared";

import { useT } from "@/i18n/provider";
import { useSnoozeConversation } from "@/lib/api/conversations";
import { useOutstandingQuotes } from "@/lib/api/quotes";
import { useActiveCompany } from "@/lib/company/provider";
import { formatRelativeTime } from "@/lib/format/time";
import { Section } from "@/components/for-you/section";

/** #287: a morning's worth. The rest is the thread list's job. */
const OUTSTANDING_QUOTES_LIMIT = 6;

/**
 * The API caps a deferral note at 120 characters. Every client truncates to the
 * same figure — a note built from a long description would otherwise 422 on
 * whichever client forgot, which reads to the crew as "chasing is broken".
 */
const NOTE_MAX = 120;

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
  const { role } = useActiveCompany();
  const quotes = useOutstandingQuotes();
  const snooze = useSnoozeConversation();
  /**
   * Which rows have been chased in this session. The queue returns quotes, and
   * a deferral lives on the CONVERSATION — so there is no field on a quote to
   * read this back from, and inventing one would mean a second fetch per row to
   * answer a question that only matters for the seconds after a click.
   */
  const [chased, setChased] = useState<Record<string, boolean>>({});

  const rows = (quotes.data?.data ?? [])
    .slice()
    .sort((a, b) => (a.sent_at ?? "").localeCompare(b.sent_at ?? ""))
    .slice(0, OUTSTANDING_QUOTES_LIMIT);

  // Absent entirely when nothing is waiting. A workspace that has answered
  // everything is told nothing, the same way the measures disappear rather
  // than showing an encouraging zero.
  if (rows.length === 0) return null;

  // Chasing writes a note on a thread, which `read_only` cannot do. An observer
  // still reads the queue — the list is the report, and hiding it would leave
  // somebody who can see every thread unable to see the money in them.
  const canChase = roleHasCapability(role, "conversations.note");

  return (
    <Section label={t("quotes.outstandingTitle")} count={rows.length}>
      {rows.map((quote) => {
        const amount = formatMoney(
          quote.amount_cents,
          billingCurrencyOf(quote.currency),
        );
        return (
          <div
            key={quote.id}
            className="flex items-center gap-2.5 pr-2 text-[13px] transition-colors duration-150 ease-out hover:bg-app-hover"
          >
            <Link
              href={`/inbox/${quote.conversation_id}`}
              className="flex min-w-0 flex-1 items-center gap-2.5 px-3 py-2.5"
            >
              <span className="tabular-nums font-medium">{amount}</span>
              <span className="min-w-0 flex-1 truncate text-app-muted">
                {quote.description}
              </span>
              {/* WHEN it went out, not when it expires. "Sent 9 days ago" is the
                  fact that decides whether to chase; the deadline is the reason
                  the row will vanish on its own. */}
              <span className="shrink-0 text-[12px] text-app-muted-2">
                {quote.sent_at ? formatRelativeTime(quote.sent_at) : ""}
              </span>
            </Link>
            {canChase && (
              <ChaseButton
                chased={chased[quote.id] === true}
                pending={
                  snooze.isPending &&
                  snooze.variables?.conversationId === quote.conversation_id
                }
                onChase={() => {
                  /*
                   * #287's acceptance asks for "a queue with follow-up", and
                   * the follow-up ladder from #293 already exists — its own
                   * comment says "this afternoon" is "a meaningless time to
                   * chase a quote". So this reuses it rather than inventing a
                   * fourth clock: the soonest rung, which is three days out.
                   *
                   * ONE TAP, no picker. *Applying: Smart Defaults* — the quote
                   * knows its own figure and its own scope, and a chase that
                   * costs a date-picker is one nobody sets. The thread's own
                   * menu re-times it for the crew member who wants Friday.
                   */
                  const when = followUpPresets()[0];
                  if (!when) return;
                  setChased((prior) => ({ ...prior, [quote.id]: true }));
                  snooze.mutate(
                    {
                      conversationId: quote.conversation_id,
                      until: new Date(when.at).toISOString(),
                      kind: "follow_up",
                      // The note is what makes the reminder actionable three
                      // days later: "Chase this" is a chore, and "Chase the
                      // $450 quote — replace the water heater" is a job.
                      note: t("quotes.chaseNote", {
                        amount,
                        description: quote.description,
                      }).slice(0, NOTE_MAX),
                    },
                    {
                      // Put the button back on failure. A row that says
                      // "Chasing" with nothing scheduled is worse than one that
                      // never claimed to.
                      onError: () =>
                        setChased((prior) => ({ ...prior, [quote.id]: false })),
                    },
                  );
                }}
                label={t("quotes.chase")}
                doneLabel={t("quotes.chasing")}
              />
            )}
          </div>
        );
      })}
    </Section>
  );
}

/**
 * The row's one piece of work, and the only control on it.
 *
 * *Applying: Zen of Clarity* — the trailing slot holds an action rather than a
 * decorative chevron, because the row itself is already the doorway into the
 * thread and a second "you can open this" says nothing.
 */
function ChaseButton({
  chased,
  pending,
  onChase,
  label,
  doneLabel,
}: {
  chased: boolean;
  pending: boolean;
  onChase: () => void;
  label: string;
  doneLabel: string;
}) {
  if (chased) {
    return (
      <span className="shrink-0 px-2 text-[12px] font-medium text-app-muted-2">
        {doneLabel}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onChase}
      disabled={pending}
      className="tap-target shrink-0 rounded-app-ctrl px-2 text-[12px] font-medium text-primary hover:underline disabled:opacity-50"
    >
      {label}
    </button>
  );
}
