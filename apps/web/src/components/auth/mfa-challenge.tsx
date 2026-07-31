"use client";

import { KeyRound, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiFetch } from "@/lib/api/client";
import { ApiError } from "@/lib/api/error";
import { getSupabaseBrowser } from "@/lib/supabase/browser";

/** A TOTP code is always six digits; a recovery code is ten characters. */
const TOTP_LENGTH = 6;

type Mode = "code" | "recovery";

/**
 * #496 — the second step of signing in, for somebody who has a factor.
 *
 * GoTrue signs a password login in at `aal1` and expects the APPLICATION to
 * ask for the code; nothing in it refuses the session on its own. Before this
 * nothing asked, so "two-factor is on" meant a factor existed and a password
 * still opened the whole product. This is what asks.
 *
 * Used in two places, because there are two ways to arrive at an `aal1`
 * session that needs lifting: straight after sign-in (the login page renders
 * this instead of navigating), and on a session that was already open when the
 * factor was added elsewhere (the shell's gate renders it when the API answers
 * `mfa_challenge_required`).
 *
 * The design constraint is not friction, it is LOCKOUT. Somebody whose
 * authenticator is on a phone they no longer have must be able to see the way
 * out without hunting for it, so the recovery path is on the screen rather
 * than behind a menu — and it is honest about what it does, because burning a
 * code REMOVES the factor rather than letting them past it once.
 */
export function MfaChallenge({
  onVerified,
  /** Sign out — always offered, as on every other gate in this app (#207). */
  footer,
}: {
  onVerified: () => void;
  footer?: React.ReactNode;
}) {
  const [mode, setMode] = useState<Mode>("code");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Guards the auto-submit: without it, a failed verify would resubmit the same
  // six digits on every keystroke of the correction.
  const submittedRef = useRef<string | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, [mode]);

  async function verifyCode(code: string) {
    setBusy(true);
    setError(null);
    try {
      const supabase = getSupabaseBrowser();
      const { data, error: listError } = await supabase.auth.mfa.listFactors();
      if (listError) throw listError;
      const factor = data?.totp?.[0];
      if (!factor) {
        // Nothing to challenge against. Rather than spin, say so and let them
        // out — this is the state a factor removed on another device leaves.
        setError(
          "We couldn't find an authenticator on this account. Sign out and back in.",
        );
        return;
      }
      const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({
        factorId: factor.id,
        code,
      });
      if (verifyError) throw verifyError;
      onVerified();
    } catch {
      // Deliberately one message for every failure mode. Telling a wrong code
      // apart from an expired one helps an attacker more than the owner of the
      // phone, who tries the next code either way.
      setError("That code didn't match. Check your app and try the next one.");
      submittedRef.current = null;
    } finally {
      setBusy(false);
    }
  }

  async function redeemRecoveryCode(code: string) {
    setBusy(true);
    setError(null);
    try {
      // `apiFetch` rather than a hook: this renders on the login page, outside
      // the app shell's query provider. The route is company-exempt server-side
      // precisely so it is reachable from here.
      await apiFetch("/v1/mfa/recover", { method: "POST", body: { code } });
      // The factor is gone, so this session no longer needs lifting. The caller
      // continues; Settings will show two-factor as off, which is the honest
      // state and the prompt to set it up again.
      onVerified();
    } catch (cause) {
      setError(
        cause instanceof ApiError && cause.code === "rate_limited"
          ? "Too many wrong codes. Try again in an hour."
          : cause instanceof ApiError
            ? "That code is not valid."
            : "We couldn't reach the server. Check your connection.",
      );
    } finally {
      setBusy(false);
    }
  }

  function submit(raw: string) {
    const code = raw.trim();
    if (!code || busy) return;
    submittedRef.current = code;
    void (mode === "code" ? verifyCode(code.replace(/\D/g, "")) : redeemRecoveryCode(code));
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <ShieldCheck
          className="size-7 text-primary"
          strokeWidth={1.5}
          aria-hidden
        />
        <h1 className="text-2xl font-semibold tracking-tight">
          {mode === "code" ? "Enter your code" : "Use a recovery code"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {mode === "code"
            ? "Open your authenticator app and type the six digits it shows."
            : "One of the ten codes you saved when you set two-factor up. Using one turns two-factor OFF so you can get in and set it up again."}
        </p>
      </div>

      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          submit(value);
        }}
      >
        <Input
          ref={inputRef}
          value={value}
          onChange={(event) => {
            const next = event.target.value;
            setValue(next);
            setError(null);
            // Auto-submit on the sixth digit. The whole interaction is "read a
            // number, type it" — making somebody then reach for a button is a
            // step that exists only because the form has one.
            const digits = next.replace(/\D/g, "");
            if (
              mode === "code" &&
              digits.length === TOTP_LENGTH &&
              submittedRef.current !== digits
            ) {
              submit(digits);
            }
          }}
          // The OS offers the code from the notification/keychain with this.
          autoComplete={mode === "code" ? "one-time-code" : "off"}
          inputMode={mode === "code" ? "numeric" : "text"}
          maxLength={mode === "code" ? TOTP_LENGTH : 20}
          placeholder={mode === "code" ? "123456" : "ABCDE-FGHJK"}
          aria-label={mode === "code" ? "Six-digit code" : "Recovery code"}
          aria-invalid={error ? true : undefined}
          disabled={busy}
          className={mode === "code" ? "text-center text-lg tracking-[0.4em]" : ""}
        />
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        <Button type="submit" className="w-full" disabled={busy || !value.trim()}>
          {busy ? "Checking…" : mode === "code" ? "Continue" : "Use this code"}
        </Button>
      </form>

      <div className="flex flex-col items-center gap-3 text-sm">
        <button
          type="button"
          className="inline-flex items-center gap-1.5 text-muted-foreground underline-offset-4 hover:underline"
          onClick={() => {
            setMode(mode === "code" ? "recovery" : "code");
            setValue("");
            setError(null);
            submittedRef.current = null;
          }}
        >
          <KeyRound className="size-3.5" aria-hidden />
          {mode === "code"
            ? "I don't have my authenticator"
            : "I have my authenticator after all"}
        </button>
        {footer}
      </div>
    </div>
  );
}
