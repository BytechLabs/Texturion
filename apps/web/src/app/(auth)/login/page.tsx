"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
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
import { publicEnv } from "@/env";
import { authErrorMessage } from "@/lib/auth/messages";
import { safeNextPath } from "@/lib/auth/redirects";
import { getSupabaseBrowser } from "@/lib/supabase/browser";

const schema = z.object({
  email: z.email("Enter your email address."),
  password: z.string().min(1, "Enter your password."),
});

type FormValues = z.infer<typeof schema>;

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [serverError, setServerError] = useState<string | null>(null);

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

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", password: "" },
  });

  async function onSubmit(values: FormValues) {
    setServerError(null);
    const { error } = await getSupabaseBrowser().auth.signInWithPassword({
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
    router.replace(safeNextPath(searchParams.get("next")));
    router.refresh();
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
                  <Input
                    type="password"
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
          </Button>
        </form>
      </Form>
      <p className="text-center text-sm text-muted-foreground">
        New to JobText?{" "}
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
