"use client";

import { formatMoney } from "@loonext/shared";
import { PhoneIncoming } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SettingsCard } from "@/components/settings/section";
import { useT } from "@/i18n/provider";
import {
  type HeldNumber,
  type HeldNumbersView,
  useHeldNumbers,
  useReinstateHeldNumber,
} from "@/lib/api/billing";
import { ApiError } from "@/lib/api/error";
import { PLAN_PRICING } from "@/lib/api/types";
import { formatPhone } from "@/lib/format/phone";

/**
 * #523 — the numbers this workspace holds that its plan does not cover.
 *
 * # The state this exists to explain
 *
 * Coming back is never refused. A Pro workspace that cancels, waits out part of
 * the grace window, and presses the win-back's "Come back on Starter" is taken
 * at its word and resubscribed — and then holds two numbers on a plan that
 * covers one. #523 settles what happens next: the plan they bought is
 * respected, the surplus stays SUSPENDED rather than released, and the owner is
 * told. This card is the "told" half on web.
 *
 * A held number is a genuinely strange thing and the copy has to carry it: it
 * still receives texts and calls, its history is untouched, nothing was given
 * up — and the workspace cannot send or answer from it. That is only defensible
 * if the owner can see it and end it, which is why the two routes back are the
 * point of the card rather than a footnote on it.
 *
 * # What it refuses to do
 *
 * IT NEVER RENDERS DURING THE GRACE WINDOW. A cancelled workspace's numbers are
 * suspended for a completely different reason, and the answer there is the
 * win-back card three rows up — not "buy your number back" aimed at somebody
 * who has just stopped paying. The server distinguishes the two as `reason`
 * rather than leaving each client to infer it, and this card renders for
 * exactly one of them. *Applying: Zen of Clarity.*
 *
 * IT QUOTES NO HAND-TYPED PRICE. `extra_number_cents` and
 * `extra_number_currency` both come from the route, so a workspace billed in
 * CAD reads a CAD figure. The one constant read locally is Pro's included
 * number count, from the same `PLAN_PRICING` mirror the change-plan dialog
 * quotes — never a literal at a call site (#522 was exactly this bug).
 *
 * IT SHOWS NO BUTTON IT EXPECTS TO FAIL. `can_reinstate` is the server's
 * answer to "would the purchase be accepted right now", covering a paused
 * workspace, an unprovisioned catalog and Starter already at its hard cap. When
 * it is false the control is ABSENT and the remaining route is named instead —
 * a button whose only outcome is a 409 is how somebody concludes the product is
 * broken.
 *
 * IT DOES NOT DRAMATISE. Same discipline as `missed-while-off` beside it: the
 * reader is a customer who has just chosen to come back, and the facts do the
 * work. No warning tint, no "lost", no count-up of what the hold is costing
 * them. *Applying: Loss Aversion, in the one direction that is fair here —
 * name what is held and that it is NOT gone, never imply it is slipping away.*
 */

/** The ways out of a hold, decided by the server's two flags. */
export interface HoldRoutes {
  /** Buy capacity for one held number, at the price the route quoted. */
  canBuy: boolean;
  /** Move to Pro, whose bigger allowance reinstates what fits. */
  canUpgrade: boolean;
}

/**
 * Which routes back to offer.
 *
 * A pure function because the interesting case is the one nobody pictures:
 * BOTH false. A Starter already holding its hard maximum cannot buy another
 * extra, and a workspace whose extra-number price is unprovisioned cannot buy
 * one at all — and if the card silently rendered no actions there, the owner
 * would be looking at a dead number with no stated way to revive it. That state
 * gets a sentence, so it is worth being able to detect it in a test rather than
 * only by reading JSX.
 */
export function holdRoutes(view: HeldNumbersView): HoldRoutes {
  return { canBuy: view.can_reinstate, canUpgrade: view.can_upgrade };
}

/**
 * Should this card render at all?
 *
 * Three conditions, and the middle one is the load-bearing one — see the
 * "never during the grace window" note above.
 */
export function showsHold(view: HeldNumbersView | undefined): boolean {
  if (!view) return false;
  return view.reason === "over_plan_allowance" && view.held.length > 0;
}

/** "on 4 August" — the day it went on hold, when we know it. */
function heldSince(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
  });
}

