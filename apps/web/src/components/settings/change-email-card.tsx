"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useState } from "react";
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
import { authErrorMessage } from "@/lib/auth/messages";
import { isApplePrivateRelay } from "@/lib/auth/identities";
import { isEmailChanged } from "@/lib/auth/reauth";
import { getSupabaseBrowser } from "@/lib/supabase/browser";

const schema = z.object({
  email: z.email("Enter a valid email address."),
});
type Values = z.infer<typeof schema>;

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
  const relay = isApplePrivateRelay(email);
  const [sent, setSent] = useState(false);

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
      form.setError("email", { message: "That's already your email address." });
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
        title="Email"
        description="The address we use to reach you."
      >
        <p className="text-sm">
          <span className="font-medium">{email}</span>
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Email is routed through Apple. To sign in on another device, set a
          password below.
        </p>
      </SettingsCard>
    );
  }

  return (
    <SettingsCard
      title="Email"
      description={
        email ? `You're signed in as ${email}.` : "Add an email to your account."
      }
    >
      {sent ? (
        <div className="space-y-2">
          <p className="text-sm">
            We&apos;ve emailed both your old and new address. Confirm from each
            to finish the change.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setSent(false);
              form.reset({ email: "" });
            }}
          >
            Change a different address
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
                  <FormLabel className="sr-only">New email</FormLabel>
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
                    We&apos;ll ask you to confirm from both your old and new
                    inbox.
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
              {form.formState.isSubmitting ? "Sending…" : "Change email"}
            </Button>
          </form>
        </Form>
      )}
    </SettingsCard>
  );
}
