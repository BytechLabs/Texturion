"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Monitor, Moon, Sun } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { SettingsCard, SettingsPage } from "@/components/settings/section";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { keys } from "@/lib/api/keys";
import { useActiveCompany } from "@/lib/company/provider";
import { getSupabaseBrowser } from "@/lib/supabase/browser";

/**
 * /settings/profile (G8): display name (Supabase auth metadata — the DB
 * trigger syncs public.profiles), theme (System/Light/Dark, G2), sign out.
 */
export default function ProfileSettingsPage() {
  const { displayName } = useActiveCompany();
  const queryClient = useQueryClient();
  const router = useRouter();
  const { theme, setTheme } = useTheme();

  const [name, setName] = useState(displayName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  const trimmed = name.trim();
  const dirty = trimmed !== displayName;

  async function saveName(event: React.FormEvent) {
    event.preventDefault();
    if (!dirty || trimmed === "") return;
    setSaving(true);
    setError(null);
    const { error: authError } = await getSupabaseBrowser().auth.updateUser({
      data: { display_name: trimmed },
    });
    setSaving(false);
    if (authError) {
      setError("Couldn't save your name. Try again.");
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
      <div className="space-y-4">
        <SettingsCard
          title="Display name"
          description="How teammates see you on assignments and notes."
        >
          <form
            onSubmit={saveName}
            className="flex flex-col gap-2 sm:flex-row"
          >
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="display-name" className="sr-only">
                Display name
              </Label>
              <Input
                id="display-name"
                value={name}
                maxLength={120}
                autoComplete="name"
                onChange={(event) => setName(event.target.value)}
              />
              {email && (
                <p className="text-xs text-muted-foreground">
                  Signed in as {email}
                </p>
              )}
            </div>
            <Button
              type="submit"
              disabled={!dirty || trimmed === "" || saving}
              className="sm:self-start"
            >
              {saving ? "Saving…" : "Save"}
            </Button>
          </form>
          {error && (
            <p role="alert" className="mt-2 text-sm text-destructive">
              {error}
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
