"use client";

import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Check, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { portabilityFailCopy, portabilityOkCopy } from "@/components/porting/copy";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCreateCompany } from "@/lib/api/companies";
import { ApiError } from "@/lib/api/error";
import { keys } from "@/lib/api/keys";
import type { PortabilityCheck } from "@/lib/api/types";
import { writeCompanyCookie } from "@/lib/company/cookie";
import { browserTimezone } from "@/lib/format/time";
import { formatPhone } from "@/lib/format/phone";

import { writeOnboardingPortDraft } from "../local-draft";
import { StepError, StepLoading, StepShell } from "../step-shell";
import { areaCodeOf, apiFetchCheck, toE164 } from "./port-shared";
import { usePortWizardGuard } from "./use-port-wizard";

/**
 * Port sub-step 1 (PORTING.md §8.1 step 1): enter the number and confirm it can
 * move. The portability check is company-scoped, so this step creates the
 * company first — using the ported number's own area code to default
 * `requested_area_code` (PORTING.md correction 2) and carrying the AUP the
 * company-create call requires — then runs the check. The check is still
 * pre-payment (the company is `incomplete`); D16 allows this one read-only
 * Telnyx call before checkout. A rejection reads plainly with the new-number
 * fallback.
 */
export default function PortNumberPage() {
  const { onboarding, port, ready } = usePortWizardGuard("number");
  const router = useRouter();
  const queryClient = useQueryClient();
  const createCompany = useCreateCompany();

  const [raw, setRaw] = useState("");
  const [aupAccepted, setAupAccepted] = useState(false);
  const [seeded, setSeeded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PortabilityCheck | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { draft } = onboarding;
  useEffect(() => {
    if (!ready || seeded) return;
    setSeeded(true);
    if (port.phoneE164) {
      setRaw(formatPhone(port.phoneE164));
      // Resuming with a saved portable number: the company already exists, so
      // the guard would have redirected. If not, re-checking is one click.
    }
  }, [ready, seeded, port.phoneE164]);

  if (onboarding.status === "error") {
    return <StepError onRetry={onboarding.retry} />;
  }
  if (!ready) return <StepLoading />;

  const country = draft.country ?? "US";
  const e164 = toE164(raw);
  const companyId = onboarding.companyId;

  async function checkAndContinue() {
    setError(null);
    setResult(null);
    if (!e164) {
      setError("Enter your 10-digit US or Canadian number.");
      return;
    }
    if (!aupAccepted && !companyId) {
      setError("Agree to the texting rules to continue.");
      return;
    }
    setBusy(true);
    try {
      // Create the company on first pass (idempotent for our purposes: the
      // guard redirects once it exists). The ported number's area code defaults
      // requested_area_code (unused for a port that buys no inventory).
      let activeCompanyId = companyId;
      if (!activeCompanyId) {
        const timezone = browserTimezone();
        const company = await createCompany.mutateAsync({
          name: (draft.name ?? "").trim(),
          country,
          requested_area_code: areaCodeOf(e164),
          us_texting_enabled: country === "CA" ? draft.usTexting !== false : true,
          ...(timezone ? { timezone } : {}),
          aup_accepted: true,
        });
        writeCompanyCookie(company.id);
        await queryClient.invalidateQueries({ queryKey: keys.me });
        activeCompanyId = company.id;
      }

      // Run the portability check now that a company exists (§8.1 step 1).
      const check = await apiFetchCheck(activeCompanyId, e164);
      setResult(check);
      if (check.portable) {
        writeOnboardingPortDraft({
          phoneE164: e164,
          isWireless: check.is_wireless,
        });
      }
    } catch (cause) {
      // Actionable validation messages (e.g. not-portable, bad number) pass
      // through; a server/upstream outage (internal_error) gets a plain, calm
      // retry line instead of the raw "Something went wrong."
      const friendly =
        "We couldn't check this number just now. Try again in a moment.";
      setError(
        cause instanceof ApiError && cause.code !== "internal_error"
          ? cause.message
          : friendly,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <StepShell
      backHref="/onboarding/number"
      index={1}
      total={5}
      title="Which number do you want to bring?"
      subtitle="Enter the number your customers already text. We'll check it can move to Loonext — no commitment yet."
    >
      <div className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="port-number">Your current business number</Label>
          <Input
            id="port-number"
            value={raw}
            onChange={(e) => {
              setRaw(e.target.value);
              setResult(null);
              setError(null);
            }}
            placeholder="(416) 555-0182"
            inputMode="tel"
            autoComplete="tel"
            className="h-12 text-base tabular-nums"
          />
          <p className="text-[13px] text-muted-foreground">
            US or Canadian local numbers only. Toll-free numbers can&apos;t be
            transferred here.
          </p>
        </div>

        {!companyId ? (
          <label className="flex items-start gap-2 text-sm text-muted-foreground">
            <Checkbox
              checked={aupAccepted}
              onCheckedChange={(checked) => {
                setAupAccepted(checked === true);
                if (checked === true) setError(null);
              }}
              className="mt-0.5"
              aria-label="Agree to the texting rules"
            />
            <span>
              I&apos;ll only text customers who asked to hear from us — no spam,
              no purchased lists.
            </span>
          </label>
        ) : null}

        {result?.portable ? (
          <div className="flex items-start gap-2.5 rounded-lg border border-success/30 bg-success/5 px-4 py-3">
            <Check
              className="mt-0.5 size-4 shrink-0 text-success"
              strokeWidth={2}
              aria-hidden
            />
            <p className="text-sm">
              {portabilityOkCopy(e164 ? formatPhone(e164) : raw)}
            </p>
          </div>
        ) : null}

        {result && !result.portable ? (
          <div className="space-y-3 rounded-lg border border-border bg-card px-4 py-3">
            <div className="flex items-start gap-2.5">
              <X
                className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                strokeWidth={2}
                aria-hidden
              />
              <p className="text-sm">{portabilityFailCopy(result.reason)}</p>
            </div>
            <Button asChild variant="outline" size="sm">
              <a href="/onboarding/number">Get a new number instead</a>
            </Button>
          </div>
        ) : null}

        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}

        {result?.portable ? (
          <Button
            size="lg"
            className="w-full"
            onClick={() => router.push("/onboarding/port/carrier")}
          >
            Continue
            <ArrowRight className="size-4" aria-hidden />
          </Button>
        ) : (
          <Button
            size="lg"
            className="w-full"
            onClick={() => void checkAndContinue()}
            disabled={busy}
          >
            {busy ? "Checking your number…" : "Check this number"}
          </Button>
        )}
      </div>
    </StepShell>
  );
}