function ReinstateDialog({
  number,
  priceLabel,
  idempotencyKey,
  onDone,
  open,
  onOpenChange,
}: {
  number: HeldNumber;
  priceLabel: string;
  idempotencyKey: () => string;
  onDone: () => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const reinstate = useReinstateHeldNumber();
  const [error, setError] = useState<string | null>(null);
  const display = number.number_e164
    ? formatPhone(number.number_e164)
    : t("settings.heldThisNumber");

  function close(next: boolean) {
    if (!next) setError(null);
    onOpenChange(next);
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t("settings.heldConfirmTitle", { number: display })}
          </DialogTitle>
          {/* The amount and WHEN it is charged, both stated before anything is
              pressed. The server prorates with `always_invoice`, so this lands
              on the card today rather than surfacing on a later invoice — and a
              charge somebody did not read first is the shape of dishonesty this
              whole issue exists to prevent. *Applying: Ethical Friction.* */}
          <DialogDescription>
            {t("settings.heldConfirmBody", {
              price: priceLabel,
              number: display,
            })}
          </DialogDescription>
        </DialogHeader>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)}>
            {t("settings.neverMind")}
          </Button>
          <Button
            disabled={reinstate.isPending}
            onClick={() => {
              setError(null);
              reinstate.mutate(
                { numberId: number.id, idempotencyKey: idempotencyKey() },
                {
                  onSuccess: (result) => {
                    close(false);
                    onDone();
                    toast.success(
                      // `already_active` is a double-press or an upgrade that
                      // reinstated it while this dialog sat open. Not an error,
                      // and emphatically not a second charge — so it gets the
                      // same happy ending, worded so nobody goes looking for a
                      // charge that never happened.
                      result.already_active
                        ? t("settings.heldAlreadyBack", { number: display })
                        : t("settings.heldIsBack", { number: display }),
                    );
                  },
                  onError: (cause) =>
                    setError(
                      cause instanceof ApiError
                        ? cause.message
                        : t("settings.heldReinstateFailed"),
                    ),
                },
              );
            }}
          >
            {reinstate.isPending
              ? t("settings.heldBringingBack")
              : t("settings.heldAddFor", { price: priceLabel })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function HeldNumberRow({
  number,
  routes,
  priceLabel,
  idempotencyKey,
  onDone,
}: {
  number: HeldNumber;
  routes: HoldRoutes;
  priceLabel: string | null;
  idempotencyKey: () => string;
  onDone: () => void;
}) {
  const t = useT();
  const [confirming, setConfirming] = useState(false);
  const since = heldSince(number.suspended_at);

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg border bg-background px-4 py-3">
      <div className="space-y-0.5">
        <p className="text-base font-medium tabular-nums">
          {number.number_e164
            ? formatPhone(number.number_e164)
            : t("settings.heldYourNumber")}
        </p>
        {since && (
          <p className="text-xs text-muted-foreground">
            {t("settings.heldSince", { since })}
          </p>
        )}
      </div>
      {routes.canBuy && priceLabel && (
        <>
          <Button size="sm" onClick={() => setConfirming(true)}>
            {t("settings.heldBringBack", { price: priceLabel })}
          </Button>
          <ReinstateDialog
            number={number}
            priceLabel={priceLabel}
            idempotencyKey={idempotencyKey}
            onDone={onDone}
            open={confirming}
            onOpenChange={setConfirming}
          />
        </>
      )}
    </div>
  );
}

