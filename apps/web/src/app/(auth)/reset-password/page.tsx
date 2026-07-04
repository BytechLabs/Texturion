"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

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
import { getSupabaseBrowser } from "@/lib/supabase/browser";

const schema = z.object({
  email: z.email("Enter your email address."),
});

type FormValues = z.infer<typeof schema>;

export default function ResetPasswordPage() {
  const [serverError, setServerError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  // Supabase's captcha setting gates resetPasswordForEmail too, so this form
  // carries the same optional Turnstile token as signup (SPEC §10 front door).
  const siteKey = publicEnv.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const turnstileRef = useRef<TurnstileHandle>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: "" },
  });

  async function onSubmit(values: FormValues) {
    setServerError(null);
    const { error } = await getSupabaseBrowser().auth.resetPasswordForEmail(
      values.email,
      {
        redirectTo: `${window.location.origin}/update-password`,
        captchaToken: captchaToken ?? undefined,
      },
    );
    if (error) {
      // Captcha tokens are single-use — mint a fresh one before a retry.
      turnstileRef.current?.reset();
      setCaptchaToken(null);
      setServerError(authErrorMessage(error));
      return;
    }
    setSentTo(values.email);
  }

  if (sentTo) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">
          Check your email
        </h1>
        <p className="text-sm text-muted-foreground">
          If an account exists for{" "}
          <span className="font-medium text-foreground">{sentTo}</span>, we
          sent it a link to set a new password.
        </p>
        <Button asChild variant="outline" className="w-full">
          <Link href="/login">Back to log in</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Reset your password
        </h1>
        <p className="text-sm text-muted-foreground">
          Enter your email and we&apos;ll send you a link to set a new one.
        </p>
      </div>
      <Form {...form}>
        <form
          // method="post" so a pre-hydration native submit sends the email in
          // the body, never the URL (handleSubmit preventDefaults once live).
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
            {form.formState.isSubmitting ? "Sending…" : "Send reset link"}
          </Button>
        </form>
      </Form>
      <p className="text-center text-sm text-muted-foreground">
        Remembered it?{" "}
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
