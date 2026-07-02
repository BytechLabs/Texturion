"use client";

import { Check, CircleDashed } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { RegistrationFixForm } from "@/components/settings/registration-fix-form";
import { LoadError, SettingsCard } from "@/components/settings/section";
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
              toast.success("Verified — registration is moving again.");
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
function EnableUsCard() {
  const { role } = useActiveCompany();
  const enable = useEnableUsTexting();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <SettingsCard
      title="US texting"
      description="Texting Canadian numbers already works. Texting US numbers needs a one-time carrier registration."
    >
      {role === "owner" ? (
        <>
          <Button onClick={() => setConfirming(true)}>
            Enable US texting — $29 one-time
          </Button>
          <Dialog open={confirming} onOpenChange={setConfirming}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Enable US texting?</DialogTitle>
                <DialogDescription>
                  A one-time $29 registration fee is charged to your card on
                  file, and we register your business with US carriers.
                  Approval usually takes 3–7 business days — we handle it and
                  email you when it&apos;s live.
                </DialogDescription>
              </DialogHeader>
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
                        toast.success(
                          "US registration started — we'll email you when it's approved.",
                        );
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
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          Ask your account owner to enable US texting — it&apos;s a one-time
          $29 carrier registration.
        </p>
      )}
    </SettingsCard>
  );
}

export function RegistrationSection({ company }: { company: CompanyView }) {
  const { role } = useActiveCompany();
  const registration = useRegistration();
  const canEdit = role === "owner" || role === "admin";

  // No registration owed: CA company that hasn't enabled US texting.
  if (company.country === "CA" && !company.us_texting_enabled) {
    return <EnableUsCard />;
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
          Registration starts automatically once your subscription begins —
          nothing to do here yet.
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
          ? "Usually 3–7 business days — we handle it"
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
            US texting activates in ~3–7 business days (carrier approval).
            Receiving texts and texting Canadian numbers already work.
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
            <p className="rounded-md bg-warning/10 px-3 py-2 text-sm">
              US registration needs a fix:{" "}
              {rejectedRow.rejection_reason ??
                "the carrier didn't say why — check your details below"}
              . Update and resubmit — it takes 2 minutes.
            </p>
            {canEdit ? (
              <RegistrationFixForm
                brand={brand}
                campaign={campaign}
                country={company.country}
              />
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
