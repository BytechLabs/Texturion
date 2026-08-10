"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
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
import { useT, type Translate } from "@/i18n/provider";
import { authErrorMessage } from "@/lib/auth/messages";
import { isApplePrivateRelay } from "@/lib/auth/identities";
import { isEmailChanged } from "@/lib/auth/reauth";
import { getSupabaseBrowser } from "@/lib/supabase/browser";

/*
 * A factory rather than a module-level constant, because the validation message
 * is copy: the reader sees it under the field, so it belongs in the catalogue
 * like every other sentence. The type comes from the factory's return, so
 * nothing about the form's typing depends on which locale built it.
 */
function makeSchema(t: Translate) {
  return z.object({
    email: z.email(t("settings.emailInvalid")),
  });
}
type Values = z.infer<ReturnType<typeof makeSchema>>;

/**
 * Change email (D18 / APP-FEATURES-V2 §1.5). supabase.auth.updateUser({ email })
 * with Supabase "Secure email change" ON — confirmation goes to BOTH the old
 * and new address; the change commits only when both are confirmed. Plain-
 * language, one action.
 *
 * Apple private-relay accounts (§1.8): the email is shown READ-ONLY with a note
 * that delivery routes through Apple — no inline edit, since the account may
 * have no reachable real inbox (the reliable path for those users is "Set a
 * password" in the card below).
 */
export function ChangeEmailCard({ email }: { email: string | null }) {
  const t = useT();
  const relay = isApplePrivateRelay(email);
  const [sent, setSent] = useState(false);

  const schema = useMemo(() => makeSchema(t), [t]);
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { email: "" },
  });

  // Reset the "check both inboxes" confirmation when the user edits again.
  const watched = form.watch("email");
  useEffect(() => {
    if (sent) setSent(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watched]);

  async function onSubmit(values: Values) {
    if (!isEmailChanged(email, values.email)) {
      form.setError("email", { message: t("settings.emailAlreadyYours") });
      return;
    }
    const { error } = await getSupabaseBrowser().auth.updateUser({
      email: values.email.trim(),
    });
    if (error) {
      form.setError("email", { message: authErrorMessage(error) });
      return;
    }
    setSent(true);
  }

  if (relay) {
    return (
      <SettingsCard
        title={t("settings.emailCardTitle")}
        description={t("settings.emailCardDescription")}
      >
        <p className="text-sm">
          <span className="font-medium">{email}</span>
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("settings.emailRelayNote")}
        </p>
      </SettingsCard>
    );
  }

  return (
    <SettingsCard
      title={t("settings.emailCardTitle")}
      description={
        email
          ? t("settings.emailSignedInAs", { email })
          : t("settings.emailAddOne")
      }
    >
      {sent ? (
        <div className="space-y-2" role="status" aria-live="polite">
          <p className="text-sm">{t("settings.emailChangeSent")}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setSent(false);
              form.reset({ email: "" });
            }}
          >
            {t("settings.emailChangeAnother")}
          </Button>
        </div>
      ) : (
        <Form {...form}>
          <form
            // method="post" so a pre-hydration native submit stays out of the
            // URL (handleSubmit preventDefaults once hydrated).
            method="post"
            onSubmit={form.handleSubmit(onSubmit)}
            className="flex flex-col gap-2 sm:flex-row sm:items-start"
            noValidate
          >
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem className="flex-1">
                  <FormLabel className="sr-only">
                    {t("settings.emailNewLabel")}
                  </FormLabel>
                  <FormControl>
                    <Input
                      type="email"
                      autoComplete="email"
                      inputMode="email"
                      placeholder="you@company.com"
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    {t("settings.emailConfirmBoth")}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button
              type="submit"
              disabled={form.formState.isSubmitting}
              className="sm:self-start"
            >
              {form.formState.isSubmitting
                ? t("settings.emailSending")
                : t("settings.emailChangeAction")}
            </Button>
          </form>
        </Form>
      )}
    </SettingsCard>
  );
}
