"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { PasswordInput } from "@/components/ui/password-input";
import { Skeleton } from "@/components/ui/skeleton";
import { useT, type Translate } from "@/i18n/provider";
import { authErrorMessage } from "@/lib/auth/messages";
import { getSupabaseBrowser } from "@/lib/supabase/browser";

/*
 * A factory rather than a module-level constant: every message below is read
 * UNDER the field by the person filling it in, so it is copy and belongs in the
 * catalogue. The type comes from the factory's return, so the form's typing does
 * not depend on which locale built the schema.
 */
function makeSchema(t: Translate) {
  return z
    .object({
      password: z.string().min(8, t("onboarding.passwordTooShort")),
      confirm: z.string(),
    })
    .refine((values) => values.password === values.confirm, {
      path: ["confirm"],
      message: t("onboarding.passwordMismatch"),
    });
}

type FormValues = z.infer<ReturnType<typeof makeSchema>>;

type SessionState = "checking" | "ready" | "missing";

/**
 * Recovery-link landing (/reset-password → email → here). The Supabase
 * client consumes the link's tokens on load, so the session may arrive a
 * beat after mount — wait for it before declaring the link dead.
 */
export default function UpdatePasswordPage() {
  const t = useT();
  const router = useRouter();
  const [sessionState, setSessionState] = useState<SessionState>("checking");
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = getSupabaseBrowser();
    let cancelled = false;

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!cancelled && session) setSessionState("ready");
    });

    void supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      if (data.session) {
        setSessionState("ready");
        return;
      }
      // Give detectSessionInUrl a moment to exchange the link's tokens.
      setTimeout(() => {
        if (!cancelled) {
          setSessionState((state) => (state === "checking" ? "missing" : state));
        }
      }, 2500);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  const schema = useMemo(() => makeSchema(t), [t]);
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { password: "", confirm: "" },
  });

  async function onSubmit(values: FormValues) {
    setServerError(null);
    const { error } = await getSupabaseBrowser().auth.updateUser({
      password: values.password,
    });
    if (error) {
      setServerError(authErrorMessage(error));
      return;
    }
    toast(t("onboarding.passwordUpdated"));
    router.replace("/for-you");
    router.refresh();
  }

  if (sessionState === "checking") {
    return (
      <div className="space-y-3">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-full" />
        <p className="text-sm text-muted-foreground">
          {t("onboarding.checkingLink")}
        </p>
      </div>
    );
  }

  if (sessionState === "missing") {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("onboarding.linkExpiredTitle")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t("onboarding.linkExpiredBody")}
        </p>
        <Button asChild className="w-full">
          <Link href="/reset-password">
            {t("onboarding.requestNewLink")}
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("onboarding.setNewPasswordTitle")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t("onboarding.setNewPasswordSubtitle")}
        </p>
      </div>
      <Form {...form}>
        <form
          // method="post" so a pre-hydration native submit sends the new
          // password in the body, never the URL (handleSubmit preventDefaults).
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
                <FormLabel>{t("onboarding.newPasswordLabel")}</FormLabel>
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
          <FormField
            control={form.control}
            name="confirm"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("onboarding.confirmPasswordLabel")}</FormLabel>
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
          {serverError && (
            <p role="alert" className="text-sm text-destructive">
              {serverError}
            </p>
          )}
          <Button
            type="submit"
            className="w-full"
            disabled={form.formState.isSubmitting}
          >
            {form.formState.isSubmitting
              ? t("common.saving")
              : t("onboarding.savePassword")}
          </Button>
        </form>
      </Form>
    </div>
  );
}
