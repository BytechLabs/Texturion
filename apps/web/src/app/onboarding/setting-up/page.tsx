"use client";

import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Circle, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";

import { PORT_STATE_COPY } from "@/components/porting/copy";
import { REGISTRATION_COPY } from "@/components/registration/copy";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumberReveal } from "@/components/ui/number-reveal";
import { trackCheckoutCompleted } from "@/lib/analytics/events";
import { ApiError } from "@/lib/api/error";
import { keys } from "@/lib/api/keys";
import {
  useConfirmCheckout,
  useOnboardingResendOtp,
  useOnboardingVerifyOtp,
} from "@/lib/api/onboarding";
import { usePortRequestsForCompany } from "@/lib/api/porting";
import { formatPhone } from "@/lib/format/phone";
import { cn } from "@/lib/utils";

import { StepError, StepLoading } from "../step-shell";
import { hasPaid, owesUsRegistration } from "../steps";
import { useOnboardingState } from "../use-onboarding-state";
import {
  PORT_CHECKLIST_COPY,
  resolvePortChecklistItem,
  type PortChecklistItem,
} from "./port-item";
import { useProvisioningEvents } from "./use-provisioning-events";

/**
 * /onboarding/setting-up — the realtime checklist (G7 step 6, SPEC §4.1
 * step 6): three rows animating pending→done off `number.updated` /
 * `registration.updated` Broadcast events. The number reveals in 36px
 * tabular type with a copy button; the US registration row stays honestly
 * pending with the SPEC §4.4 sentence; the sole-prop OTP input appears here
 * while the code is outstanding; CA-only goes straight to done.
 *
 * A port-in signup (PORTING.md §8.1) swaps the "Creating your number" row for
 * an honest transfer item: the Telnyx order rests at `draft` until the LOA +
 * a recent bill are uploaded and submitted (§3.5/§4 P5), so the required
 * document step is surfaced LOUDLY here — nothing advances by itself until
 * the owner acts. Once submitted, the row carries the honest multi-week
 * window and a link to the Settings → Numbers tracker.
 */

type RowStatus = "done" | "working" | "waiting" | "action" | "stalled";

function RowIcon({ status, order = 0 }: { status: RowStatus; order?: number }) {
  if (status === "done") {
    return (
      <span
        // §3.4 signature moment: the gentle green check cascade, via the
        // tokens-track `app-motion-check-cascade` class + `--cascade-delay` so
        // rows settle in order. A done step is a genuine positive, so it turns
        // the encouraging success green (§2.1), not petrol. The globals.css
        // reduced-motion base rule zeroes the animation for free.
        className="app-motion-check-cascade flex size-6 items-center justify-center rounded-full bg-success text-white"
        style={{ "--cascade-delay": `${order * 140}ms` } as React.CSSProperties}
      >
        <Check className="size-4" strokeWidth={2.25} aria-hidden />
      </span>
    );
  }
  if (status === "working") {
    return (
      <span className="flex size-6 items-center justify-center text-primary">
        <Loader2 className="size-5 animate-spin" strokeWidth={1.75} aria-hidden />
      </span>
    );
  }
  if (status === "action" || status === "stalled") {
    // "action" needs the user; "stalled" means provisioning is taking longer
    // than usual (automatic retries are still running / the number just hasn't
    // landed). Either way a spinner would promise progress that isn't visibly
    // happening — the calm amber alert is honest. Matches the port card's
    // exception treatment.
    return (
      <span className="flex size-6 items-center justify-center rounded-full bg-warning/15 text-amber-800 dark:text-warning">
        <AlertTriangle className="size-4" strokeWidth={2} aria-hidden />
      </span>
    );
  }
  return (
    <span className="flex size-6 items-center justify-center text-tertiary">
      <Circle className="size-5" strokeWidth={1.75} aria-hidden />
    </span>
  );
}

