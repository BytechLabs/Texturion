"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Check, Circle, Copy, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { REGISTRATION_COPY } from "@/components/registration/copy";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api/error";
import { keys } from "@/lib/api/keys";
import {
  useOnboardingResendOtp,
  useOnboardingVerifyOtp,
} from "@/lib/api/onboarding";
import { formatPhone } from "@/lib/format/phone";
import { cn } from "@/lib/utils";

import { StepError, StepLoading } from "../step-shell";
import { hasPaid, owesUsRegistration } from "../steps";
import { useOnboardingState } from "../use-onboarding-state";
import { useProvisioningEvents } from "./use-provisioning-events";

/**
 * /onboarding/setting-up — the realtime checklist (G7 step 6, SPEC §4.1
 * step 6): three rows animating pending→done off `number.updated` /
 * `registration.updated` Broadcast events. The number reveals in 36px
 * tabular type with a copy button; the US registration row stays honestly
 * pending with the SPEC §4.4 sentence; the sole-prop OTP input appears here
 * while the code is outstanding; CA-only goes straight to done.
 */

type RowStatus = "done" | "working" | "waiting";

function RowIcon({ status }: { status: RowStatus }) {
  if (status === "done") {
    return (
      <span className="flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground animate-in fade-in duration-200">
        <Check className="size-4" strokeWidth={2} aria-hidden />
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
  return (
    <span className="flex size-6 items-center justify-center text-muted-foreground/50">
      <Circle className="size-5" strokeWidth={1.75} aria-hidden />
    </span>
  );
}

function ChecklistRow({
  status,
  title,
  children,
}: {
  status: RowStatus;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <li className="flex gap-4 py-5 first:pt-0 last:pb-0">
      <RowIcon status={status} />
      <div className="min-w-0 flex-1 space-y-1.5">
        <p
          className={cn(
            "text-sm font-medium transition-colors duration-200 ease-out",
            status === "waiting" && "text-muted-foreground",
          )}
        >
          {title}
          <span className="sr-only">
            {status === "done" ? " — done" : " — in progress"}
          </span>
        </p>
        {children}
      </div>
    </li>
  );
}

function NumberReveal({ e164 }: { e164: string }) {
  const [copied, setCopied] = useState(false);
  const formatted = formatPhone(e164);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <div className="flex flex-wrap items-center gap-3 animate-in fade-in duration-200">
      {/* 36px tabular reveal (G7). */}
      <span className="text-4xl font-semibold tabular-nums tracking-tight">
        {formatted}
      </span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(formatted);
            setCopied(true);
          } catch {
            // Clipboard blocked — the number is on screen to copy by hand.
          }
        }}
      >
        {copied ? (
          <>
            <Check className="size-4" aria-hidden /> Copied
          </>
        ) : (
          <>
            <Copy className="size-4" aria-hidden /> Copy
          </>
        )}
      </Button>
    </div>
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
      setNotice("We sent a new code — it's good for 24 hours.");
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

function SettingUp() {
  const state = useOnboardingState();
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const checkoutSuccess = searchParams.get("checkout") === "success";

  useProvisioningEvents(state.companyId);

  const company = state.company;
  // Redirect guard: this screen is the post-payment surface only. A
  // just-returned checkout (webhook still processing) is allowed through and
  // shows the "confirming payment" row until the subscription flips.
  const paid = company ? hasPaid(company.subscription_status) : false;
  const confirming = company !== null && !paid && checkoutSuccess;
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

  // Quiet fallback for the two moments with no Broadcast signal: the
  // checkout webhook hasn't run yet (no company update event exists) and the
  // window before the phone_numbers row's first status UPDATE. Realtime
  // drives everything else.
  const needsNudge =
    state.status === "ready" &&
    company !== null &&
    (confirming || company.numbers.length === 0);
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
  if (state.status !== "ready" || !company || !companyId || redirectTo) {
    return <StepLoading />;
  }

  const activeNumber = company.numbers.find((n) => n.status === "active");
  const provisionFailed =
    !activeNumber && company.numbers.some((n) => n.status === "provision_failed");

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

  const numberStatus: RowStatus = activeNumber ? "done" : "working";
  const registrationStatus: RowStatus =
    !owes || campaignApproved ? "done" : confirming ? "waiting" : "working";
  const inboxStatus: RowStatus = activeNumber ? "done" : "waiting";

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">
          Setting up your number
        </h1>
        <p className="text-sm text-muted-foreground">
          This screen updates itself — no refreshing needed.
        </p>
      </div>

      <ul
        className="divide-y divide-border rounded-lg border border-border bg-card px-5 py-5"
        aria-live="polite"
      >
        <ChecklistRow status={numberStatus} title="Creating your number">
          {activeNumber?.number_e164 ? (
            <NumberReveal e164={activeNumber.number_e164} />
          ) : (
            <p className="text-sm text-muted-foreground">
              {confirming
                ? "Confirming your payment — a few seconds."
                : provisionFailed
                  ? REGISTRATION_COPY.numberDelayed
                  : REGISTRATION_COPY.numberProvisioning}
            </p>
          )}
        </ChecklistRow>

        <ChecklistRow
          status={registrationStatus}
          title="Registering your business with carriers"
        >
          {!owes ? (
            <p className="text-sm text-muted-foreground">
              Not needed — Canadian texting works right away.
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

        <ChecklistRow status={inboxStatus} title="Inbox ready">
          {activeNumber ? (
            <div className="space-y-3 animate-in fade-in duration-200">
              <p className="text-sm text-muted-foreground">
                Text your new number from your phone and watch it land.
              </p>
              <Button asChild size="lg">
                <Link href="/inbox">Open your inbox</Link>
              </Button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Your inbox unlocks as soon as your number is ready.
            </p>
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
