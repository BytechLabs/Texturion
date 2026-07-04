"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { OAuthButtons } from "@/components/auth/oauth-buttons";
import { Turnstile, type TurnstileHandle } from "@/components/auth/turnstile";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { getSupabaseBrowser } from "@/lib/supabase/browser";

const schema = z.object({
  name: z.string().trim().min(1, "Enter your name."),
  email: z.email("Enter your email address."),
  password: z.string().min(8, "Use at least 8 characters."),
  // SPEC §4.1 step 1: the signup screen requires AUP acceptance.
  aup: z.literal(true, {
    error: "You need to agree before signing up.",
  }),
});

type FormValues = z.infer<typeof schema>;

export default function SignupPage() {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [confirmationEmail, setConfirmationEmail] = useState<string | null>(
    null,
  );

  // Optional Turnstile gate (SPEC §10 front door). When the site key is
  // configured, Supabase Auth verifies the token server-side, so submit stays
  // blocked until the widget hands one over; when it isn't, signup behaves
  // exactly as before.
  const siteKey = publicEnv.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const turnstileRef = useRef<TurnstileHandle>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", email: "", password: "" },
  });

  async function onSubmit(values: FormValues) {
    setServerError(null);
    const { data, error } = await getSupabaseBrowser().auth.signUp({
      email: values.email,
      password: values.password,
      options: {
        // The DB trigger copies display_name into profiles (SPEC §6).
        data: { display_name: values.name },
        emailRedirectTo: `${window.location.origin}/onboarding`,
        captchaToken: captchaToken ?? undefined,
      },
    });
    if (error) {
      // Captcha tokens are single-use — mint a fresh one before a retry.
      turnstileRef.current?.reset();
      setCaptchaToken(null);
      setServerError(authErrorMessage(error));
      return;
    }
    if (data.session) {
      // Email confirmation disabled: straight into onboarding (SPEC §4.1).
      router.replace("/onboarding");
      router.refresh();
      return;
    }
    // The token was consumed; "Start over" remounts the widget for a new one.
    setCaptchaToken(null);
    setConfirmationEmail(values.email);
  }

  if (confirmationEmail) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">
          Check your email
        </h1>
        <p className="text-sm text-muted-foreground">
          We sent a confirmation link to{" "}
          <span className="font-medium text-foreground">
            {confirmationEmail}
          </span>
          . Open it to finish creating your account.
        </p>
        <p className="text-sm text-muted-foreground">
          Wrong address?{" "}
          <button
            type="button"
            onClick={() => setConfirmationEmail(null)}
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            Start over
          </button>
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Create your account
        </h1>
        <p className="text-sm text-muted-foreground">
          A business number for your whole crew — set up in minutes.
        </p>
      </div>
      {/* SSO stacked above the email form (§1.7). A first-time OAuth user with
          no company goes through the SAME company-first onboarding as a
          password signup (D18) — no `next` here means the callback lands on
          /inbox, and CompanyProvider forwards a zero-membership user to
          /onboarding (where the AUP is accepted). */}
      <OAuthButtons />
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
                <FormLabel>Your name</FormLabel>
                <FormControl>
                  <Input autoComplete="name" placeholder="Sam Rivera" {...field} />
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
                <FormLabel>Password</FormLabel>
                <FormControl>
                  <Input
                    type="password"
                    autoComplete="new-password"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="aup"
            render={({ field }) => (
              <FormItem>
                <div className="flex items-start gap-2">
                  <FormControl>
                    <Checkbox
                      checked={field.value === true}
                      onCheckedChange={(checked) =>
                        field.onChange(checked === true)
                      }
                      className="mt-0.5"
                    />
                  </FormControl>
                  <FormLabel className="text-sm font-normal leading-snug text-muted-foreground">
                    I&apos;ll only text customers who asked to hear from us —
                    no spam, no purchased lists.
                  </FormLabel>
                </div>
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
              ? "Creating your account…"
              : "Create account"}
          </Button>
        </form>
      </Form>
      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link
          href="/login"
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          Log in
        </Link>
      </p>
    </div>
  );
}
