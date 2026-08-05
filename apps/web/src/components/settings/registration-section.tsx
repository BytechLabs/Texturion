"use client";

import { billingCurrencyOf } from "@loonext/shared";
import { Check, CircleDashed, PauseCircle } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { pauseQueryEnabled } from "@/components/settings/pause-plan";
import { pauseReadOf } from "@/components/settings/pause-read";
import { RegistrationFixForm } from "@/components/settings/registration-fix-form";
import { RejectionNotice } from "@/components/settings/rejection-notice";
import { LoadError, SettingsCard } from "@/components/settings/section";
import {
  US_REGISTRATION_PAUSED_HEADING,
  US_REGISTRATION_PAUSED_NOTE,
  usRegistrationFee,
  usRegistrationPausedTerms,
  usRegistrationTail,
  usRegistrationTerms,
  usRegistrationStarted,
  usRegistrationTiming,
} from "@/components/settings/us-registration-timing";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { usePauseOffer } from "@/lib/api/billing";
import { ApiError } from "@/lib/api/error";
import {
  useEnableUsTexting,
  useRegistration,
  useResendRegistrationOtp,
  useVerifyRegistrationOtp,
} from "@/lib/api/registration";
import type { CompanyView, RegistrationRow } from "@/lib/api/types";
import { useActiveCompany } from "@/lib/company/provider";
import { cn } from "@/lib/utils";

