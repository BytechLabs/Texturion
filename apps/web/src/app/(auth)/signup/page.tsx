"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { OAuthButtons } from "@/components/auth/oauth-buttons";
import { Turnstile, type TurnstileHandle } from "@/components/auth/turnstile";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { publicEnv } from "@/env";
import { useT, type Translate } from "@/i18n/provider";
import {
  trackSignupCompleted,
  trackSignupStarted,
} from "@/lib/analytics/events";
import { authErrorMessage } from "@/lib/auth/messages";
import {
  planIntentSearch,
  stashPlanIntentFromSearch,
  type PlanIntent,
} from "@/lib/marketing/plan-intent";
import { getSupabaseBrowser } from "@/lib/supabase/browser";

const RESEND_COOLDOWN_MS = 60_000;

/*
 * A factory rather than a module-level constant: every message below is read
 * UNDER the field by the person filling it in, so it is copy and belongs in the
 * catalogue. The type comes from the factory's return, so the form's typing does
 * not depend on which locale built the schema.
 */
function makeSchema(t: Translate) {
  return z.object({
    name: z.string().trim().min(1, t("onboarding.nameRequired")),
    email: z.email(t("onboarding.emailRequired")),
    password: z.string().min(8, t("onboarding.passwordTooShort")),
  });
}

type FormValues = z.infer<ReturnType<typeof makeSchema>>;

