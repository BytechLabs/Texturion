"use client";

import { useCallback, useState } from "react";
import { FileText, Pencil, Send, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

import {
  billingCurrencyOf,
  formatMoney,
  isQuoteDecided,
  parseMoneyInputToCents,
  QUOTE_STATUS_KEYS,
} from "@loonext/shared";

import { useLocale, useT } from '@/i18n/provider';
import type { Translate } from '@/i18n/provider';
import { useChangeQuoteDraft, useCreateQuote, useQuoteDecision, useQuotes, useSendQuote } from '@/lib/api/quotes';
import type { Quote, QuoteDecisionAction } from '@/lib/api/quotes';
import { cn } from "@/lib/utils";

const DECISION_COPY = {
  withdraw: { title: "quotes.withdrawTitle", description: "quotes.withdrawDetail", label: "quotes.withdraw" },
  decline: { title: "quotes.markDeclined", description: "quotes.declineCrewDetail", label: "quotes.markDeclined" },
  "undo-acceptance": {
    title: "quotes.undoAcceptance",
    description: "quotes.undoAcceptanceDetail",
    label: "quotes.undoAcceptance",
  },
} as const;

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
  if (quote.allowed_actions?.includes("undo_acceptance") && Date.parse(quote.expires_at) > now) return true;
  const status = quote.effective_status;
  if (status !== "withdrawn" && !isQuoteDecided(status)) return true;
  const decided = quote.decided_at ? Date.parse(quote.decided_at) : Number.NaN;
  if (Number.isNaN(decided)) return false;
  return now - decided < RECENT_DECISION_MS;
}

function QuoteRow({
  quote,
  onSend,
  onAskForPayment,
  onDecision,
  onEdit,
  onDelete,
  sending,
  canSend,
  t,
}: {
  quote: Quote;
  onSend: () => void;
  /** #287: accepted → pay now, carrying the agreed figure. */
  onAskForPayment: () => void;
  onDecision: (action: QuoteDecisionAction) => void;
  onEdit: () => void;
  onDelete: () => void;
  sending: boolean;
  canSend: boolean;
  t: Translate;
}) {
  // The row carries its own currency, the way a payment request does: a
  // quote is denominated at the moment it is written, and a workspace that
  // later changes billing currency must not restate old prices.
  const currency = billingCurrencyOf(quote.currency);
  const amount = formatMoney(quote.amount_cents, currency, currency, t.locale);
  const isDraft = quote.effective_status === "draft";

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 py-1.5 text-[13px]">
      <div className="flex min-w-0 grow basis-48 items-center gap-2">
        <FileText
          className="size-3.5 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
        <span className="shrink-0 tabular-nums font-medium">{amount}</span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground">
          {quote.description}
        </span>
        <span
          className={cn(
            "shrink-0",
            quote.effective_status === "accepted"
              ? "text-success"
              : (quote.effective_status === "expired" ||
                  quote.effective_status === "declined" ||
                  quote.effective_status === "withdrawn"
                ? "text-muted-foreground"
                : "text-foreground"),
          )}
        >
          {t(QUOTE_STATUS_KEYS[quote.effective_status])}
        </span>
      </div>
      <div className="flex max-w-full flex-wrap items-center gap-1 empty:hidden">
        {/* #287 — the loop the issue says makes both features worth more than
            either alone: a price the customer has already agreed to, taken
            without anybody retyping it. Only on an ACCEPTED quote, because
            asking for money against one nobody answered is the ask this product
            does not make. */}
        {quote.effective_status === "accepted" && canSend && (
          <button
            type="button"
            onClick={onAskForPayment}
            className="tap-target inline-flex max-w-full items-center gap-1 text-left rounded-app-ctrl px-2 text-[13px] font-medium text-primary hover:underline"
          >
            {t("quotes.askForPayment")}
          </button>
        )}
        {canSend && (quote.allowed_actions?.includes("send") ?? isDraft) && (
          <button
            type="button"
            onClick={onSend}
            disabled={sending}
            /* The amount rides on the button: this is the act the customer sees,
               and it binds a price. */
            className="tap-target inline-flex max-w-full items-center gap-1 text-left rounded-app-ctrl px-2 text-[13px] font-medium text-primary hover:underline disabled:opacity-60"
          >
            <Send className="size-3.5 shrink-0" aria-hidden="true" />
            {sending ? t("quotes.sending") : t("quotes.sendFor", { amount })}
          </button>
        )}
        {canSend && quote.allowed_actions?.includes("withdraw") && (
          <button
            type="button"
            onClick={() => onDecision("withdraw")}
            className="tap-target shrink-0 rounded-app-ctrl px-2 font-medium text-primary hover:underline"
          >
            {t("quotes.withdraw")}
          </button>
        )}
        {canSend && quote.allowed_actions?.includes("decline") && (
          <button
            type="button"
            onClick={() => onDecision("decline")}
            className="tap-target shrink-0 rounded-app-ctrl px-2 font-medium text-primary hover:underline"
          >
            {t("quotes.markDeclined")}
          </button>
        )}
        {quote.allowed_actions?.includes("undo_acceptance") && (
          <button
            type="button"
            onClick={() => onDecision("undo-acceptance")}
            className="tap-target shrink-0 rounded-app-ctrl px-2 font-medium text-primary hover:underline"
          >
            {t("quotes.undoAcceptance")}
          </button>
        )}
        {canSend && quote.allowed_actions?.includes("edit") && (
          <button
            type="button"
            onClick={onEdit}
            aria-label={t("quotes.editDraft")}
            className="tap-target rounded-app-ctrl px-2 text-primary"
          >
            <Pencil className="size-3.5" aria-hidden />
          </button>
        )}
        {canSend && quote.allowed_actions?.includes("delete") && (
          <button
            type="button"
            onClick={onDelete}
            aria-label={t("quotes.deleteDraft")}
            className="tap-target rounded-app-ctrl px-2 text-primary"
          >
            <Trash2 className="size-3.5" aria-hidden />
          </button>
        )}
      </div>
    </div>
  );
}

