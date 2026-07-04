"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
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
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { authErrorMessage } from "@/lib/auth/messages";
import { getSupabaseBrowser } from "@/lib/supabase/browser";

const schema = z
  .object({
    password: z.string().min(8, "Use at least 8 characters."),
    confirm: z.string(),
  })
  .refine((values) => values.password === values.confirm, {
    path: ["confirm"],
    message: "The passwords don't match.",
  });

type FormValues = z.infer<typeof schema>;

type SessionState = "checking" | "ready" | "missing";

/**
 * Recovery-link landing (/reset-password → email → here). The Supabase
 * client consumes the link's tokens on load, so the session may arrive a
 * beat after mount — wait for it before declaring the link dead.
 */
export default function UpdatePasswordPage() {
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
    toast("Password updated.");
    router.replace("/for-you");
    router.refresh();
  }

  if (sessionState === "checking") {
    return (
      <div className="space-y-3">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-full" />
        <p className="text-sm text-muted-foreground">Checking your link…</p>
      </div>
    );
  }

  if (sessionState === "missing") {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">
          This link has expired
        </h1>
        <p className="text-sm text-muted-foreground">
          Password links only work once and expire after a while. Request a
          new one and try again.
        </p>
        <Button asChild className="w-full">
          <Link href="/reset-password">Request a new link</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Set a new password
        </h1>
        <p className="text-sm text-muted-foreground">
          You&apos;ll stay logged in on this device.
        </p>
      </div>
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
            name="confirm"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Confirm password</FormLabel>
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
            {form.formState.isSubmitting ? "Saving…" : "Save password"}
          </Button>
        </form>
      </Form>
    </div>
  );
}
