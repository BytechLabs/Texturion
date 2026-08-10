"use client";

import { BadgeCheck, HandCoins, TriangleAlert, X } from "lucide-react";

import {
  formatMoney,
  paymentRequestCancellable,
  paymentRequestLabel,
  roleHasCapability,
  type PaymentRequestState,
} from "@loonext/shared";

import {
  useCancelPaymentRequest,
  usePaymentRequests,
  type PaymentRequest,
} from "@/lib/api/payments";
import { useActiveCompany } from "@/lib/company/provider";
import { cn } from "@/lib/utils";

/**
 * #224 — what this thread is owed, and what it was paid.
 *
 * ## Why a strip beside the composer rather than a bubble in the transcript
 *
 * Same reasoning #233 settled for scheduled sends. A payment request is not a
 * message: the message that carried it is already in the transcript, in the
 * customer's own thread, exactly as they received it. What is NOT in the
 * transcript is the state — whether it was paid, refunded, or has expired —
 * and that state changes without anybody in the workspace doing anything. A
 * bubble would have to mutate after the fact, which is the one thing a
 * transcript must never do.
 *
 * ## What it shows, and what it hides
 *
 * Only requests that are still LIVE or were settled recently. A thread with two
 * years of paid deposits would otherwise grow a permanent wall of history above
 * the composer, and history is what the timeline is for. *Applying: Zen of
 * Clarity — the strip is absent entirely on almost every thread.*
 *
 * Cancel is an X on the row, not a menu: it is reversible in the only sense
 * that counts (ask again), and it is only offered while the request is
 * genuinely cancellable. *Applying: Ethical Friction, calibrated — friction
 * belongs on the ask, which is customer-visible, not on calling it off.*
 */
export function PaymentStrip({ conversationId }: { conversationId: string }) {
  const { role } = useActiveCompany();
  // #315: an observer SEES the money — the strip is a read, and read_only holds
  // `conversations.read` precisely so it can follow the work. What it does not
  // get is the cancel, which acts as the business.
  const canAct = roleHasCapability(role, "conversations.send");
  const requests = usePaymentRequests(conversationId);
  const cancel = useCancelPaymentRequest(conversationId);

  const rows = (requests.data?.payment_requests ?? []).filter(isWorthShowing);
  // No skeleton and no empty state: reserving space on every thread for
  // something almost every thread does not have is a permanent cost.
  if (rows.length === 0) return null;

  return (
    <ul className="mx-auto flex max-w-[42rem] flex-col gap-1 px-1 pb-1.5">
      {rows.map((row) => (
        <PaymentRow
          key={row.id}
          row={row}
          canAct={canAct}
          onCancel={() => cancel.mutate(row.id)}
          cancelling={cancel.isPending && cancel.variables === row.id}
        />
      ))}
    </ul>
  );
}

/**
 * Live, or settled within the last week.
 *
 * The week is the window in which somebody is still talking about that money.
 * After it, the request is history and the timeline holds it.
 */
export function isWorthShowing(
  row: Pick<PaymentRequest, "state" | "created_at" | "paid_at">,
  now: number = Date.now(),
): boolean {
  if (row.state === "requested") return true;
  const settled = row.paid_at ?? row.created_at;
  const age = now - new Date(settled).getTime();
  return age < 7 * 24 * 60 * 60 * 1000;
}

function PaymentRow({
  row,
  canAct,
  onCancel,
  cancelling,
}: {
  row: PaymentRequest;
  canAct: boolean;
  onCancel: () => void;
  cancelling: boolean;
}) {
  const tone = toneFor(row.state);
  const amount = formatMoney(row.amount_cents, row.currency);
  return (
    <li
      className={cn(
        "flex items-start gap-2 rounded-app-ctrl border px-2.5 py-1.5 text-xs",
        tone === "attention"
          ? "border-app-amber/40 bg-app-amber/10 text-foreground"
          : tone === "settled"
            ? "border-app-tint-line bg-app-tint/50 text-foreground"
            : "border-border bg-secondary/40 text-muted-foreground",
      )}
    >
      <RowIcon state={row.state} />
      <div className="min-w-0 flex-1">
        <p className="truncate">
          <span className="font-medium text-foreground">
            {paymentRequestLabel(row.state)} · {amount}
          </span>
          {" — "}
          {row.description}
        </p>
        {row.state === "refunded" && row.amount_refunded_cents !== null && (
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {formatMoney(row.amount_refunded_cents, row.currency)} went back to
            them.
          </p>
        )}
        {row.state === "disputed" && (
          <p className="mt-0.5 text-app-amber">
            Their bank has pulled this back. Stripe has emailed you what it needs.
          </p>
        )}
      </div>
      {canAct && paymentRequestCancellable(row) && (
        <button
          type="button"
          onClick={onCancel}
          disabled={cancelling}
          aria-label={`Cancel the ${amount} request for ${row.description}`}
          className="tap-target -mr-1 flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors duration-150 ease-out hover:bg-secondary hover:text-foreground disabled:opacity-45"
        >
          <X className="size-3.5" strokeWidth={1.75} />
        </button>
      )}
    </li>
  );
}

/** Three tones, because there are three things a reader has to do about a row. */
export function toneFor(
  state: PaymentRequestState,
): "attention" | "settled" | "quiet" {
  if (state === "disputed" || state === "refunded") return "attention";
  if (state === "paid") return "settled";
  return "quiet";
}

function RowIcon({ state }: { state: PaymentRequestState }) {
  if (state === "paid") {
    return (
      <BadgeCheck
        className="mt-0.5 size-3.5 shrink-0 text-app-olive-deep"
        strokeWidth={1.75}
        aria-hidden
      />
    );
  }
  if (state === "disputed" || state === "refunded") {
    return (
      <TriangleAlert
        className="mt-0.5 size-3.5 shrink-0 text-app-amber"
        strokeWidth={1.75}
        aria-hidden
      />
    );
  }
  return (
    <HandCoins className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
  );
}
