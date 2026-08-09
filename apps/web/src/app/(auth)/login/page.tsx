"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import {
  LastUsedBadge,
  useLastUsedMethod,
} from "@/components/auth/last-used-badge";
import { MfaChallenge } from "@/components/auth/mfa-challenge";
import { OAuthButtons } from "@/components/auth/oauth-buttons";
import { rememberSignInMethod } from "@/lib/auth/last-used";
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
import { authErrorMessage } from "@/lib/auth/messages";
import { needsStepUp } from "@/lib/auth/mfa-step-up";
import { safeNextPath } from "@/lib/auth/redirects";
import { getSupabaseBrowser } from "@/lib/supabase/browser";
import { endSessionOnThisDevice } from "@/lib/auth/end-session";

const schema = z.object({
  email: z.email("Enter your email address."),
  password: z.string().min(1, "Enter your password."),
});

type FormValues = z.infer<typeof schema>;

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [serverError, setServerError] = useState<string | null>(null);
  // #496: the password was right and the account has a factor, so the screen
  // becomes the code entry rather than navigating.
  const [challenge, setChallenge] = useState(false);

  // Supabase's captcha setting gates signInWithPassword too, so login carries
  // the same optional Turnstile token as signup (SPEC §10 front door).
  const siteKey = publicEnv.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const turnstileRef = useRef<TurnstileHandle>(null);

  // Surface a failed OAuth sign-in (the /auth/callback route redirects here with
  // ?error=oauth) as a calm inline message instead of a blank login page.
  useEffect(() => {
    if (searchParams.get("error") === "oauth") {
      setServerError(
        "We couldn't finish signing you in with that provider. Try again, or use your email and password below.",
      );
    }
  }, [searchParams]);

  const lastUsed = useLastUsedMethod();
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", password: "" },
  });

  function landAfterSignIn() {
    // Remembered only on success, so the hint always names something that
    // actually worked on this device.
    rememberSignInMethod("password");
    router.replace(safeNextPath(searchParams.get("next")));
    router.refresh();
  }

  async function onSubmit(values: FormValues) {
    setServerError(null);
    const supabase = getSupabaseBrowser();
    const { error } = await supabase.auth.signInWithPassword({
      email: values.email,
      password: values.password,
      options: { captchaToken: captchaToken ?? undefined },
    });
    if (error) {
      // Captcha tokens are single-use — mint a fresh one before a retry.
      turnstileRef.current?.reset();
      setCaptchaToken(null);
      setServerError(authErrorMessage(error));
      return;
    }

    // #496 — "I am able to login without any 2fa codes even though 2fa is
    // enabled." This is where that was true. `signInWithPassword` succeeds at
    // `aal1` for an enrolled account too; GoTrue leaves demanding the factor to
    // us, and nothing here demanded it. `nextLevel` is GoTrue's own answer to
    // "should this session be aal2?", so it is read rather than re-derived.
    //
    // Failing OPEN on an error here is deliberate and safe: the API refuses
    // every company-scoped route for an aal1 session that holds a factor, so
    // the worst case is the gate inside the shell asking instead of this
    // screen. Failing closed would strand somebody on the login page over a
    // network blip.
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (needsStepUp(aal)) {
      setChallenge(true);
      return;
    }
    landAfterSignIn();
  }

  if (challenge) {
    return (
      <MfaChallenge
        onVerified={landAfterSignIn}
        footer={
          <button
            type="button"
            className="text-muted-foreground underline-offset-4 hover:underline"
            onClick={() => {
              // Revokes too: a stale session abandoned on the login screen is
              // exactly the one nobody comes back to clean up.
              void endSessionOnThisDevice(null);
              setChallenge(false);
            }}
          >
            Use a different account
          </button>
        }
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Log in</h1>
        <p className="text-sm text-muted-foreground">
          Your team&apos;s texts are waiting.
        </p>
      </div>
      {/* SSO stacked above the email form (§1.7): the petrol "Log in" button
          below stays the one accent element on the screen. `next` carries the
          protected path a signed-out visitor was bounced from. */}
      <OAuthButtons next={searchParams.get("next")} />
      <Form {...form}>
        <form
          // method="post" so a pre-hydration native submit sends credentials
          // in the body, never the URL (handleSubmit preventDefaults once live).
          method="post"
          onSubmit={form.handleSubmit(onSubmit)}
          className="space-y-4"
          noValidate
        >
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Email</FormLabel>
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
                <div className="flex items-center justify-between">
                  <FormLabel>Password</FormLabel>
                  <Link
                    href="/reset-password"
                    className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                  >
                    Forgot your password?
                  </Link>
                </div>
                <FormControl>
                  <PasswordInput
                    autoComplete="current-password"
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
            {form.formState.isSubmitting ? "Logging in…" : "Log in"}
            {lastUsed === "password" && <LastUsedBadge className="ml-auto" />}
          </Button>
        </form>
      </Form>
      <p className="text-center text-sm text-muted-foreground">
        New to Loonext?{" "}
        <Link
          href="/signup"
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          Create an account
        </Link>
      </p>
    </div>
  );
}

export default function LoginPage() {
  // useSearchParams requires a Suspense boundary at build time.
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
