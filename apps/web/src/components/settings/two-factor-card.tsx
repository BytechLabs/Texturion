"use client";

import { Check, Copy, Download, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { SettingsCard } from "@/components/settings/section";
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
import { useIssueRecoveryCodes, useMfa } from "@/lib/api/mfa";
import { getSupabaseBrowser } from "@/lib/supabase/browser";

/**
 * #314 — two-factor authentication, on Settings → Account beside the password.
 *
 * The flow is four steps and the LAST one is the one that matters. A person
 * who enrols and closes the tab before writing their recovery codes down has
 * armed a lock and thrown away the spare key — and this product's lock is
 * their business phone line. So:
 *
 *   * the codes step cannot be dismissed by clicking away or pressing escape,
 *   * it says plainly that this is the only time they will be shown,
 *   * and the button that closes it is labelled with what it asserts
 *     ("I've saved them"), not with "Done".
 *
 * Enrolment itself talks to GoTrue directly (the D8 boundary). The Worker is
 * asked only for the recovery codes, which Supabase does not issue.
 */

type Step =
  | { kind: "idle" }
  | { kind: "scan"; factorId: string; qr: string; secret: string }
  | { kind: "codes"; codes: string[] };

export function TwoFactorCard() {
  const mfa = useMfa();
  const issueCodes = useIssueRecoveryCodes();
  const [step, setStep] = useState<Step>({ kind: "idle" });
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);

  async function beginEnrolment() {
    setBusy(true);
    setError(null);
    try {
      const { data, error: enrolError } = await getSupabaseBrowser().auth.mfa.enroll({
        factorType: "totp",
        friendlyName: `Authenticator app · ${new Date().toLocaleDateString()}`,
      });
      if (enrolError || !data) throw enrolError ?? new Error("enrol failed");
      setStep({
        kind: "scan",
        factorId: data.id,
        qr: data.totp.qr_code,
        secret: data.totp.secret,
      });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Couldn't start setup. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function verify(factorId: string) {
    setBusy(true);
    setError(null);
    try {
      const supabase = getSupabaseBrowser();
      const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({
        factorId,
        code: code.replace(/\D/g, ""),
      });
      if (verifyError) throw verifyError;

      // Codes are issued only after the factor is verified — a set handed out
      // before the app is proven working would be recovery for a lock that
      // was never fitted.
      const { codes } = await issueCodes.mutateAsync();
      setCode("");
      setStep({ kind: "codes", codes });
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : "That code didn't match. Check your app and try the next one.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    setBusy(true);
    try {
      const supabase = getSupabaseBrowser();
      for (const factor of mfa.data?.factors ?? []) {
        const { error: unenrolError } = await supabase.auth.mfa.unenroll({
          factorId: factor.id,
        });
        if (unenrolError) throw unenrolError;
      }
      setConfirmOff(false);
      await mfa.refetch();
      toast.success("Two-factor authentication is off.");
    } catch (cause) {
      toast.error(
        cause instanceof Error
          ? cause.message
          : "Couldn't turn it off. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function regenerate() {
    try {
      const { codes } = await issueCodes.mutateAsync();
      setStep({ kind: "codes", codes });
    } catch (cause) {
      toast.error(
        cause instanceof ApiError ? cause.message : "Couldn't issue new codes.",
      );
    }
  }

  if (mfa.isPending) {
    return <Skeleton className="h-40 w-full rounded-lg" />;
  }

  const enrolled = mfa.data?.enrolled ?? false;
  const remaining = mfa.data?.recovery_codes_remaining ?? 0;

  return (
    <SettingsCard
      title="Two-factor authentication"
      description="A code from your phone, on top of your password. It is what stops a stolen password becoming somebody texting your customers as you."
    >
      <div className="space-y-4">
        {enrolled ? (
          <>
            <div className="flex items-start gap-3 rounded-lg border bg-card px-4 py-3">
              <ShieldCheck
                className="mt-0.5 size-5 shrink-0 text-primary"
                strokeWidth={1.75}
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">Authenticator app is on</p>
                <p className="text-sm text-muted-foreground">
                  {remaining > 0 ? (
                    <>
                      {remaining} recovery{" "}
                      {remaining === 1 ? "code" : "codes"} left.
                    </>
                  ) : (
                    // Nought left is a lockout waiting for a lost phone, so it
                    // reads as something to fix rather than a statistic.
                    <span className="text-amber-600 dark:text-amber-500">
                      No recovery codes left — issue a new set now.
                    </span>
                  )}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={issueCodes.isPending}
                onClick={regenerate}
              >
                New recovery codes
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setConfirmOff(true)}
              >
                Turn off
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              You&apos;ll scan a QR code with an authenticator app — Google
              Authenticator, 1Password, whatever you already use — and enter a
              six-digit code to prove it worked. We&apos;ll give you backup
              codes for the day you lose the phone.
            </p>
            <Button type="button" disabled={busy} onClick={beginEnrolment}>
              Set up two-factor
            </Button>
          </>
        )}
        {error && step.kind === "idle" && (
          <p className="text-sm text-destructive">{error}</p>
        )}
      </div>

      {/* Step 2: scan and prove it works. */}
      <Dialog
        open={step.kind === "scan"}
        onOpenChange={(open) => {
          if (!open) {
            setStep({ kind: "idle" });
            setCode("");
            setError(null);
          }
        }}
      >
        <DialogContent>
          {step.kind === "scan" && (
            <>
              <DialogHeader>
                <DialogTitle>Scan this with your authenticator app</DialogTitle>
                <DialogDescription>
                  Then type the six-digit code it shows.
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-col items-center gap-4">
                {/* Supabase returns the QR as an SVG data URI. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={step.qr}
                  alt="QR code for your authenticator app"
                  className="size-48 rounded-lg bg-white p-2"
                />
                <div className="w-full space-y-1">
                  <Label className="text-xs text-muted-foreground">
                    Can&apos;t scan? Enter this key instead
                  </Label>
                  <code className="block w-full break-all rounded-md bg-muted px-3 py-2 text-xs">
                    {step.secret}
                  </code>
                </div>
                <div className="w-full space-y-1.5">
                  <Label htmlFor="mfa-code">Six-digit code</Label>
                  <Input
                    id="mfa-code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder="123456"
                    maxLength={7}
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                  />
                  {error && <p className="text-sm text-destructive">{error}</p>}
                </div>
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setStep({ kind: "idle" })}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  disabled={busy || code.replace(/\D/g, "").length < 6}
                  onClick={() => verify(step.factorId)}
                >
                  {busy ? "Checking…" : "Turn it on"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Step 3: the codes. The one screen in this flow that must not be
          dismissable by accident — see the note at the top of the file. */}
      <Dialog open={step.kind === "codes"}>
        <DialogContent
          showCloseButton={false}
          onPointerDownOutside={(event) => event.preventDefault()}
          onEscapeKeyDown={(event) => event.preventDefault()}
        >
          {step.kind === "codes" && (
            <>
              <DialogHeader>
                <DialogTitle>Save your recovery codes</DialogTitle>
                <DialogDescription>
                  This is the only time you will see these. If you lose your
                  phone, one of these codes is how you get back in — without
                  them, getting back into your business line takes us weeks.
                </DialogDescription>
              </DialogHeader>
              <ul className="grid grid-cols-2 gap-2 rounded-lg border bg-muted/40 p-3 font-mono text-sm">
                {step.codes.map((entry) => (
                  <li key={entry}>{entry}</li>
                ))}
              </ul>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    void navigator.clipboard.writeText(step.codes.join("\n"));
                    setCopied(true);
                    toast.success("Copied.");
                  }}
                >
                  {copied ? (
                    <Check className="size-4" strokeWidth={1.75} aria-hidden />
                  ) : (
                    <Copy className="size-4" strokeWidth={1.75} aria-hidden />
                  )}
                  Copy
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const blob = new Blob(
                      [
                        "Loonext recovery codes\n\n",
                        step.codes.join("\n"),
                        "\n\nEach code works once. Keep them somewhere you can " +
                          "reach without your phone.\n",
                      ],
                      { type: "text/plain" },
                    );
                    const url = URL.createObjectURL(blob);
                    const link = document.createElement("a");
                    link.href = url;
                    link.download = "loonext-recovery-codes.txt";
                    link.click();
                    URL.revokeObjectURL(url);
                    setCopied(true);
                  }}
                >
                  <Download className="size-4" strokeWidth={1.75} aria-hidden />
                  Download
                </Button>
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  // Not enabled until they have taken the codes somewhere. The
                  // friction is the feature: this is the step people skip and
                  // then need six months later.
                  disabled={!copied}
                  onClick={() => {
                    setStep({ kind: "idle" });
                    setCopied(false);
                    void mfa.refetch();
                    toast.success("Two-factor authentication is on.");
                  }}
                >
                  I&apos;ve saved them
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={confirmOff} onOpenChange={setConfirmOff}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Turn off two-factor authentication?</DialogTitle>
            <DialogDescription>
              Your account goes back to a password alone. If this workspace
              requires two-factor, you will be asked to set it up again the
              next time you open the app.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmOff(false)}
            >
              Keep it on
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={busy}
              onClick={turnOff}
            >
              Turn it off
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsCard>
  );
}
