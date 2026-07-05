"use client";

import type { User } from "@supabase/supabase-js";
import { useEffect, useState } from "react";

import { AccountMethods } from "@/components/settings/account-methods";
import { ChangeEmailCard } from "@/components/settings/change-email-card";
import { ChangePasswordCard } from "@/components/settings/change-password-card";
import {
  LoadError,
  SettingsCard,
  SettingsPage,
} from "@/components/settings/section";
import { Skeleton } from "@/components/ui/skeleton";
import { isOAuthOnly } from "@/lib/auth/identities";
import { getSupabaseBrowser } from "@/lib/supabase/browser";

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; user: User };

/**
 * /settings/account (D18 / APP-FEATURES-V2 §1.5–1.8): change email, change or
 * set password, and see the linked sign-in methods (Google · Apple · Password).
 *
 * All auth state comes from Supabase directly (the D8 boundary — the Worker
 * never brokers login); Loonext reads email/identities from auth.users, so
 * there's no app-side mirror to reconcile after a change.
 */
export default function AccountSettingsPage() {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  function load() {
    setState({ status: "loading" });
    void getSupabaseBrowser()
      .auth.getUser()
      .then(({ data, error }) => {
        if (error || !data.user) {
          setState({ status: "error" });
          return;
        }
        setState({ status: "ready", user: data.user });
      });
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <SettingsPage
      title="Account"
      description="How you sign in to Loonext."
    >
      {state.status === "loading" && (
        <div className="space-y-4" aria-label="Loading account settings">
          <Skeleton className="h-32 w-full rounded-lg" />
          <Skeleton className="h-32 w-full rounded-lg" />
          <Skeleton className="h-40 w-full rounded-lg" />
        </div>
      )}

      {state.status === "error" && <LoadError onRetry={load} />}

      {state.status === "ready" && (
        <div className="space-y-6">
          <SettingsCard
            title="Sign-in methods"
            description="How you can log in. Same email across methods stays one account."
          >
            <AccountMethods identities={state.user.identities} />
          </SettingsCard>

          <ChangeEmailCard email={state.user.email ?? null} />

          {/* OAuth-only accounts get "Set a password"; accounts that already
              have one get "Change password" (with reauth when the session is
              stale) — §1.6/§1.8. */}
          <ChangePasswordCard oauthOnly={isOAuthOnly(state.user.identities)} />
        </div>
      )}
    </SettingsPage>
  );
}
