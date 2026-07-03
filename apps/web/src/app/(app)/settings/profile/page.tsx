"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { Monitor, Moon, Sun } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { SettingsCard, SettingsPage } from "@/components/settings/section";
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
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { keys } from "@/lib/api/keys";
import { useActiveCompany } from "@/lib/company/provider";
import { getSupabaseBrowser } from "@/lib/supabase/browser";

// display_name is synced to public.profiles (display_name text). Keep it 1–120
// after trim — matches the profiles column and the shell's expectations.
const profileSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Enter your display name.")
    .max(120, "Keep it under 120 characters."),
});
type ProfileValues = z.infer<typeof profileSchema>;

/**
 * /settings/profile (G8): display name (Supabase auth metadata — the DB
 * trigger syncs public.profiles), theme (System/Light/Dark, G2), sign out.
 */
export default function ProfileSettingsPage() {
  const { displayName } = useActiveCompany();
  const queryClient = useQueryClient();
  const router = useRouter();
  const { theme, setTheme } = useTheme();

  const form = useForm<ProfileValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: { name: displayName },
  });
  const [email, setEmail] = useState<string | null>(null);
  // next-themes resolves after mount — render the control only when we know
  // the real value (avoids a hydration flicker on the radio group).
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    let cancelled = false;
    void getSupabaseBrowser()
      .auth.getUser()
      .then(({ data }) => {
        if (!cancelled) setEmail(data.user?.email ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Re-seed if the display name changes elsewhere (e.g. another tab).
  useEffect(() => {
    form.reset({ name: displayName });
  }, [displayName, form]);

  const dirty = form.watch("name").trim() !== displayName;
  const saving = form.formState.isSubmitting;

  async function onSubmit(values: ProfileValues) {
    if (!dirty) return;
    const { error: authError } = await getSupabaseBrowser().auth.updateUser({
      data: { display_name: values.name },
    });
    if (authError) {
      form.setError("root", { message: "Couldn't save your name. Try again." });
      return;
    }
    // The auth trigger syncs public.profiles; refresh /v1/me for the shell.
    await queryClient.invalidateQueries({ queryKey: keys.me });
    toast.success("Name saved.");
  }

  async function signOut() {
    await getSupabaseBrowser().auth.signOut();
    queryClient.clear();
    router.push("/login");
  }

  return (
    <SettingsPage title="Profile" description="You, across this workspace.">
      <div className="space-y-6">
        <SettingsCard
          title="Display name"
          description="How teammates see you on assignments and notes."
        >
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(onSubmit)}
              className="flex flex-col gap-2 sm:flex-row sm:items-start"
              noValidate
            >
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem className="flex-1">
                    <FormLabel className="sr-only">Display name</FormLabel>
                    <FormControl>
                      <Input maxLength={120} autoComplete="name" {...field} />
                    </FormControl>
                    {email && (
                      <FormDescription>Signed in as {email}</FormDescription>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button
                type="submit"
                disabled={!dirty || saving}
                className="sm:self-start"
              >
                {saving ? "Saving…" : "Save"}
              </Button>
            </form>
          </Form>
          {form.formState.errors.root && (
            <p role="alert" className="mt-2 text-sm text-destructive">
              {form.formState.errors.root.message}
            </p>
          )}
        </SettingsCard>

        <SettingsCard title="Theme">
          {mounted ? (
            <RadioGroup
              value={theme ?? "system"}
              onValueChange={setTheme}
              className="gap-3"
              aria-label="Theme"
            >
              {(
                [
                  { value: "system", label: "System", icon: Monitor },
                  { value: "light", label: "Light", icon: Sun },
                  { value: "dark", label: "Dark", icon: Moon },
                ] as const
              ).map(({ value, label, icon: Icon }) => (
                <div key={value} className="flex items-center gap-2">
                  <RadioGroupItem value={value} id={`theme-${value}`} />
                  <Label
                    htmlFor={`theme-${value}`}
                    className="flex cursor-pointer items-center gap-1.5 text-sm font-normal"
                  >
                    <Icon
                      className="size-4 text-muted-foreground"
                      strokeWidth={1.75}
                      aria-hidden
                    />
                    {label}
                  </Label>
                </div>
              ))}
            </RadioGroup>
          ) : (
            <p className="text-sm text-muted-foreground">Loading theme…</p>
          )}
        </SettingsCard>

        <SettingsCard title="Sign out">
          <Button variant="outline" onClick={() => void signOut()}>
            Sign out
          </Button>
        </SettingsCard>
      </div>
    </SettingsPage>
  );
}