export default function SignupPage() {
  const t = useT();
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [confirmationEmail, setConfirmationEmail] = useState<string | null>(
    null,
  );
  const [resendAvailableAt, setResendAvailableAt] = useState<number | null>(null);
  const [resendSending, setResendSending] = useState(false);
  const [resent, setResent] = useState(false);
  useEffect(() => {
    if (resendAvailableAt === null) return;
    const timeout = window.setTimeout(
      () => setResendAvailableAt(null),
      Math.max(0, resendAvailableAt - Date.now()),
    );
    return () => window.clearTimeout(timeout);
  }, [resendAvailableAt]);

  // Optional Turnstile gate (SPEC §10 front door). When the site key is
  // configured, Supabase Auth verifies the token server-side, so submit stays
  // blocked until the widget hands one over; when it isn't, signup behaves
  // exactly as before.
  const siteKey = publicEnv.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const turnstileRef = useRef<TurnstileHandle>(null);
  const canResend = !resendSending && resendAvailableAt === null && (!siteKey || captchaToken !== null);

  // The /pricing plan builder lands here with ?plan=…&modules=… and promises
  // "what you build here is exactly what checkout starts from". Validate +
  // stash that intent (sessionStorage, loonext.plan_intent) and thread it
  // through BOTH auth paths below so the onboarding plan step can start from
  // it. window.location (in an effect) instead of useSearchParams keeps the
  // page out of a Suspense boundary; the effect runs before any submit can.
  const [planIntent, setPlanIntent] = useState<PlanIntent | null>(null);
  useEffect(() => {
    setPlanIntent(stashPlanIntentFromSearch(window.location.search));
  }, []);
  // Where a completed auth should land: onboarding, carrying the intent in
  // the URL so it survives contexts where the stash doesn't exist (the
  // confirm-email link opened in another browser/profile).
  const onboardingParams = new URLSearchParams(planIntent ? planIntentSearch(planIntent) : "");
  if (t.locale === "fr-CA") onboardingParams.set("lang", t.locale);
  const onboardingPath = onboardingParams.size
    ? `/onboarding?${onboardingParams}`
    : "/onboarding";

  useEffect(() => {
    document.title = `${t("onboarding.tabSignUp")} · Loonext`;
  }, [t]);

  const schema = useMemo(() => makeSchema(t), [t]);
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", email: "", password: "" },
  });

  async function onSubmit(values: FormValues) {
    setServerError(null);
    trackSignupStarted("email", planIntent);
    const { data, error } = await getSupabaseBrowser().auth.signUp({
      email: values.email,
      password: values.password,
      options: {
        // The DB trigger copies display_name into profiles (SPEC §6).
        data: { display_name: values.name, locale: t.locale },
        // Carries the plan intent through the confirm-email round trip — the
        // onboarding dispatcher re-stashes it from the URL on landing.
        emailRedirectTo: `${window.location.origin}${onboardingPath}`,
        captchaToken: captchaToken ?? undefined,
      },
    });
    if (error) {
      // Captcha tokens are single-use — mint a fresh one before a retry.
      turnstileRef.current?.reset();
      setCaptchaToken(null);
      setServerError(authErrorMessage(error, t));
      return;
    }
    if (data.session) {
      // Email confirmation disabled: straight into onboarding (SPEC §4.1).
      trackSignupCompleted(data.session.user);
      router.replace(onboardingPath);
      router.refresh();
      return;
    }
    // The token was consumed; "Start over" remounts the widget for a new one.
    setCaptchaToken(null);
    setResendAvailableAt(Date.now() + RESEND_COOLDOWN_MS);
    setConfirmationEmail(values.email);
  }

  async function resendConfirmation() {
    if (!confirmationEmail || !canResend) return;
    setResendSending(true);
    setServerError(null);
    setResent(false);
    const token = captchaToken;
    setCaptchaToken(null);
    setResendAvailableAt(Date.now() + RESEND_COOLDOWN_MS);
    try {
      const { error } = await getSupabaseBrowser().auth.resend({
        type: "signup",
        email: confirmationEmail,
        options: {
          emailRedirectTo: `${window.location.origin}${onboardingPath}`,
          captchaToken: token ?? undefined,
        },
      });
      if (error) setServerError(authErrorMessage(error, t));
      else setResent(true);
    } catch {
      setServerError(t("onboarding.confirmationResendFailed"));
    } finally {
      setResendSending(false);
    }
  }

  if (confirmationEmail) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("onboarding.checkYourEmail")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t("onboarding.confirmationSentPrefix")}{" "}
          <span className="font-medium text-foreground">
            {confirmationEmail}
          </span>
          {t("onboarding.confirmationSentSuffix")}
        </p>
        <p className="text-sm text-muted-foreground">{t("onboarding.confirmationCheckSpam")}</p>
        {siteKey && resendAvailableAt === null && (
          <Turnstile siteKey={siteKey} onToken={setCaptchaToken} />
        )}
        <Button
          type="button"
          variant="outline"
          disabled={!canResend}
          onClick={() => void resendConfirmation()}
        >
          {t("onboarding.confirmationResend")}
        </Button>
        {resent && <p role="status" className="text-sm">{t("onboarding.confirmationResent")}</p>}
        {resendAvailableAt !== null && (
          <p className="text-sm text-muted-foreground">{t("onboarding.confirmationWait")}</p>
        )}
        {serverError && <p role="alert" className="text-sm text-destructive">{serverError}</p>}
        <p className="text-sm text-muted-foreground">
          {t("onboarding.wrongAddress")}{" "}
          <button
            type="button"
            disabled={resendSending}
            onClick={() => {
              setConfirmationEmail(null);
              setResendAvailableAt(null);
              setCaptchaToken(null);
              setResent(false);
              setServerError(null);
            }}
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            {t("onboarding.startOver")}
          </button>
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("onboarding.createYourAccount")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t("onboarding.signupSubtitle")}
        </p>
      </div>
      {/* SSO stacked above the email form (§1.7). A first-time OAuth user with
          no company goes through the SAME company-first onboarding as a
          password signup (D18). With a plan intent, `next` sends the callback
          to /onboarding carrying it (the PKCE round trip also keeps the
          sessionStorage stash — belt and suspenders); without one, no `next`
          keeps today's behavior: the callback lands on the default surface and
          CompanyProvider forwards a zero-membership user to /onboarding
          (where the AUP is accepted). */}
      <OAuthButtons
        next={planIntent ? onboardingPath : undefined}
        onStart={(provider) => trackSignupStarted(provider, planIntent)}
      />
      <Form {...form}>
        <form
          // Belt-and-suspenders: `handleSubmit` preventDefaults once hydrated,
          // but method="post" ensures a pre-hydration native submit sends
          // credentials in the request BODY, never the URL query string.
          method="post"
          onSubmit={form.handleSubmit(onSubmit)}
          className="space-y-4"
          noValidate
        >
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("onboarding.yourNameLabel")}</FormLabel>
                <FormControl>
                  <Input
                    autoComplete="name"
                    placeholder={t("onboarding.yourNamePlaceholder")}
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("onboarding.emailLabel")}</FormLabel>
                <FormControl>
                  <Input
                    type="email"
                    autoComplete="email"
                    inputMode="email"
                    placeholder="you@company.com"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("onboarding.passwordLabel")}</FormLabel>
                <FormControl>
                  <PasswordInput
                    autoComplete="new-password"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          {siteKey && (
            <Turnstile
              ref={turnstileRef}
              siteKey={siteKey}
              onToken={setCaptchaToken}
            />
          )}
          {serverError && (
            <p role="alert" className="text-sm text-destructive">
              {serverError}
            </p>
          )}
          <Button
            type="submit"
            className="w-full"
            disabled={
              form.formState.isSubmitting ||
              (siteKey !== undefined && captchaToken === null)
            }
          >
            {form.formState.isSubmitting
              ? t("onboarding.creatingAccount")
              : t("onboarding.createAccountAction")}
          </Button>
        </form>
      </Form>
      <p className="text-center text-sm text-muted-foreground">
        {t("onboarding.alreadyHaveAccount")}{" "}
        <Link
          href="/login"
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          {t("onboarding.logIn")}
        </Link>
      </p>
    </div>
  );
}
