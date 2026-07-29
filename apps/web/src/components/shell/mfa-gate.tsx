"use client";

import { ShieldAlert } from "lucide-react";
import Link from "next/link";

import { GateSignOut } from "@/components/shell/gate-escape";
import { Button } from "@/components/ui/button";
import { useCompany } from "@/lib/api/companies";
import { ApiError } from "@/lib/api/error";

/**
 * #314 — the workspace requires a second factor and this session does not have
 * one.
 *
 * The API answers `mfa_required` on every company-scoped route once the grace
 * window has passed, which means every screen in the app would otherwise fail
 * at once with no explanation of what to do. So this covers the shell: one
 * clear sentence, and the route that fixes it.
 *
 * It watches `useCompany()` because that is the one company-scoped query the
 * shell always runs — /v1/me is company-exempt by design, so it never carries
 * this signal and the provider cannot see it.
 *
 * Sign-out stays reachable, as it does on every other gate in this app (#207):
 * a person who cannot enrol on this device must still be able to get out.
 */
export function MfaGate({ children }: { children: React.ReactNode }) {
  const company = useCompany();
  const blocked =
    company.isError &&
    company.error instanceof ApiError &&
    company.error.code === "mfa_required";

  if (!blocked) return <>{children}</>;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-5 px-6 text-center">
      <ShieldAlert
        className="size-8 text-amber-600 dark:text-amber-500"
        strokeWidth={1.5}
        aria-hidden
      />
      <div className="max-w-md space-y-2">
        <h1 className="text-lg font-semibold">
          This workspace needs two-factor authentication
        </h1>
        <p className="text-sm text-muted-foreground">
          The owner turned it on, and the grace period has ended. Set it up
          once and you&apos;re back in — it takes about a minute and needs an
          authenticator app on your phone.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button asChild>
          {/* Settings → Account is reachable: every route that gets somebody
              OUT of this state is company-exempt server-side, precisely so
              this link cannot lead to another wall. */}
          <Link href="/settings/account">Set up two-factor</Link>
        </Button>
        <Button variant="outline" onClick={() => void company.refetch()}>
          I&apos;ve done it
        </Button>
      </div>
      <GateSignOut />
    </div>
  );
}