function ChecklistRow({
  status,
  title,
  order = 0,
  children,
}: {
  status: RowStatus;
  title: string;
  /** Position in the list — drives the check-cascade stagger (§3.4). */
  order?: number;
  children?: React.ReactNode;
}) {
  return (
    <li className="flex gap-4 py-5 first:pt-0 last:pb-0">
      <RowIcon status={status} order={order} />
      <div className="min-w-0 flex-1 space-y-1.5">
        <p
          className={cn(
            "text-sm font-medium transition-colors duration-200 ease-out",
            status === "waiting" && "text-muted-foreground",
          )}
        >
          {title}
          <span className="sr-only">
            {status === "done"
              ? ", done"
              : status === "action"
                ? ", needs your attention"
                : ", in progress"}
          </span>
        </p>
        {children}
      </div>
    </li>
  );
}

/** Sole-prop OTP row (§4.2): 6-digit input + resend with a 60s cooldown. */
function OtpRow({
  companyId,
  phoneLabel,
  canEnter,
}: {
  companyId: string;
  phoneLabel: string;
  canEnter: boolean;
}) {
  const verify = useOnboardingVerifyOtp();
  const resend = useOnboardingResendOtp();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  async function onVerify() {
    setError(null);
    setNotice(null);
    if (!/^\d{6}$/.test(code)) {
      setError("Enter the 6-digit code from the text.");
      return;
    }
    try {
      await verify.mutateAsync({ companyId, code });
      // Success flips the brand row — the checklist re-renders from state.
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : "Something went wrong on our end. Try again in a moment.",
      );
    }
  }

  async function onResend() {
    setError(null);
    setNotice(null);
    try {
      await resend.mutateAsync({ companyId });
      setCooldown(60);
      setNotice("We sent a new code. It's good for 24 hours.");
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : "Something went wrong on our end. Try again in a moment.",
      );
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">
        {REGISTRATION_COPY.otpPending(phoneLabel)}
      </p>
      {canEnter ? (
        <>
          <div className="flex items-center gap-2">
            <Input
              value={code}
              onChange={(e) =>
                setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
              }
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              aria-label="Verification code"
              className="w-32 tabular-nums"
            />
            <Button
              type="button"
              size="sm"
              onClick={onVerify}
              disabled={verify.isPending}
            >
              {verify.isPending ? "Checking…" : "Verify"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onResend}
              disabled={cooldown > 0 || resend.isPending}
            >
              {cooldown > 0 ? `Resend code (${cooldown}s)` : "Resend code"}
            </Button>
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          {notice ? (
            <p role="status" className="text-sm text-muted-foreground">
              {notice}
            </p>
          ) : null}
        </>
      ) : (
        <p className="text-[13px] text-muted-foreground">
          Your account owner or an admin enters the code here.
        </p>
      )}
    </div>
  );
}

