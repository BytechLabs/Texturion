"use client";

import { useState } from "react";
import { FileText, Send } from "lucide-react";

import {
  QUOTE_STATUS_KEYS,
  billingCurrencyOf,
  formatMoney,
  isQuoteDecided,
  roleHasCapability,
} from "@loonext/shared";

import { useT, type Translate } from "@/i18n/provider";
import { useCreateQuote, useQuotes, useSendQuote, type Quote } from "@/lib/api/quotes";
import { useActiveCompany } from "@/lib/company/provider";
import { cn } from "@/lib/utils";

/**
 * #287 — what this thread has been quoted, and the way to quote it.
 *
 * ## Why a strip beside the composer rather than a bubble
 *
 * The same reasoning #224's payment strip settled, and it applies harder here.
 * The message carrying the quote link is already in the transcript exactly as
 * the customer received it. What is NOT in the transcript is the STATE — sent,
 * opened, accepted, lapsed — and three of those four change with nobody in the
 * workspace doing anything. A bubble would have to mutate after the fact,
 * which is the one thing a transcript must never do.
 *
 * ## `effective_status`, never `status`
 *
 * Nothing writes `expired`. A row that lapsed an hour ago still says `sent`,
 * and a strip rendering the stored column would show a live offer on a price
 * the business has already withdrawn — to the crew, who would then chase it.
 *
 * ## The form
 *
 * *Smart Defaults*: the expiry is pre-filled at 14 days. It is the one field
 * whose answer a crew member does not care about and cannot leave blank, so
 * asking them to type it is pure friction; the amount and the work are theirs
 * and are deliberately empty, because a default price is a wrong price.
 *
 * *Ethical Friction, calibrated*: creating is not sending. A draft costs
 * nothing and is invisible to the customer, so it needs no ceremony. SEND is
 * the customer-visible act that binds a price, so the button carries the
 * amount rather than saying "Send" — you cannot press it without the figure in
 * your eye, which is the same reasoning the public page uses for Accept.
 *
 * *Zen of Clarity*: the strip is absent entirely on almost every thread, and
 * a decided quote drops out of it. History is what the timeline is for.
 */

/** Rows worth keeping above the composer: live, or decided in the last week. */
const RECENT_DECISION_MS = 7 * 24 * 60 * 60 * 1000;

/** The expiry a crew member does not have to think about. */
const DEFAULT_EXPIRY_DAYS = 14;

function isWorthShowing(quote: Quote, now: number): boolean {
  if (!isQuoteDecided(quote.effective_status)) return true;
  const decided = quote.decided_at ? Date.parse(quote.decided_at) : Number.NaN;
  if (Number.isNaN(decided)) return false;
  return now - decided < RECENT_DECISION_MS;
}

function QuoteRow({
  quote,
  onSend,
  onAskForPayment,
  sending,
  canSend,
  t,
}: {
  quote: Quote;
  onSend: () => void;
  /** #287: accepted → pay now, carrying the agreed figure. */
  onAskForPayment: () => void;
  sending: boolean;
  canSend: boolean;
  t: Translate;
}) {
  // The row carries its own currency, the way a payment request does: a
  // quote is denominated at the moment it is written, and a workspace that
  // later changes billing currency must not restate old prices.
  const amount = formatMoney(quote.amount_cents, billingCurrencyOf(quote.currency));
  const isDraft = quote.effective_status === "draft";

  return (
    <div className="flex items-center gap-2 py-1.5 text-[13px]">
      <FileText
        className="size-3.5 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
      <span className="tabular-nums font-medium">{amount}</span>
      <span className="min-w-0 flex-1 truncate text-muted-foreground">
        {quote.description}
      </span>
      <span
        className={cn(
          "shrink-0",
          quote.effective_status === "accepted"
            ? "text-success"
            : quote.effective_status === "expired" ||
                quote.effective_status === "declined"
              ? "text-muted-foreground"
              : "text-foreground",
        )}
      >
        {t(QUOTE_STATUS_KEYS[quote.effective_status])}
      </span>
      {/* #287 — the loop the issue says makes both features worth more than
          either alone: a price the customer has already agreed to, taken
          without anybody retyping it. Only on an ACCEPTED quote, because
          asking for money against one nobody answered is the ask this product
          does not make. */}
      {quote.effective_status === "accepted" && canSend && (
        <button
          type="button"
          onClick={onAskForPayment}
          className="tap-target inline-flex shrink-0 items-center gap-1 rounded-app-ctrl px-2 text-[13px] font-medium text-primary hover:underline"
        >
          {t("quotes.askForPayment")}
        </button>
      )}
      {isDraft && canSend && (
        <button
          type="button"
          onClick={onSend}
          disabled={sending}
          /* The amount rides on the button: this is the act the customer sees,
             and it binds a price. */
          className="tap-target inline-flex shrink-0 items-center gap-1 rounded-app-ctrl px-2 text-[13px] font-medium text-primary hover:underline disabled:opacity-60"
        >
          <Send className="size-3.5" aria-hidden="true" />
          {sending ? t("quotes.sending") : t("quotes.sendFor", { amount })}
        </button>
      )}
    </div>
  );
}

