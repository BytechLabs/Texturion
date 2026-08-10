"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMemo, useState } from "react";
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
import { PasswordInput } from "@/components/ui/password-input";
import { useT, type Translate } from "@/i18n/provider";
import { authErrorMessage } from "@/lib/auth/messages";
import { needsReauth, planPasswordSubmit } from "@/lib/auth/reauth";
import { getSupabaseBrowser } from "@/lib/supabase/browser";

/*
 * A factory rather than a module-level constant: both messages below are read
 * under the field by the person filling it in, so they are copy and belong in
 * the catalogue. The type comes from the factory's return, so the form's typing
 * does not depend on which locale built the schema.
 */
function makeSchema(t: Translate) {
  return z
    .object({
      password: z.string().min(8, t("settings.passwordTooShort")),
      confirm: z.string(),
      // Only consulted once a reauth is required (§1.6). Always seeded to "" by
      // the form's defaultValues, so a plain string keeps input/output types
      // aligned for the resolver.
      nonce: z.string(),
    })
    .refine((values) => values.password === values.confirm, {
      path: ["confirm"],
      message: t("settings.passwordMismatch"),
    });
}
type Values = z.infer<ReturnType<typeof makeSchema>>;

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
  const t = useT();
  // Once true, the nonce field is shown and required (stale-session path).
  const [reauthRequested, setReauthRequested] = useState(false);

  const schema = useMemo(() => makeSchema(t), [t]);
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
        message: t("settings.passwordNonceRequired"),
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
          message: t("settings.passwordReauthSent"),
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
    toast.success(
      oauthOnly ? t("settings.passwordSet") : t("settings.passwordUpdated"),
    );
    form.reset({ password: "", confirm: "", nonce: "" });
    setReauthRequested(false);
  }

  const cta = oauthOnly
    ? t("settings.passwordSetAction")
    : t("settings.passwordChangeAction");
  const busyCta = oauthOnly ? t("settings.passwordSetting") : t("common.saving");

  return (
    <SettingsCard
      title={cta}
      description={
        oauthOnly
          ? t("settings.passwordSetDescription")
          : t("settings.passwordChangeDescription")
      }
    >
      <Form {...form}>
        <form
          // method="post" so a pre-hydration native submit sends the passwords
          // in the body, never the URL (handleSubmit preventDefaults once live).
          method="post"
          onSubmit={form.handleSubmit(onSubmit)}
          className="space-y-4"
          noValidate
        >
          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("settings.passwordNewLabel")}</FormLabel>
                <FormControl>
                  <PasswordInput autoComplete="new-password" {...field} />
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
                <FormLabel>{t("settings.passwordConfirmLabel")}</FormLabel>
                <FormControl>
                  <PasswordInput autoComplete="new-password" {...field} />
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
                  <FormLabel>{t("settings.passwordCodeLabel")}</FormLabel>
                  <FormControl>
                    <Input
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      placeholder="123456"
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    {t("settings.passwordCodeHelp")}
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