export function HeldNumbersCard({ show }: { show: boolean }) {
  const t = useT();
  const held = useHeldNumbers(show);
  /**
   * One idempotency key per NUMBER, minted on first press and kept until that
   * number is back.
   *
   * The dangerous case is a response that is merely LOST — flaky signal, a
   * closed tab, a Worker cold start. The charge may well have landed, so a
   * retry carrying a fresh key would buy a SECOND unit of extra-number capacity
   * for a number that only ever needed one, and the customer would pay twice
   * for one line. Reusing the key resolves the retry to the same Stripe
   * operation. Held in a ref rather than the dialog's own state precisely so
   * closing and reopening the dialog — the most natural way to retry — does not
   * mint a new one. Same rule as the composer's `idempotencyKeyFor`.
   */
  const keys = useRef(new Map<string, string>());
  function keyFor(numberId: string): string {
    const existing = keys.current.get(numberId);
    if (existing) return existing;
    const minted = crypto.randomUUID();
    keys.current.set(numberId, minted);
    return minted;
  }

  // Never a skeleton and never an error box: this is one card among several on
  // somebody else's screen, and a billing page rendering a broken box looks
  // like the billing itself is broken. `missed-while-off` beside it makes the
  // same call for the same reason.
  if (!show || !showsHold(held.data)) return null;
  const view = held.data as HeldNumbersView;

  const routes = holdRoutes(view);
  const priceLabel =
    view.extra_number_cents === null
      ? null
      : formatMoney(view.extra_number_cents, view.extra_number_currency);
  const planName = view.plan === "pro" ? "Pro" : "Starter";
  const allowance = view.allowance;
  const many = view.held.length > 1;

  return (
    <SettingsCard
      title={
        many
          ? t("settings.heldNumbersTitleMany")
          : t("settings.heldNumbersTitleOne")
      }
    >
      <div className="space-y-4">
        <div className="flex items-start gap-3">
          {/* The icon carries the reassurance the sentence below spends words
              on: this line still takes what comes IN. Deliberately not the
              PauseCircle the plan-pause card uses — a reader who has seen both
              must not read a held number as a paused plan. */}
          <PhoneIncoming
            className="mt-0.5 size-4 shrink-0 text-muted-foreground"
            strokeWidth={1.75}
            aria-hidden
          />
          <div className="space-y-1.5">
            <p className="text-sm">
              {allowance === null
                ? t(
                    many
                      ? "settings.heldCoversFewerMany"
                      : "settings.heldCoversFewerOne",
                    { plan: planName },
                  )
                : t(
                    many
                      ? "settings.heldCoversCountMany"
                      : "settings.heldCoversCountOne",
                    {
                      plan: planName,
                      count: allowance,
                      noun:
                        allowance === 1
                          ? t("settings.heldNumberNoun")
                          : t("settings.heldNumbersNoun"),
                    },
                  )}
            </p>
            {/* The three facts that make a hold different from a release, in
                the order somebody worries about them. "Not given up" first,
                because that is the fear. */}
            <p className="text-sm text-muted-foreground">
              {t(
                many
                  ? "settings.heldReassuranceMany"
                  : "settings.heldReassuranceOne",
              )}
            </p>
          </div>
        </div>

        <div className="space-y-2">
          {view.held.map((number) => (
            <HeldNumberRow
              key={number.id}
              number={number}
              routes={routes}
              priceLabel={priceLabel}
              idempotencyKey={() => keyFor(number.id)}
              onDone={() => keys.current.delete(number.id)}
            />
          ))}
        </div>

        {/* The routes back, and there are only ever two — a plan that covers
            more, or capacity bought for this one. *Applying: Chunking.* The
            upgrade is stated rather than given its own button: the plan card
            directly above already owns "Upgrade to Pro", and a second control
            opening the same dialog is two doors onto one room. */}
        {routes.canUpgrade && (
          <p className="text-sm text-muted-foreground">
            {t(
              many ? "settings.heldUpgradeMany" : "settings.heldUpgradeOne",
              { count: PLAN_PRICING.pro.numbers },
            )}
          </p>
        )}
        {!routes.canBuy && !routes.canUpgrade && (
          // Both routes closed. Rare — a paused plan, an unprovisioned catalog,
          // or a Starter already at its hard cap on a build where upgrading is
          // unavailable — but a dead number with no stated way back is the one
          // outcome this card must never produce.
          <p className="text-sm text-muted-foreground">
            {t(
              many ? "settings.heldNoRouteMany" : "settings.heldNoRouteOne",
            )}
          </p>
        )}
        {routes.canBuy && view.max_total !== null && (
          // Starter's hard ceiling (#80), from the server rather than assumed.
          // Said here so the owner of three held numbers on Starter learns the
          // cap BEFORE buying one back and discovering the second is refused.
          <p className="text-xs text-muted-foreground">
            {t("settings.heldMaxTotal", {
              plan: planName,
              count: view.max_total,
            })}
          </p>
        )}
      </div>
    </SettingsCard>
  );
}
