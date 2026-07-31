"use client";

import { ShieldAlert } from "lucide-react";
import Link from "next/link";

import { MfaChallenge } from "@/components/auth/mfa-challenge";
import { GateSignOut } from "@/components/shell/gate-escape";
import { Button } from "@/components/ui/button";
import { useCompany } from "@/lib/api/companies";
import { ApiError } from "@/lib/api/error";

/**
 * The two MFA walls, which look alike and mean opposite things.
 *
 * #314 `mfa_required` — the WORKSPACE requires a second factor, the grace
 * window has passed, and this person has no factor at all. The remedy is to
 * enrol, so this offers the route to enrolment.
 *
 * #496 `mfa_challenge_required` — this person HAS a factor and this session is
 * `aal1`. The remedy is a code, so this asks for one in place. Sending them to
 * the enrolment screen would be a dead end that invites a SECOND factor to fix
 * being asked for the first.
 *
 * Both watch `useCompany()` because that is the one company-scoped query the
 * shell always runs — /v1/me is company-exempt by design, so it never carries
 * either signal and the provider cannot see them.
 *
 * Sign-out stays reachable on both, as on every other gate in this app (#207):
 * a person who can satisfy neither must still be able to get out.
 */
export function MfaGate({ children }: { children: React.ReactNode }) {
  const company = useCompany();
  const code =
    company.isError && company.error instanceof ApiError
      ? company.error.code
      : null;

  if (code === "mfa_challenge_required") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center px-6">
        <div className="w-full max-w-sm">
          <MfaChallenge
            onVerified={() => void company.refetch()}
            footer={<GateSignOut />}
          />
        </div>
      </div>
    );
  }

  if (code !== "mfa_required") return <>{children}</>;

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
