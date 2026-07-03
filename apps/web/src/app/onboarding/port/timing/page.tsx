"use client";

import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Check, FileText } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import {
  PORT_CHECKOUT_TIMELINE,
  PORT_HONEST_WINDOW,
} from "@/components/porting/copy";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCreatePortRequestForCompany } from "@/lib/api/porting";
import { ApiError } from "@/lib/api/error";
import { keys } from "@/lib/api/keys";
import type { CreatePortRequestInput } from "@/lib/api/types";
import { formatPhone } from "@/lib/format/phone";

import { clearOnboardingDraft } from "../../local-draft";
import { StepError, StepLoading, StepShell } from "../../step-shell";
import { usePortWizardGuard } from "../use-port-wizard";

/**
 * Port sub-step 4 (PORTING.md §8.1 steps 5–6): an optional requested switch-over
 * date, the honest window, and the opt-in "tide-me-over" number. Submitting
 * creates the `POST /v1/port-requests` draft (the server re-validates + re-runs
 * the portability check as its gate) — during onboarding the company is
 * `incomplete`, so the Telnyx order is DEFERRED to the paid checkout webhook
 * (paid-first, D16). The signed LOA + recent bill are uploaded AFTER payment
 * (§3.2) — we set that expectation here rather than collecting files pre-pay.
 * On success the draft is cleared and the standard dispatcher takes over into
 * registration (or straight to the plan for CA-no-US).
 */
export default function PortTimingPage() {
  const { onboarding, port, ready } = usePortWizardGuard("timing");
  const router = useRouter();
  const queryClient = useQueryClient();
  const createPort = useCreatePortRequestForCompany();

  const [focDate, setFocDate] = useState("");
  const [wantsBridge, setWantsBridge] = useState(false);
  const [seeded, setSeeded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready || seeded) return;
    setSeeded(true);
    if (port.focDatetimeRequested) {
      setFocDate(port.focDatetimeRequested.slice(0, 10));
    }
    if (port.wantsBridgeNumber !== undefined) {
      setWantsBridge(port.wantsBridgeNumber);
    }
  }, [ready, seeded, port]);

  if (onboarding.status === "error") {
    return <StepError onRetry={onboarding.retry} />;
  }
  if (!ready) return <StepLoading />;

  const companyId = onboarding.companyId;

  async function onSubmit() {
    setError(null);
    if (!companyId) {
      setError("Something went wrong setting up your workspace. Go back a step and try again.");
      return;
    }
    if (
      !port.phoneE164 ||
      !port.entityName ||
      !port.authPersonName ||
      !port.accountNumber ||
      !port.serviceStreet ||
      !port.serviceLocality ||
      !port.serviceAdminArea ||
      !port.servicePostalCode
    ) {
      setError("Some transfer details are missing — go back and complete them.");
      return;
    }

    const body: CreatePortRequestInput = {
      phone_e164: port.phoneE164,
      entity_name: port.entityName,
      auth_person_name: port.authPersonName,
      account_number: port.accountNumber,
      service_street: port.serviceStreet,
      service_locality: port.serviceLocality,
      service_admin_area: port.serviceAdminArea,
      service_postal_code: port.servicePostalCode,
      wants_bridge_number: wantsBridge,
      ...(port.serviceExtended ? { service_extended: port.serviceExtended } : {}),
      ...(port.billingPhoneNumber
        ? { billing_phone_number: port.billingPhoneNumber }
        : {}),
      ...(port.pinPasscode ? { pin_passcode: port.pinPasscode } : {}),
      ...(port.isWireless && port.ssnSinLast4
        ? { ssn_sin_last4: port.ssnSinLast4 }
        : {}),
      ...(focDate
        ? { foc_datetime_requested: new Date(`${focDate}T12:00:00Z`).toISOString() }
        : {}),
    };

    try {
      await createPort.mutateAsync({
        companyId,
        body,
        // Stable per port attempt so a retry replays the same row (§7).
        idempotencyKey: crypto.randomUUID(),
      });
      // The port draft now exists (deferred to the paid webhook). Clear the
      // local draft and hand off to the dispatcher → registration or plan.
      clearOnboardingDraft();
      await queryClient.invalidateQueries({ queryKey: keys.company(companyId) });
      router.push("/onboarding");
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : "We couldn't save your transfer just now. Try again in a moment.",
      );
    }
  }

  const display = port.phoneE164 ? formatPhone(port.phoneE164) : "your number";

  return (
    <StepShell
      backHref="/onboarding/port/address"
      index={4}
      total={5}
      title="When should the switch happen?"
      subtitle="Pick a target date if you have one, or leave it to us to move it as soon as your carrier confirms."
    >
      <div className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="foc-date">
            Preferred switch-over date{" "}
            <span className="font-normal text-muted-foreground">
              (optional)
            </span>
          </Label>
          <Input
            id="foc-date"
            type="date"
            value={focDate}
            onChange={(e) => setFocDate(e.target.value)}
            className="tabular-nums"
          />
        </div>

        {/* The honest window (PORTING.md §8.1 / §9), before payment. */}
        <div className="rounded-lg border border-border bg-card p-5">
          <h2 className="text-[15px] font-medium">How the transfer works</h2>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {PORT_HONEST_WINDOW}
          </p>
          <ul className="mt-3 space-y-2">
            {PORT_CHECKOUT_TIMELINE.map((line) => (
              <li
                key={line}
                className="flex items-start gap-2.5 text-sm text-muted-foreground"
              >
                <Check
                  className="mt-0.5 size-4 shrink-0 text-success"
                  strokeWidth={1.75}
                  aria-hidden
                />
                {line}
              </li>
            ))}
          </ul>
        </div>

        {/* Documents are a post-payment step (§3.2 / D16) — set the expectation
            rather than collecting files here. */}
        <div className="flex items-start gap-2.5 rounded-lg border border-dashed border-border px-4 py-3">
          <FileText
            className="mt-0.5 size-4 shrink-0 text-muted-foreground"
            strokeWidth={1.75}
            aria-hidden
          />
          <p className="text-[13px] text-muted-foreground">
            After you pay, you&apos;ll upload a signed authorization and a recent
            bill — then we send the transfer to your carrier. We&apos;ll walk you
            through it.
          </p>
        </div>

        {/* Opt-in tide-me-over number (D16 / §8.1 step 6), default OFF. */}
        <label className="flex items-start gap-3 rounded-lg border border-border bg-card px-4 py-3 text-sm">
          <Checkbox
            checked={wantsBridge}
            onCheckedChange={(checked) => setWantsBridge(checked === true)}
            className="mt-0.5"
            aria-label="Give me a temporary number while my number transfers"
          />
          <span className="space-y-0.5">
            <span className="block font-medium">
              Give me a temporary number to text from now
            </span>
            <span className="block text-[13px] text-muted-foreground">
              Text customers today while {display} transfers. You can release it
              once your number arrives.
            </span>
          </span>
        </label>

        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <Button
          size="lg"
          className="w-full"
          onClick={() => void onSubmit()}
          disabled={createPort.isPending}
        >
          {createPort.isPending ? (
            "Saving your transfer…"
          ) : (
            <>
              Save and continue
              <ArrowRight className="size-4" aria-hidden />
            </>
          )}
        </Button>
      </div>
    </StepShell>
  );
}
