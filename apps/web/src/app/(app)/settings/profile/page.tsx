"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { Monitor, Moon, Sun } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { CalendarSection } from "@/components/settings/calendar-section";
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
import { Switch } from "@/components/ui/switch";
import { useSingleKeyShortcuts } from "@/lib/inbox/shortcut-preference";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useT, type Translate } from "@/i18n/provider";
import { keys } from "@/lib/api/keys";
import { useActiveCompany } from "@/lib/company/provider";
import { endSessionOnThisDevice } from "@/lib/auth/end-session";
import { getSupabaseBrowser } from "@/lib/supabase/browser";

/*
 * display_name is synced to public.profiles (display_name text). Keep it 1–120
 * after trim — matches the profiles column and the shell's expectations.
 *
 * A factory rather than a module-level constant, because both messages appear
 * under the field for the reader — a validation message is copy wherever it
 * happens to be declared.
 */
const NAME_MAX = 120;

function makeProfileSchema(t: Translate) {
  return z.object({
    name: z
      .string()
      .trim()
      .min(1, t("appShell.profileNameRequired"))
      .max(
        NAME_MAX,
        t("appShell.profileNameTooLong", { max: NAME_MAX.toLocaleString(t.locale) }),
      ),
  });
}
type ProfileValues = z.infer<ReturnType<typeof makeProfileSchema>>;

/**
 * /settings/profile (G8): display name (Supabase auth metadata — the DB
 * trigger syncs public.profiles), theme (System/Light/Dark, G2), sign out.
 */
export default function ProfileSettingsPage() {
  const t = useT();
  const [singleKey, setSingleKey] = useSingleKeyShortcuts();
  const { displayName, companyId } = useActiveCompany();
  const queryClient = useQueryClient();
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const [signingOut, setSigningOut] = useState(false);

  const schema = useMemo(() => makeProfileSchema(t), [t]);
  const form = useForm<ProfileValues>({
    resolver: zodResolver(schema),
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
      form.setError("root", { message: t("appShell.profileNameSaveFailed") });
      return;
    }
    // The auth trigger syncs public.profiles; refresh /v1/me for the shell.
    await queryClient.invalidateQueries({ queryKey: keys.me });
    toast.success(t("appShell.profileNameSaved"));
  }

  async function signOut() {
    setSigningOut(true);
    // Hand this browser's push subscription back FIRST (#264) — while the
    // session that owns it still exists.
    await endSessionOnThisDevice(companyId);
    queryClient.clear();
    router.push("/login");
  }

  return (
    <SettingsPage
      title={t("appShell.profileTitle")}
      description={t("appShell.profileDescription")}
    >
      <div className="space-y-6">
        <SettingsCard id="display-name"
          title={t("appShell.profileDisplayName")}
          description={t("appShell.profileDisplayNameDescription")}
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
                    <FormLabel className="sr-only">
                      {t("appShell.profileDisplayName")}
                    </FormLabel>
                    <FormControl>
                      <Input maxLength={120} autoComplete="name" {...field} />
                    </FormControl>
                    {email && (
                      <FormDescription>
                        {t("appShell.profileSignedInAs", { email })}
                      </FormDescription>
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
                {saving ? t("common.saving") : t("common.save")}
              </Button>
            </form>
          </Form>
          {form.formState.errors.root && (
            <p role="alert" className="mt-2 text-sm text-destructive">
              {form.formState.errors.root.message}
            </p>
          )}
        </SettingsCard>

        {/* #245: a personal subscription, so it sits with the other things
            that belong to the person rather than the workspace. */}
        <CalendarSection />

        <SettingsCard id="theme" title={t("appShell.profileTheme")}>
          {mounted ? (
            <SegmentedControl
              value={(theme ?? "system") as "system" | "light" | "dark"}
              onChange={setTheme}
              ariaLabel={t("appShell.profileTheme")}
              className="w-fit"
              options={[
                {
                  value: "system",
                  label: t("appShell.profileThemeSystem"),
                  icon: <Monitor className="size-4" strokeWidth={1.75} aria-hidden />,
                },
                {
                  value: "light",
                  label: t("appShell.profileThemeLight"),
                  icon: <Sun className="size-4" strokeWidth={1.75} aria-hidden />,
                },
                {
                  value: "dark",
                  label: t("appShell.profileThemeDark"),
                  icon: <Moon className="size-4" strokeWidth={1.75} aria-hidden />,
                },
              ]}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              {t("appShell.profileThemeLoading")}
            </p>
          )}
        </SettingsCard>

        {/* #694: WCAG 2.1.4, single-key shortcuts can be turned off. */}
        <SettingsCard id="shortcuts"
          title={t("appShell.profileShortcuts")}
          description={t("appShell.profileShortcutsDescription")}
        >
          <div className="flex items-start gap-3">
            <Switch
              id="single-key-shortcuts"
              checked={singleKey}
              onCheckedChange={setSingleKey}
            />
            <div className="space-y-1">
              <Label htmlFor="single-key-shortcuts" className="text-sm font-medium">
                {t("appShell.profileSingleKey")}
              </Label>
              <p className="text-sm text-muted-foreground">
                {t("appShell.profileSingleKeyHelp")}
              </p>
            </div>
          </div>
        </SettingsCard>

        <SettingsCard id="sign-out" title={t("appShell.profileSignOut")}>
          <Button
            variant="outline"
            onClick={() => void signOut()}
            disabled={signingOut}
          >
            {signingOut
              ? t("appShell.profileSigningOut")
              : t("appShell.profileSignOut")}
          </Button>
        </SettingsCard>
      </div>
    </SettingsPage>
  );
}