/** Human date for the confirmed switch-over (mirrors the Settings port card). */
function switchDate(iso: string | null): string {
  if (!iso) return "your switch-over date";
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

/**
 * The port item body (PORTING.md §8.1/§9). The user-gated phases get a loud
 * petrol CTA into Settings → Numbers (where the documents form and submit
 * live); the carrier-side phases reuse the §9 banner copy plus a quiet
 * tracking link. Members see who acts instead of a button they can't use.
 */
function PortRow({
  item,
  canAct,
}: {
  item: PortChecklistItem;
  canAct: boolean;
}) {
  const { port, phase } = item;

  if (phase === "needs_documents" || phase === "needs_submit") {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {canAct
            ? phase === "needs_documents"
              ? PORT_CHECKLIST_COPY.needsDocuments
              : PORT_CHECKLIST_COPY.needsSubmit
            : PORT_CHECKLIST_COPY.memberDocuments}
        </p>
        {canAct ? (
          <Button asChild>
            <Link href="/settings/numbers">
              {phase === "needs_documents"
                ? PORT_CHECKLIST_COPY.needsDocumentsCta
                : PORT_CHECKLIST_COPY.needsSubmitCta}
            </Link>
          </Button>
        ) : null}
      </div>
    );
  }

  if (phase === "needs_fix") {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {PORT_STATE_COPY.voiceException(port.rejection_reason)}
        </p>
        {canAct ? (
          <Button asChild variant="outline" size="sm">
            <Link href="/settings/numbers">Fix and resubmit</Link>
          </Button>
        ) : (
          <p className="text-[13px] text-muted-foreground">
            Ask an owner or admin to fix the flagged details and resubmit.
          </p>
        )}
      </div>
    );
  }

  // Carrier-side phases — honest §9 copy, nothing for the user to do here.
  const body =
    phase === "date_confirmed"
      ? PORT_STATE_COPY.focConfirmed(switchDate(port.foc_date))
      : phase === "texting_activating"
        ? PORT_STATE_COPY.numberSwitched
        : phase === "texting_delayed"
          ? PORT_STATE_COPY.messagingException
          : `${PORT_STATE_COPY.submitted} ${PORT_CHECKLIST_COPY.inReviewWindow}`;
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">{body}</p>
      <Link
        href="/settings/numbers"
        className="inline-block text-[13px] font-medium text-primary underline-offset-4 hover:underline"
      >
        {PORT_CHECKLIST_COPY.trackLink}
      </Link>
    </div>
  );
}

