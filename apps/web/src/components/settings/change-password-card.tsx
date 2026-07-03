"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { SettingsCard } from "@/components/settings/section";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { authErrorMessage } from "@/lib/auth/messages";
import { needsReauth, planPasswordSubmit } from "@/lib/auth/reauth";
import { getSupabaseBrowser } from "@/lib/supabase/browser";

const schema = z
  .object({
    password: z.string().min(8, "Use at least 8 characters."),
    confirm: z.string(),
    // Only consulted once a reauth is required (§1.6). Always seeded to "" by
    // the form's defaultValues, so a plain string keeps input/output types
    // aligned for the resolver.
    nonce: z.string(),
  })
  .refine((values) => values.password === values.confirm, {
    path: ["confirm"],
    message: "The passwords don't match.",
  });
type Values = z.infer<typeof schema>;

/**
 * Change / set password (D18 / APP-FEATURES-V2 §1.6, §1.8).
 *
 * - OAuth-only account (`oauthOnly`): "Set a password" — the same
 *   updateUser({ password }) call, turning an SSO account into a dual-login
 *   account so the user can sign in on any device. No reauth nonce on a fresh
 *   session.
 * - Account with a password: "Change password". Supabase "Secure password
 *   change" is ON — reauth is required only when the session is older than 24h.
 *   We attempt the direct update; if Supabase asks for reauth, we call
 *   reauthenticate() (emails a 6-digit nonce), reveal the nonce field, and
 *   re-submit updateUser({ password, nonce }).
 *
 * Supabase's leaked-password + min-strength checks (D8 posture) surface inline.
 */
export function ChangePasswordCard({ oauthOnly }: { oauthOnly: boolean }) {
  // Once true, the nonce field is shown and required (stale-session path).
  const [reauthRequested, setReauthRequested] = useState(false);

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { password: "", confirm: "", nonce: "" },
  });

  async function onSubmit(values: Values) {
    const supabase = getSupabaseBrowser();
    const plan = planPasswordSubmit({
      reauthRequested,
      nonce: values.nonce,
    });
    if (!plan) {
      form.setError("nonce", {
        message: "Enter the 6-digit code from your email.",
      });
      return;
    }

    if (plan.kind === "update") {
      const { error } = await supabase.auth.updateUser({
        password: values.password,
      });
      if (!error) {
        finishSuccess();
        return;
      }
      if (needsReauth(error)) {
        // Stale session (>24h): trigger the nonce email, reveal the field.
        const { error: reauthError } = await supabase.auth.reauthenticate();
        if (reauthError) {
          form.setError("root", { message: authErrorMessage(reauthError) });
          return;
        }
        setReauthRequested(true);
        form.setError("root", {
          message:
            "For your security, enter the 6-digit code we just emailed you.",
        });
        return;
      }
      form.setError("password", { message: authErrorMessage(error) });
      return;
    }

    // reauth_then_update: session is stale and the user supplied the nonce.
    const { error } = await supabase.auth.updateUser({
      password: values.password,
      nonce: plan.nonce,
    });
    if (error) {
      form.setError("nonce", { message: authErrorMessage(error) });
      return;
    }
    finishSuccess();
  }

  function finishSuccess() {
    toast.success(oauthOnly ? "Password set." : "Password updated.");
    form.reset({ password: "", confirm: "", nonce: "" });
    setReauthRequested(false);
  }

  const cta = oauthOnly ? "Set a password" : "Change password";
  const busyCta = oauthOnly ? "Setting…" : "Saving…";

  return (
    <SettingsCard
      title={oauthOnly ? "Set a password" : "Change password"}
      description={
        oauthOnly
          ? "Add a password so you can sign in on any device, not just with Google or Apple."
          : "Pick a new password. We may ask you to confirm it's you."
      }
    >
      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className="space-y-4"
          noValidate
        >
          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem>
                <FormLabel>New password</FormLabel>
                <FormControl>
                  <Input type="password" autoComplete="new-password" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="confirm"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Confirm password</FormLabel>
                <FormControl>
                  <Input type="password" autoComplete="new-password" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          {reauthRequested && (
            <FormField
              control={form.control}
              name="nonce"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Confirmation code</FormLabel>
                  <FormControl>
                    <Input
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      placeholder="123456"
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    Enter the 6-digit code we emailed you.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}
          {form.formState.errors.root && (
            <p role="alert" className="text-sm text-destructive">
              {form.formState.errors.root.message}
            </p>
          )}
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? busyCta : cta}
          </Button>
        </form>
      </Form>
    </SettingsCard>
  );
}