function shortDate(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

type StepState = "done" | "active" | "todo";

function Step({
  state,
  label,
  detail,
  last = false,
}: {
  state: StepState;
  label: string;
  detail?: string | null;
  last?: boolean;
}) {
  return (
    <li className="flex gap-3">
      <div className="flex flex-col items-center">
        <span
          className={cn(
            "flex size-6 shrink-0 items-center justify-center rounded-full border",
            state === "done" && "border-transparent bg-success/15 text-success",
            state === "active" && "border-warning/50 bg-warning/10 text-warning",
            state === "todo" && "border-border text-muted-foreground",
          )}
          aria-hidden
        >
          {state === "done" ? (
            <Check className="size-3.5" strokeWidth={2.5} />
          ) : (
            <CircleDashed className="size-3.5" strokeWidth={1.75} />
          )}
        </span>
        {!last && <span className="w-px flex-1 bg-border" aria-hidden />}
      </div>
      <div className={cn("pb-4", last && "pb-0")}>
        <p
          className={cn(
            "text-sm font-medium",
            state === "todo" && "text-muted-foreground",
          )}
        >
          {label}
        </p>
        {detail && <p className="text-xs text-muted-foreground">{detail}</p>}
      </div>
    </li>
  );
}

/** Sole-prop OTP row (§4.2/§4.4): shown while the brand awaits verification. */
function OtpRow({ brand }: { brand: RegistrationRow }) {
  const verify = useVerifyRegistrationOtp();
  const resend = useResendRegistrationOtp();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  const phone =
    typeof brand.data?.mobilePhone === "string"
      ? (brand.data.mobilePhone as string)
      : "your mobile";

  return (
    <div className="rounded-md border border-warning/40 bg-warning/5 p-4">
      <p className="text-sm">
        One step left: enter the verification code we sent to {phone} to
        finish US registration.
      </p>
      <form
        // method="post" so a pre-hydration native submit sends the OTP code in
        // the body, never the URL (the handler preventDefaults once hydrated).
        method="post"
        className="mt-3 flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!/^\d{6}$/.test(code)) {
            setError("Enter the 6-digit code from the text.");
            return;
          }
          setError(null);
          verify.mutate(code, {
            onSuccess: () => {
              setCode("");
              toast.success("Verified. Registration is moving again.");
            },
            onError: (cause) =>
              setError(
                cause instanceof ApiError
                  ? cause.message
                  : "That code didn't work. Try again.",
              ),
          });
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="otp-code" className="sr-only">
            Verification code
          </Label>
          <Input
            id="otp-code"
            value={code}
            onChange={(event) =>
              setCode(event.target.value.replace(/\D/g, "").slice(0, 6))
            }
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="6-digit code"
            className="w-36 tabular-nums"
          />
        </div>
        <Button type="submit" disabled={verify.isPending}>
          {verify.isPending ? "Checking…" : "Verify"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={resend.isPending}
          onClick={() =>
            resend.mutate(undefined, {
              onSuccess: () => toast.success(`New code texted to ${phone}.`),
              onError: (cause) =>
                toast.error(
                  cause instanceof ApiError
                    ? cause.message
                    : "Couldn't resend the code. Try again.",
                ),
            })
          }
        >
          {resend.isPending ? "Sending…" : "Resend code"}
        </Button>
      </form>
      {error && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

/** CA companies with US texting off: the owner's enable-US flow (SPEC §4.2). */
function EnableUsCard({ company }: { company: CompanyView }) {
  const { role } = useActiveCompany();
  const enable = useEnableUsTexting();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * #525 — is this workspace paused, and may we say so?
   *
   * `paused_at` is a `billing.manage` fact behind `GET /v1/billing/pause` and
   * deliberately NOT on `company_view`, so it is read here the same way the
   * billing screen reads it and run through `PauseRead` rather than a boolean.
   * An owner holds `billing.manage`, so the one reader who can buy this can
   * always ask.
   *
   * ASKED FROM THE CARD RATHER THAN FROM THE DIALOG, and that costs two Stripe
   * round trips server-side on a screen that is otherwise cheap. It is worth
   * it: the answer decides whether this card INVITES the purchase at all, so a
   * dialog-time read would leave the invitation missing from the surface that
   * has to carry it, and would settle the terms a beat after the reader started
   * reading them. `pauseQueryEnabled` keeps it off every workspace that cannot
   * be paused, the query key is shared with the billing screen (one request
   * answers both within a session), and this card only exists for a CA
   * workspace that has not enabled US texting.
   */
  const askPause = pauseQueryEnabled(role === "owner", company);
  const pauseQuery = usePauseOffer(askPause);
  const timing = usRegistrationTiming(pauseReadOf(askPause, pauseQuery));

  const currency = billingCurrencyOf(company.billing_currency);
  const fee = usRegistrationFee(currency);
  const tail = usRegistrationTail(timing);

  return (
    <SettingsCard
      title="US texting"
      description="Texting Canadian numbers already works. Texting US numbers needs a one-time carrier registration."
    >
      {role === "owner" ? (
        <div className="space-y-4">
          {/* #525: ABOVE the control, because it answers the question a paused
              owner asks before pressing anything — "is this even open to me
              right now" — and an answer that arrives after the press is an
              answer they never got. It leads with the reason to do it now; what
              the pause blocks is a term of the sale and is stated in the dialog
              where they agree to it. Rendered only on a CONFIRMED pause: on a
              read still in flight or one that failed, the card is the card it
              has always been. *Applying: Prioritize Intent & the PauseRead rule
              that a screen may not state a fact it has not read.* */}
          {timing === "paused" && (
            <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/40 px-4 py-3">
              <PauseCircle
                className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                strokeWidth={1.75}
                aria-hidden
              />
              <div className="space-y-1">
                <p className="text-sm font-medium">
                  {US_REGISTRATION_PAUSED_HEADING}
                </p>
                <p className="text-sm text-muted-foreground">
                  {US_REGISTRATION_PAUSED_NOTE}
                </p>
              </div>
            </div>
          )}
          <Button onClick={() => setConfirming(true)}>
            Enable US texting: {fee} one-time
          </Button>
          <Dialog open={confirming} onOpenChange={setConfirming}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Enable US texting?</DialogTitle>
                {/* The terms every reader gets. `tail` is null while the pause
                    is unread — the sentence it would otherwise add ("we email
                    you when it's live") is the one a pause makes misleading, so
                    it is withheld rather than guessed at. */}
                <DialogDescription>
                  {usRegistrationTerms(currency)}
                  {tail ? ` ${tail}` : ""}
                </DialogDescription>
              </DialogHeader>
              {/* #525: three facts as three lines. Only the last one changes an
                  expectation, and a clause buried at the end of a long
                  paragraph is the clause that gets skimmed past — at the moment
                  somebody is agreeing to a charge. *Applying: Chunking.* */}
              {timing === "paused" && (
                <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/40 px-4 py-3">
                  <PauseCircle
                    className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                    strokeWidth={1.75}
                    aria-hidden
                  />
                  <ul className="space-y-2">
                    {usRegistrationPausedTerms(currency).map((line) => (
                      <li key={line} className="text-sm text-muted-foreground">
                        {line}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              <DialogFooter>
                <Button variant="outline" onClick={() => setConfirming(false)}>
                  Not now
                </Button>
                <Button
                  disabled={enable.isPending}
                  onClick={() => {
                    setError(null);
                    enable.mutate(undefined, {
                      onSuccess: () => {
                        setConfirming(false);
                        toast.success(usRegistrationStarted(timing));
                      },
                      onError: (cause) =>
                        setError(
                          cause instanceof ApiError
                            ? cause.message
                            : "Couldn't start US registration. Try again.",
                        ),
                    });
                  }}
                >
                  {enable.isPending ? "Starting…" : "Enable US texting"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Ask your account owner to enable US texting; it&apos;s a one-time{" "}
          {fee} carrier registration.
        </p>
      )}
    </SettingsCard>
  );
}

export function RegistrationSection({ company }: { company: CompanyView }) {
  const { role } = useActiveCompany();
  const registration = useRegistration();
  const canEdit = role === "owner" || role === "admin";
  // #352: the notice focuses the field the rejection concerns, scoped to the
  // form rather than reaching across the document for a name attribute.
  // Declared here, above every early return — hooks must run in the same order
  // on every render, and this component returns early four times below.
  const fixFormRef = useRef<HTMLDivElement | null>(null);

  // No registration owed: CA company that hasn't enabled US texting.
  if (company.country === "CA" && !company.us_texting_enabled) {
    // #328: signed in, so the currency is the company's own, not the visitor
    // country signal the marketing pages read. #525: the whole row goes in
    // rather than the currency alone — the card also needs `plan` and
    // `subscription_status` to decide whether asking about a pause is even a
    // question this workspace can have.
    return <EnableUsCard company={company} />;
  }

  if (registration.isPending) {
    return (
      <SettingsCard title="US texting registration">
        <Skeleton className="h-24 w-full" />
      </SettingsCard>
    );
  }
  if (registration.isError) {
    return (
      <SettingsCard title="US texting registration">
        <LoadError onRetry={() => registration.refetch()} />
      </SettingsCard>
    );
  }

  const { brand, campaign } = registration.data;

  if (!brand && !campaign) {
    return (
      <SettingsCard title="US texting registration">
        <p className="text-sm text-muted-foreground">
          Registration starts automatically once your subscription begins.
          Nothing to do here yet.
        </p>
      </SettingsCard>
    );
  }

  const rejectedRow =
    brand?.status === "rejected"
      ? brand
      : campaign?.status === "rejected"
        ? campaign
        : null;
  const approved =
    campaign?.status === "approved" && campaign.deactivated_at === null;
  const deactivated = campaign?.deactivated_at !== null && campaign !== null;
  const isDraft =
    !rejectedRow &&
    !approved &&
    (brand?.status === "draft" || campaign?.status === "draft");
  const otpOutstanding =
    brand !== null &&
    brand.sole_proprietor &&
    (brand.status === "submitted" || brand.status === "pending");

  const submittedAt = brand?.submitted_at ?? campaign?.submitted_at ?? null;
  const inReview = !approved && !rejectedRow && !isDraft && submittedAt !== null;

  const steps: { state: StepState; label: string; detail?: string | null }[] = [
    {
      state: submittedAt ? "done" : isDraft ? "active" : "todo",
      label: "Business details submitted",
      detail: submittedAt
        ? `Submitted ${shortDate(submittedAt)}`
        : "Your details are saved but not submitted yet",
    },
    {
      state: approved ? "done" : inReview ? "active" : "todo",
      label: "Carrier review",
      detail: approved
        ? null
        : inReview
          ? "Usually 3 to 7 business days, we handle it"
          : null,
    },
    {
      state: approved ? "done" : "todo",
      label: "US texting on",
      detail: campaign?.approved_at
        ? `Approved ${shortDate(campaign.approved_at)}`
        : null,
    },
  ];

  return (
    <SettingsCard
      title="US texting registration"
      description="Carriers require every business to register before it can text US numbers. We run the process for you."
    >
      <div className="space-y-4">
        <ol className="pt-1">
          {steps.map((step, index) => (
            <Step
              key={step.label}
              state={step.state}
              label={step.label}
              detail={step.detail}
              last={index === steps.length - 1}
            />
          ))}
        </ol>

        {approved && (
          <p className="rounded-md bg-success/10 px-3 py-2 text-sm text-success">
            US texting is live.
          </p>
        )}

        {inReview && !otpOutstanding && (
          <p className="rounded-md bg-warning/10 px-3 py-2 text-sm">
            US texting activates in ~3 to 7 business days (carrier approval).
            Calling, receiving texts, and texting Canadian numbers already
            work.
          </p>
        )}

        {otpOutstanding && <OtpRow brand={brand} />}

        {deactivated && !approved && !rejectedRow && (
          <p className="rounded-md bg-warning/10 px-3 py-2 text-sm">
            US texting is paused while your subscription is inactive.
            Resubscribing restarts carrier approval automatically.
          </p>
        )}

        {rejectedRow && (
          <div className="space-y-3">
            {/* #352: the carrier's token translated into what happened and the
                one thing to change, with a jump to the field it concerns. The
                raw reason stays on screen, demoted. */}
            <RejectionNotice
              domain="registration"
              reason={rejectedRow.rejection_reason}
              submissionCount={rejectedRow.submission_count}
              formRef={fixFormRef}
              company={{
                id: company.id,
                name: company.name,
                plan: company.plan,
              }}
            />
            {canEdit ? (
              <div ref={fixFormRef}>
                <RegistrationFixForm
                  brand={brand}
                  campaign={campaign}
                  country={company.country}
                />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Ask an owner or admin to update and resubmit the registration.
              </p>
            )}
          </div>
        )}

        {isDraft && !rejectedRow && (
          <div className="space-y-3">
            {canEdit ? (
              <RegistrationFixForm
                brand={brand}
                campaign={campaign}
                country={company.country}
                submitLabel="Submit registration"
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                An owner or admin needs to finish and submit the registration.
              </p>
            )}
          </div>
        )}
      </div>
    </SettingsCard>
  );
}