function SettingUp() {
  const state = useOnboardingState();
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const checkoutSuccess = searchParams.get("checkout") === "success";
  const sessionId = searchParams.get("session_id");
  const confirmCheckout = useConfirmCheckout();
  const confirmInFlight = useRef(false);

  useProvisioningEvents(state.companyId);
  // A port-in signup replaces the provisioning row (PORTING.md §8.1) — the
  // list rides the same cache the Settings tracker uses, refreshed by the
  // `port.updated` broadcast wired in useProvisioningEvents.
  const ports = usePortRequestsForCompany(state.companyId);

  const company = state.company;
  // Redirect guard: this screen is the post-payment surface only. A
  // just-returned checkout (webhook still processing) is allowed through and
  // shows the "confirming payment" row until the subscription flips.
  const paid = company ? hasPaid(company.subscription_status) : false;
  const confirming = company !== null && !paid && checkoutSuccess;

  // Funnel: the checkout return confirmed as paid (client view; the Stripe
  // webhook's server-side event stays authoritative). The helper's
  // once-per-tab guard absorbs this screen's constant poll-driven re-renders.
  useEffect(() => {
    if (checkoutSuccess && paid) trackCheckoutCompleted();
  }, [checkoutSuccess, paid]);
  const redirectTo =
    state.status !== "ready"
      ? null
      : company === null
        ? "/onboarding"
        : !paid && !checkoutSuccess
          ? "/onboarding/plan"
          : null;
  useEffect(() => {
    if (redirectTo) router.replace(redirectTo);
  }, [redirectTo, router]);

  // Resilience nudge: on the return from Checkout, actively confirm the session
  // so the subscription flips active WITHOUT waiting on the webhook (delayed in
  // prod, never forwarded in local dev). Retries on a 4s cadence until paid;
  // the endpoint is idempotent and owner/admin-only, and a ref keeps at most
  // one request in flight. Once `confirming` clears (paid), the interval tears
  // down. This is what stops the setting-up screen sitting forever on
  // "Confirming your payment" and /for-you bouncing back to /onboarding/plan.
  const isOwnerAdmin = state.role === "owner" || state.role === "admin";
  const shouldConfirm =
    state.status === "ready" && confirming && sessionId !== null && isOwnerAdmin;
  const confirmMutateAsync = confirmCheckout.mutateAsync;
  useEffect(() => {
    const cid = state.companyId;
    if (!shouldConfirm || !cid || !sessionId) return;
    let cancelled = false;
    const run = async () => {
      if (confirmInFlight.current) return;
      confirmInFlight.current = true;
      try {
        await confirmMutateAsync({ companyId: cid, sessionId });
        if (!cancelled) {
          void queryClient.invalidateQueries({
            queryKey: keys.company(cid),
            refetchType: "active",
          });
        }
      } catch {
        // Best-effort — the 4s poll and (in prod) the webhook remain backstops.
      } finally {
        confirmInFlight.current = false;
      }
    };
    void run();
    const timer = setInterval(() => void run(), 4000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [shouldConfirm, state.companyId, sessionId, confirmMutateAsync, queryClient]);

  // Quiet fallback for the moments with no Broadcast signal: the checkout
  // webhook hasn't run yet (no company update event exists) and the window
  // before the phone_numbers row's first status UPDATE. Poll until an ACTIVE
  // number exists so a missed broadcast (or a local dev provisioning nudge)
  // still converges the checklist; realtime drives everything else.
  const needsNudge =
    state.status === "ready" &&
    company !== null &&
    (confirming || !company.numbers.some((n) => n.status === "active"));
  const companyId = state.companyId;
  useEffect(() => {
    if (!needsNudge || !companyId) return;
    const timer = setInterval(() => {
      void queryClient.invalidateQueries({
        queryKey: keys.company(companyId),
        refetchType: "active",
      });
      void queryClient.invalidateQueries({
        queryKey: keys.registration(companyId),
        refetchType: "active",
      });
    }, 4000);
    return () => clearInterval(timer);
  }, [needsNudge, companyId, queryClient]);

  if (state.status === "error") return <StepError onRetry={state.retry} />;
  if (
    state.status !== "ready" ||
    !company ||
    !companyId ||
    redirectTo ||
    // Wait for the port list too — rendering "Creating your number — under a
    // minute" and then swapping to the transfer item would flash a lie. On a
    // ports error we fall back to the plain row rather than blocking setup.
    ports.isPending
  ) {
    return <StepLoading />;
  }

  const activeNumber = company.numbers.find((n) => n.status === "active");
  const provisionFailed =
    !activeNumber && company.numbers.some((n) => n.status === "provision_failed");
  // Non-cancelled port + no active number → the honest transfer item replaces
  // the provisioning row. Everyone else keeps today's behavior.
  const portItem = resolvePortChecklistItem(
    company.numbers,
    ports.data?.data ?? [],
  );

  const owes = owesUsRegistration(company);
  const brand = state.registration?.brand ?? null;
  const campaign = state.registration?.campaign ?? null;
  const campaignApproved =
    campaign?.status === "approved" && campaign.deactivated_at === null;
  const registrationRejected =
    brand?.status === "rejected" || campaign?.status === "rejected";
  const rejectionReason =
    (campaign?.status === "rejected"
      ? campaign.rejection_reason
      : brand?.rejection_reason) ?? "the carrier flagged a detail";
  const otpPending =
    brand?.sole_proprietor === true &&
    (brand.status === "submitted" || brand.status === "pending");
  const otpPhone =
    typeof brand?.data?.mobilePhone === "string"
      ? formatPhone(brand.data.mobilePhone)
      : "your mobile";
  const canActOnRegistration = state.role === "owner" || state.role === "admin";

  const numberStatus: RowStatus = activeNumber
    ? "done"
    : provisionFailed
      ? "stalled"
      : portItem?.actionNeeded
        ? "action"
        : "working";
  const registrationStatus: RowStatus =
    !owes || campaignApproved ? "done" : confirming ? "waiting" : "working";
  const inboxStatus: RowStatus = activeNumber ? "done" : "waiting";

  // The §3.4 peak: once the number lands, the heading carries the app's ONE
  // exclamation mark (G10) and the number reveals below. Until then it stays a
  // calm, honest present-tense status line.
  const numberReady = Boolean(activeNumber?.number_e164);

  return (
    <div className="space-y-10">
      <div className="space-y-2">
        {/* §3.4: the hero line carries the app's ONE exclamation mark once the
            number lands (G10). */}
        <h1 className="app-hero-line">
          {numberReady ? "Your number is ready!" : "Setting up your number"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {numberReady
            ? "Everything below is live. Text your new number to see it land."
            : portItem?.actionNeeded
              ? // "Updates itself" would be a lie while the transfer waits on
                // the user — say so instead.
                "One step below needs you. The rest updates itself."
              : "This screen updates itself. No refreshing needed."}
        </p>
      </div>

      <ul
        className="divide-y divide-border-subtle rounded-lg border border-border bg-card px-6 py-5"
        aria-live="polite"
      >
        {portItem ? (
          // Port-in: the honest transfer item (PORTING.md §8.1) — never the
          // "under a minute" provisioning copy, which would flatly contradict
          // the multi-week transfer window.
          <ChecklistRow
            status={numberStatus}
            order={0}
            title={PORT_CHECKLIST_COPY.title}
          >
            <PortRow item={portItem} canAct={canActOnRegistration} />
          </ChecklistRow>
        ) : (
          <ChecklistRow
            status={numberStatus}
            order={0}
            title="Creating your number"
          >
            {activeNumber?.number_e164 ? (
              // §3.4 number reveal via the tokens-track primitive: the
              // emotional-number scale + fade-rise + copy button.
              <NumberReveal
                value={formatPhone(activeNumber.number_e164)}
                copyValue={formatPhone(activeNumber.number_e164)}
                copyable
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                {confirming
                  ? "Confirming your payment. A few seconds."
                  : provisionFailed
                    ? REGISTRATION_COPY.numberDelayed
                    : REGISTRATION_COPY.numberProvisioning}
              </p>
            )}
          </ChecklistRow>
        )}

        <ChecklistRow
          status={registrationStatus}
          order={1}
          title="Registering your business with carriers"
        >
          {!owes ? (
            <p className="text-sm text-muted-foreground">
              Not needed. Canadian texting works right away.
            </p>
          ) : campaignApproved ? (
            <p className="text-sm text-muted-foreground">
              {REGISTRATION_COPY.approved}
            </p>
          ) : registrationRejected ? (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                {REGISTRATION_COPY.rejected(rejectionReason)}
              </p>
              {canActOnRegistration ? (
                <Button asChild variant="outline" size="sm">
                  <Link href="/settings/numbers">Fix and resubmit</Link>
                </Button>
              ) : null}
            </div>
          ) : otpPending ? (
            <OtpRow
              companyId={companyId}
              phoneLabel={otpPhone}
              canEnter={canActOnRegistration}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              {REGISTRATION_COPY.registrationPending}
            </p>
          )}
        </ChecklistRow>

        <ChecklistRow status={inboxStatus} order={2} title="Inbox ready">
          {activeNumber ? (
            <div className="space-y-3 animate-in fade-in duration-300 ease-out">
              <p className="text-sm text-muted-foreground">
                Text your new number from your phone and watch it land.
              </p>
              <Button asChild size="lg">
                <Link href="/inbox">Open your inbox</Link>
              </Button>
            </div>
          ) : (
            // The inbox works before the number lands — never trap the user on
            // this screen. The app-wide status banner keeps the setup progress
            // visible on every page.
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                You can start using Loonext now. Your inbox fills in the moment
                your number is ready, and we&apos;ll keep you posted at the top
                of every screen.
              </p>
              <Button asChild variant="outline" size="sm">
                <Link href="/inbox">Open your inbox</Link>
              </Button>
            </div>
          )}
        </ChecklistRow>
      </ul>
    </div>
  );
}

export default function SettingUpPage() {
  // useSearchParams requires a Suspense boundary during prerender.
  return (
    <Suspense fallback={<StepLoading />}>
      <SettingUp />
    </Suspense>
  );
}
