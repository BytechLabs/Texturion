"use client";

import { ArrowUpRight, ChevronRight } from "lucide-react";
import { toast } from "sonner";

import { payoutRequirementCopy } from "@loonext/shared";

import { LoadError, SettingsCard } from "@/components/settings/section";
import { useT, type Translate } from "@/i18n/provider";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/api/error";
import {
  usePayoutAccount,
  useStartPayoutOnboarding,
  useStripeDashboardLink,
} from "@/lib/api/payments";

/**
 * #224 — "Getting paid", the owner's side of text-to-pay.
 *
 * ## Evaluation
 *
 * This screen has exactly one job: say where the business stands, and offer the
 * one thing that moves them forward. There are five states and each has a
 * different next action, so the temptation is a status grid. A grid would be
 * wrong — the reader is a plumber who wants to know whether they can take a
 * card, not an operator auditing a Stripe account.
 *
 * ## The decisions
 *
 * - **One sentence, one button.** The server decides WHICH sentence, so web,
 *   Android and iOS say the same thing and none of them can drift into
 *   paraphrase. Since #228 it names the sentence rather than writing it out —
 *   the choice is still the server's, the language is the reader's. *Applying:
 *   Chunking — three or four items is the ceiling, and a status page that lists
 *   nine booleans is nine.*
 *
 * - **No progress bar.** Onboarding progress belongs to Stripe, which owns the
 *   flow and is the only thing that knows how far through it somebody is. A bar
 *   we invented would either start at 0% — which the manual forbids, because it
 *   tells somebody who has already done work that they have done none — or
 *   would be a number we made up. The honest equivalent is what is OUTSTANDING,
 *   listed below. *Applying: the Goal Gradient Effect, honoured by naming the
 *   remaining steps rather than faking a fraction.*
 *
 * - **Outstanding requirements in plain words.** Stripe answers with
 *   `individual.verification.document`. A person reads "Photo ID for the
 *   business owner". *Applying: Outcomes Over Features.*
 *
 * - **Loss aversion is deliberately ABSENT.** There is no "you are losing
 *   payments" framing on this page. The business has not lost anything; they
 *   have not started. Manufacturing a loss to drive a bank-details form would
 *   be the one place in this product where that lever would be dishonest.
 *
 * - **The Stripe dashboard link is the refund path**, and it is the only place
 *   refunds are offered. See docs/TEXT-TO-PAY.md: we deliberately do not build
 *   a thin copy of a back office that already exists and stays compliant.
 */
export function PaymentsCard() {
  const t = useT();
  const account = usePayoutAccount();
  const onboarding = useStartPayoutOnboarding();
  const dashboard = useStripeDashboardLink();

  if (account.isLoading) {
    return (
      <SettingsCard title={t("payments.settingsTitle")}>
        {/* A skeleton, not a spinner: the shape of what is coming is itself
            information, and it stops the card jumping when it lands. */}
        <div className="space-y-2">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      </SettingsCard>
    );
  }

  if (account.isError || !account.data) {
    return <LoadError onRetry={() => void account.refetch()} />;
  }

  const state = account.data;

  async function startOnboarding() {
    try {
      const { url } = await onboarding.mutateAsync();
      // A full navigation, not a new tab. Stripe's flow ends by sending them
      // back to this page, and a tab that closes onto a stale page is how
      // somebody concludes nothing happened.
      window.location.href = url;
    } catch (cause) {
      toast.error(
        cause instanceof ApiError
          ? cause.message
          : t("payments.stripeOpenFailed"),
      );
    }
  }

  async function openDashboard() {
    try {
      const { url } = await dashboard.mutateAsync();
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (cause) {
      toast.error(
        cause instanceof ApiError
          ? cause.message
          : t("payments.stripeOpenFailed"),
      );
    }
  }

  const needsOnboarding =
    state.readiness === "not_connected" ||
    state.readiness === "onboarding_incomplete";
  const busy = onboarding.isPending || dashboard.isPending;

  return (
    <SettingsCard
      title={t("payments.settingsTitle")}
      description={readinessWords(state.title_key, state.title, t)}
    >
      <p className="text-sm text-muted-foreground">
        {readinessWords(state.detail_key, state.detail, t)}
      </p>

      {state.requirements_due.length > 0 && (
        <div className="mt-4 rounded-app-ctrl border border-app-amber-line bg-app-amber-bg/60 px-3 py-2.5">
          <p className="text-[13px] font-medium text-app-amber-ink">
            {t("payments.stripeNeeds")}
          </p>
          <ul className="mt-1 space-y-0.5">
            {state.requirements_due.map((requirement) => (
              <li
                key={requirement}
                className="text-[13px] text-app-amber-ink/90"
              >
                {requirementWords(requirement, t)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {state.action && (
        <div className="mt-4">
          <Button
            type="button"
            disabled={busy}
            onClick={() =>
              void (needsOnboarding ? startOnboarding() : openDashboard())
            }
            className="gap-1"
          >
            {readinessWords(state.action_key, state.action, t)}
            {/* A right chevron on a forward action, an out-arrow on one that
                leaves the product. The difference tells somebody whether they
                are about to leave before they tap. */}
            {needsOnboarding ? (
              <ChevronRight className="size-4" strokeWidth={1.75} aria-hidden />
            ) : (
              <ArrowUpRight className="size-4" strokeWidth={1.75} aria-hidden />
            )}
          </Button>
        </div>
      )}

      {state.readiness === "ready" && (
        <dl className="mt-5 grid gap-x-6 gap-y-2 border-t border-border-subtle pt-4 text-sm sm:grid-cols-2">
          <Fact
            label={t("payments.payouts")}
            value={
              state.payouts_enabled
                ? t("payments.payoutsOn")
                : t("payments.payoutsOff")
            }
          />
          <Fact
            label={t("payments.chargedIn")}
            value={(state.currency ?? "usd").toUpperCase()}
          />
        </dl>
      )}

      {state.readiness === "ready" && (
        <p className="mt-4 text-[13px] text-muted-foreground">
          {t("payments.refundNote")}
        </p>
      )}
    </SettingsCard>
  );
}

/**
 * A Stripe requirement in the reader's language, or in Stripe's.
 *
 * #228: the shared module answers with a catalogue key for the twelve
 * requirements we have words for, and with Stripe's own identifier tidied up
 * for anything else. Exactly one of the two is set.
 *
 * The untranslated branch is deliberate rather than unfinished. Stripe adds
 * requirement keys without telling anybody, and an outstanding requirement
 * nobody can see is where an owner concludes the product is broken — so an
 * English-shaped phrase beats a silent list. Inventing French for a
 * requirement we do not recognise would be inventing the requirement.
 */
function requirementWords(requirement: string, t: Translate): string {
  const copy = payoutRequirementCopy(requirement);
  return copy.key ? t(copy.key) : (copy.literal ?? requirement);
}

/**
 * The readiness sentence in the reader's language.
 *
 * #228: the server sends both a key and its English. Prefer the key — that is
 * the whole point of it — and fall back to the sentence, which is what a client
 * talking to a Worker that predates the keys will get. The fallback is not
 * defensive padding: expand-and-contract means both shapes are on the wire at
 * once, on purpose, for as long as the old builds live.
 */
function readinessWords(
  key: string | null | undefined,
  sentence: string | null | undefined,
  t: Translate,
): string {
  if (key) return t(key as Parameters<Translate>[0]);
  return sentence ?? "";
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[12px] uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="text-sm text-foreground">{value}</dd>
    </div>
  );
}
