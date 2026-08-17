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
import { useT } from "@/i18n/provider";
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

/**
 * What `mfa.verify` wants for a passkey's `credential_response`.
 *
 * Named here because the SDK does not re-export the type and reaching into
 * `@supabase/auth-js` directly would depend on a package this app does not
 * declare. See the cast site for why an instance needs describing at all.
 */
type SdkCredentialResponse = Parameters<
  ReturnType<typeof getSupabaseBrowser>["auth"]["mfa"]["verify"]
> extends [infer P]
  ? P extends { webauthn: { credential_response: infer C } }
    ? C
    : never
  : never;

type Step =
  | { kind: "idle" }
  | { kind: "scan"; factorId: string; qr: string; secret: string }
  | { kind: "codes"; codes: string[] };

export function TwoFactorCard() {
  const t = useT();
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
        friendlyName: t("settingsMore.tfaAuthenticatorFactorName", {
          date: new Date().toLocaleDateString(),
        }),
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
          : t("settingsMore.tfaStartFailed"),
      );
    } finally {
      setBusy(false);
    }
  }

  /**
   * #473 — enrol a passkey, which is the same protection without typing digits.
   *
   * #314 shipped codes from an authenticator app and said in its own words that
   * passkeys suit these users better. It is right: a tradesperson holds ONE
   * phone, and the authenticator sits on the same screen as the app asking for
   * the six digits. A passkey is Face ID or a fingerprint instead.
   *
   * A SECOND FACTOR AND NEVER THE PASSWORD (D125). The credential lives on the
   * device, so a phone in a skip would otherwise be an account nobody can reach
   * except through the recovery codes — which turns the last resort into the
   * primary key.
   *
   * Four steps against GoTrue. `challenge` hands back credential options with
   * real ArrayBuffers and `verify` serialises the authenticator's answer itself,
   * so there is no base64url plumbing here to get wrong — the two casts below are
   * a disagreement about type vintages, explained where they are. The vendor
   * marks these methods experimental, which is survivable for
   * an ADDITIONAL factor — a broken ceremony falls back to an authenticator app
   * or the codes — and is the second reason D125 refuses to let it stand alone.
   */
  async function beginPasskey() {
    setBusy(true);
    setError(null);
    try {
      const supabase = getSupabaseBrowser();
      const { data: factor, error: enrolError } = await supabase.auth.mfa.enroll({
        factorType: "webauthn",
        friendlyName: t("settingsMore.tfaPasskeyFactorName", {
          date: new Date().toLocaleDateString(),
        }),
      });
      if (enrolError || !factor) throw enrolError ?? new Error("enrol failed");

      const { data: challenge, error: challengeError } =
        await supabase.auth.mfa.challenge({
          factorId: factor.id,
          webauthn: {
            rpId: window.location.hostname,
            rpOrigins: [window.location.origin],
          },
        });
      if (challengeError || !challenge) {
        throw challengeError ?? new Error("challenge failed");
      }
      if (challenge.webauthn.type !== "create") {
        // Enrolling a fresh factor can only be a creation ceremony. If the
        // server asks for an assertion instead, something is being replayed and
        // the honest move is to stop rather than sign whatever was sent.
        throw new Error(t("settingsMore.tfaUnexpectedStep"));
      }

      // TWO CASTS, ONE REASON, AND IT IS A TYPE VINTAGE RATHER THAN A DOUBT.
      //
      // The SDK models WebAuthn Level 3 (`…OptionsFuture`, credentials carrying
      // `parseCreationOptionsFromJSON`); the TypeScript DOM library we compile
      // against models Level 2. The RUNTIME values are exactly what each side
      // wants — the browser accepts the options the server sent, and the SDK
      // serialises the credential the browser returned — so the disagreement is
      // between two descriptions of the same object, one written later than the
      // other. Casting here, at the DOM boundary, is narrower and more honest
      // than widening either type or reaching for the SDK's undeclared
      // experimental wrapper.
      const credential = await navigator.credentials.create({
        publicKey: challenge.webauthn.credential_options
          .publicKey as unknown as PublicKeyCredentialCreationOptions,
      });
      if (!credential) {
        // The browser returns null when the person dismisses the sheet. Not an
        // error to shout about — they simply changed their mind.
        setStep({ kind: "idle" });
        return;
      }

      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId: factor.id,
        challengeId: challenge.id,
        webauthn: {
          rpId: window.location.hostname,
          rpOrigins: [window.location.origin],
          type: "create",
          // The other half, and its own flavour of the same thing: the SDK's
          // parameter names the credential CLASS, whose Level 3 typing carries
          // static `parse…FromJSON` helpers, where what it wants is an instance.
          // An instance therefore does not satisfy it, and no runtime difference
          // exists — this is the object the browser just produced.
          credential_response: credential as unknown as SdkCredentialResponse,
        },
      });
      if (verifyError) throw verifyError;

      // The SAME rule as the authenticator path, and it is the one that matters:
      // codes only after the factor is proven, and shown before anything else.
      // A passkey armed with no spare key is a lock on a business phone line
      // whose only key is inside a phone.
      const { codes } = await issueCodes.mutateAsync();
      setStep({ kind: "codes", codes });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? // The browser's own message is better than ours here: "the operation
            // either timed out or was not allowed" is what a person needs to
            // read when their fingerprint was not recognised.
            cause.message
          : t("settingsMore.tfaPasskeyFailed"),
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
          : t("settingsMore.tfaCodeMismatch"),
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
      toast.success(t("settingsMore.tfaTurnedOff"));
    } catch (cause) {
      toast.error(
        cause instanceof Error
          ? cause.message
          : t("settingsMore.tfaTurnOffFailed"),
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
        cause instanceof ApiError
          ? cause.message
          : t("settingsMore.tfaIssueCodesFailed"),
      );
    }
  }

  if (mfa.isPending) {
    return <Skeleton className="h-40 w-full rounded-lg" />;
  }

  const enrolled = mfa.data?.enrolled ?? false;
  const remaining = mfa.data?.recovery_codes_remaining ?? 0;

  // #473: what is actually enrolled, in the reader's words. `GET /v1/mfa` has
  // always carried the type; nothing showed it while there was only one kind.
  const factors = mfa.data?.factors ?? [];
  const hasPasskey = factors.some((factor) => factor.type === "webauthn");
  const hasAuthenticator = factors.some((factor) => factor.type === "totp");
  const enrolledLabel =
    hasPasskey && hasAuthenticator
      ? t("settingsMore.tfaBothOn")
      : hasPasskey
        ? t("settingsMore.tfaPasskeyOn")
        : hasAuthenticator
          ? t("settingsMore.tfaAuthenticatorOn")
          : // A verified factor of a type this card does not name yet. Say the
            // true thing rather than guessing which one it is.
            t("settingsMore.tfaOn");

  // Only offered where the browser can actually do it. A button that opens
  // nothing is worse than an absent one, and Safari on an old iPad is a real
  // device in a real van.
  const passkeysAvailable =
    typeof window !== "undefined" &&
    typeof window.PublicKeyCredential === "function";

  return (
    <SettingsCard
      title={t("settingsMore.tfaTitle")}
      description={t("settingsMore.tfaDescription")}
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
                {/* #473: NAMES WHAT IS ON, because two kinds can be. "Two-factor
                    is on" would leave somebody who added a passkey unable to
                    tell whether the authenticator app they set up last year is
                    still there — and the answer decides what happens when they
                    lose one of the two. */}
                <p className="text-sm font-medium">{enrolledLabel}</p>
                <p className="text-sm text-muted-foreground">
                  {remaining > 0 ? (
                    <>
                      {remaining === 1
                        ? t("settingsMore.tfaCodesLeftOne", {
                            count: remaining,
                          })
                        : t("settingsMore.tfaCodesLeftMany", {
                            count: remaining,
                          })}
                    </>
                  ) : (
                    // Nought left is a lockout waiting for a lost phone, so it
                    // reads as something to fix rather than a statistic.
                    <span className="text-amber-600 dark:text-amber-500">
                      {t("settingsMore.tfaNoCodesLeft")}
                    </span>
                  )}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {/*
                #473: THE SECOND FACTOR, which had no way in.
                `enrolled` is `factors.length > 0`, and the whole enrolment
                block sits in this ternary's other branch — so somebody who set
                up an authenticator app could never add a passkey, and somebody
                with a passkey could never add the app. The issue's second
                acceptance criterion asks for exactly that pairing, and
                `tfaBothOn` above was copy for a state the product could not
                reach: a label with a passing test and no route to it.

                Only the MISSING kind is offered, and only as one quiet action
                beside the other management controls. A second full pitch here
                would compete with the two things somebody actually opens this
                card to do. *Applying: Chunking, and Zen of Clarity — the
                option that does not apply is absent rather than disabled.*
              */}
              {!hasPasskey && passkeysAvailable && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={beginPasskey}
                >
                  {t("settingsMore.tfaAddPasskey")}
                </Button>
              )}
              {!hasAuthenticator && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={beginEnrolment}
                >
                  {t("settingsMore.tfaAddAuthenticator")}
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={issueCodes.isPending}
                onClick={regenerate}
              >
                {t("settingsMore.tfaNewCodes")}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setConfirmOff(true)}
              >
                {t("settingsMore.offRampTurnOff")}
              </Button>
            </div>
          </>
        ) : (
          <>
            {/* #473: the passkey leads where the browser can do it, and the
                authenticator app stands beside it rather than under a "more
                options" fold. Two choices is the whole list — a third would be
                a decision to make before the one that matters, which is
                turning this on at all.
                *Applying: Chunking, and Prioritise Intent.* */}
            {passkeysAvailable ? (
              <>
                <p className="text-sm text-muted-foreground">
                  {t("settingsMore.tfaPasskeyPitch")}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" disabled={busy} onClick={beginPasskey}>
                    {t("settingsMore.tfaUsePasskey")}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={beginEnrolment}
                  >
                    {t("settingsMore.tfaUseAuthenticator")}
                  </Button>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  {t("settingsMore.tfaAuthenticatorPitch")}
                </p>
                <Button type="button" disabled={busy} onClick={beginEnrolment}>
                  {t("settingsMore.tfaSetUp")}
                </Button>
              </>
            )}
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
                <DialogTitle>{t("settingsMore.tfaScanTitle")}</DialogTitle>
                <DialogDescription>
                  {t("settingsMore.tfaScanBody")}
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-col items-center gap-4">
                {/* Supabase returns the QR as an SVG data URI. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={step.qr}
                  alt={t("settingsMore.tfaQrAlt")}
                  className="size-48 rounded-lg bg-white p-2"
                />
                <div className="w-full space-y-1">
                  <Label className="text-xs text-muted-foreground">
                    {t("settingsMore.tfaManualKey")}
                  </Label>
                  <code className="block w-full break-all rounded-md bg-muted px-3 py-2 text-xs">
                    {step.secret}
                  </code>
                </div>
                <div className="w-full space-y-1.5">
                  <Label htmlFor="mfa-code">
                    {t("settingsMore.tfaSixDigitCode")}
                  </Label>
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
                  {t("common.cancel")}
                </Button>
                <Button
                  type="button"
                  disabled={busy || code.replace(/\D/g, "").length < 6}
                  onClick={() => verify(step.factorId)}
                >
                  {busy
                    ? t("settingsMore.regOtpChecking")
                    : t("settingsMore.tfaTurnItOn")}
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
                <DialogTitle>{t("settingsMore.tfaCodesTitle")}</DialogTitle>
                <DialogDescription>
                  {t("settingsMore.tfaCodesBody")}
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
                    toast.success(t("settingsMore.tfaCopied"));
                  }}
                >
                  {copied ? (
                    <Check className="size-4" strokeWidth={1.75} aria-hidden />
                  ) : (
                    <Copy className="size-4" strokeWidth={1.75} aria-hidden />
                  )}
                  {t("settingsMore.tfaCopy")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const blob = new Blob(
                      [
                        `${t("settingsMore.tfaFileHeading")}\n\n`,
                        step.codes.join("\n"),
                        `\n\n${t("settingsMore.tfaFileFooter")}\n`,
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
                  {t("settingsMore.tfaDownload")}
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
                    toast.success(t("settingsMore.tfaOn"));
                  }}
                >
                  {t("settingsMore.tfaSavedThem")}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={confirmOff} onOpenChange={setConfirmOff}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("settingsMore.tfaTurnOffTitle")}</DialogTitle>
            <DialogDescription>
              {t("settingsMore.tfaTurnOffBody")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmOff(false)}
            >
              {t("settingsMore.tfaKeepItOn")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={busy}
              onClick={turnOff}
            >
              {t("settingsMore.tfaTurnItOff")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsCard>
  );
}