export function QuoteStrip({
  conversationId,
  onAskForPayment,
}: {
  conversationId: string;
  /** Handed up to the composer, which owns the payment form beside this. */
  onAskForPayment?: (prefill: { amountCents: number; description: string }) => void;
}) {
  const t = useT();
  const { role } = useActiveCompany();
  const canSend = roleHasCapability(role, "conversations.send");
  const quotes = useQuotes(conversationId);
  const create = useCreateQuote(conversationId);
  const send = useSendQuote(conversationId);

  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);

  const now = Date.now();
  const rows = (quotes.data?.data ?? []).filter((quote) =>
    isWorthShowing(quote, now),
  );

  // Absent entirely when there is nothing to say and nothing to offer.
  if (rows.length === 0 && !canSend) return null;

  function submit() {
    setError(null);
    const dollars = Number.parseFloat(amount.replace(/[^0-9.]/g, ""));
    if (!Number.isFinite(dollars) || dollars <= 0) {
      setError(t("quotes.needAmount"));
      return;
    }
    if (description.trim().length === 0) {
      setError(t("quotes.needDescription"));
      return;
    }
    create.mutate(
      {
        amountCents: Math.round(dollars * 100),
        description: description.trim(),
        expiresAt: new Date(
          now + DEFAULT_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
        ).toISOString(),
      },
      {
        onSuccess: () => {
          setAmount("");
          setDescription("");
          setOpen(false);
        },
        // A thread with no contact is the one server-side refusal a person
        // can act on, so it gets its own line rather than the generic one.
        onError: (cause: unknown) =>
          setError(
            String(cause).includes("no contact")
              ? t("quotes.needContact")
              : t("quotes.createFailed"),
          ),
      },
    );
  }

  return (
    <div className="mx-auto w-full max-w-[42rem] px-1 pb-2">
      {rows.map((quote) => (
        <QuoteRow
          key={quote.id}
          quote={quote}
          t={t}
          canSend={canSend}
          sending={send.isPending && send.variables === quote.id}
          onSend={() => send.mutate(quote.id)}
          onAskForPayment={() =>
            onAskForPayment?.({
              amountCents: quote.amount_cents,
              description: quote.description,
            })
          }
        />
      ))}

      {canSend && !open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="tap-target inline-flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground"
        >
          <FileText className="size-3.5" aria-hidden="true" />
          {t("quotes.newQuote")}
        </button>
      )}

      {canSend && open && (
        <div className="mt-1 space-y-2 rounded-app-card border border-app-line p-3">
          <div className="flex gap-2">
            <input
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder={t("quotes.amountPlaceholder")}
              aria-label={t("quotes.amountLabel")}
              /* 16px so iOS does not zoom the whole shell on focus. */
              className="w-28 rounded-app-ctrl border border-app-line px-2 py-1.5 text-[16px] tabular-nums"
            />
            <input
              type="text"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={t("quotes.descriptionPlaceholder")}
              aria-label={t("quotes.descriptionLabel")}
              className="min-w-0 flex-1 rounded-app-ctrl border border-app-line px-2 py-1.5 text-[16px]"
            />
          </div>

          {/* The default, said out loud rather than hidden in a field nobody
              filled in. A price with no expiry binds the business forever. */}
          <p className="text-[12px] text-muted-foreground">
            {t("quotes.expiresInDays", { days: String(DEFAULT_EXPIRY_DAYS) })}
          </p>

          {error && (
            <p role="alert" className="text-[13px] text-destructive">
              {error}
            </p>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={submit}
              disabled={create.isPending}
              className="tap-target rounded-app-ctrl bg-primary px-3 py-1.5 text-[13px] font-medium text-primary-foreground disabled:opacity-60"
            >
              {create.isPending ? t("quotes.saving") : t("quotes.saveDraft")}
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setError(null);
              }}
              className="tap-target rounded-app-ctrl px-3 py-1.5 text-[13px] text-muted-foreground hover:text-foreground"
            >
              {t("common.cancel")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