export function QuoteStrip({
  conversationId,
  canSend,
  draftOpen,
  onCloseDraft,
  onAskForPayment,
}: {
  conversationId: string;
  canSend: boolean;
  draftOpen: boolean;
  onCloseDraft: () => void;
  /** Handed up to the composer, which owns the payment form beside this. */
  onAskForPayment?: (prefill: { amountCents: number; description: string }) => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  const quotes = useQuotes(conversationId);
  const create = useCreateQuote(conversationId);
  const send = useSendQuote(conversationId);
  const decision = useQuoteDecision(conversationId);
  const changeDraft = useChangeQuoteDraft(conversationId);

  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [quoteDecision, setQuoteDecision] = useState<{ id: string; action: QuoteDecisionAction } | null>(null);
  const [reason, setReason] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const focusAmount = useCallback((input: HTMLInputElement | null) => {
    input?.focus();
  }, []);
  const showForm = canSend && (draftOpen || editId !== null);
  const decisionCopy = quoteDecision && DECISION_COPY[quoteDecision.action];

  const now = Date.now();
  const rows = (quotes.data?.data ?? []).filter((quote) =>
    isWorthShowing(quote, now),
  );

  if (rows.length === 0 && !showForm) return null;

  function closeForm() {
    setEditId(null);
    setAmount("");
    setDescription("");
    setError(null);
    onCloseDraft();
  }

  function submit() {
    setError(null);
    const amountCents = parseMoneyInputToCents(amount, locale);
    if (amountCents === null || amountCents <= 0) {
      setError(t("quotes.needAmount"));
      return;
    }
    if (description.trim().length === 0) {
      setError(t("quotes.needDescription"));
      return;
    }
    const expiresAt = new Date(now + DEFAULT_EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString();
    if (editId) {
      changeDraft.mutate({
        id: editId,
        draft: { amount_cents: amountCents, description: description.trim(), expires_at: expiresAt },
      }, {
        onSuccess: closeForm,
        onError: () => setError(t("quotes.editDraftFailed")),
      });
      return;
    }
    create.mutate(
      {
        amountCents,
        description: description.trim(),
        expiresAt,
      },
      {
        onSuccess: closeForm,
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
          onDecision={(action) => {
            decision.reset();
            setReason("");
            setQuoteDecision({ id: quote.id, action });
          }}
          onEdit={() => {
            setEditId(quote.id);
            setAmount((quote.amount_cents / 100).toFixed(2));
            setDescription(quote.description);
            setError(null);
          }}
          onDelete={() => {
            changeDraft.reset();
            setDeleteId(quote.id);
          }}
          onAskForPayment={() =>
            onAskForPayment?.({
              amountCents: quote.amount_cents,
              description: quote.description,
            })
          }
        />
      ))}

      {quoteDecision && decisionCopy && (
        <ConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open && !decision.isPending) setQuoteDecision(null);
          }}
          title={t(decisionCopy.title)}
          description={t(decisionCopy.description)}
          confirmLabel={t(decisionCopy.label)}
          pending={decision.isPending}
          confirmDisabled={quoteDecision.action === "decline" && !reason.trim()}
          onConfirm={() => decision.mutate({
            ...quoteDecision,
            reason: quoteDecision.action === "decline" ? reason.trim() : undefined,
          }, { onSuccess: () => setQuoteDecision(null) })}
        >
          {quoteDecision.action === "decline" && (
            <label className="flex flex-col gap-1.5 text-sm">
              {t("quotes.declineReason")}
              <textarea
                className="min-h-20 rounded-app-ctrl border border-input bg-background px-3 py-2"
                value={reason}
                maxLength={500}
                disabled={decision.isPending}
                onChange={(event) => setReason(event.target.value)}
              />
            </label>
          )}
          {decision.isError && (
            <p role="alert" className="text-sm text-destructive">
              {t(quoteDecision.action === "withdraw" ? "quotes.withdrawFailed" : "quotes.decisionFailed")}
            </p>
          )}
        </ConfirmDialog>
      )}

      <ConfirmDialog
        open={deleteId !== null}
        onOpenChange={(open) => {
          if (!open && !changeDraft.isPending) setDeleteId(null);
        }}
        title={t("quotes.deleteDraft")}
        description={t("quotes.deleteDraftDetail")}
        confirmLabel={t("quotes.deleteDraft")}
        pending={changeDraft.isPending}
        onConfirm={() => {
          if (!deleteId) return;
          changeDraft.mutate({ id: deleteId }, {
            onSuccess: () => {
              if (editId === deleteId) closeForm();
              setDeleteId(null);
            },
          });
        }}
      >
        {changeDraft.isError && <p role="alert" className="text-sm text-destructive">{t("quotes.deleteDraftFailed")}</p>}
      </ConfirmDialog>

      {showForm && (
        <div className="mt-1 space-y-2 rounded-app-card border border-app-line p-3">
          <div className="flex gap-2">
            <input
              ref={focusAmount}
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
              disabled={create.isPending || changeDraft.isPending}
              className="tap-target rounded-app-ctrl bg-primary px-3 py-1.5 text-[13px] font-medium text-primary-foreground disabled:opacity-60"
            >
              {create.isPending || changeDraft.isPending ? t("quotes.saving") : t("quotes.saveDraft")}
            </button>
            <button
              type="button"
              onClick={() => {
                if (editId) {
                  closeForm();
                } else {
                  onCloseDraft();
                  setError(null);
                }
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
