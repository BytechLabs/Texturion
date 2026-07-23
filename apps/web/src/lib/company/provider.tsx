"use client";

import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { GateSignOut } from "@/components/shell/gate-escape";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useMe } from "@/lib/api/me";
import type { MemberRole, Membership } from "@/lib/api/types";
import { useSessionReady } from "@/lib/auth/use-session-ready";

import {
  readCompanyCookie,
  resolveActiveCompanyId,
  writeCompanyCookie,
} from "./cookie";

export interface CompanyContextValue {
  companyId: string;
  /** The active membership (name, role, subscription state). */
  membership: Membership;
  memberships: Membership[];
  role: MemberRole;
  userId: string;
  displayName: string;
  /** Persist + activate another workspace (multi-company users only). */
  switchCompany: (companyId: string) => void;
}

const CompanyContext = createContext<CompanyContextValue | null>(null);

/**
 * Resolves the active company from GET /v1/me, persists the choice in a
 * cookie, and provides it to the API hooks (X-Company-Id) and the realtime
 * channel (G12). Users with no membership are routed to onboarding;
 * single-company users never see a switcher (the shell checks
 * `memberships.length`).
 */
export function CompanyProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  // Gate /v1/me on the resolved Supabase session so the first call after an
  // OAuth redirect carries a token (shared with the onboarding wizard, which
  // loads /me the same way outside this provider).
  const me = useMe(useSessionReady());
  const [chosen, setChosen] = useState<string | null>(() =>
    readCompanyCookie(),
  );

  const memberships = useMemo(
    () => me.data?.memberships ?? [],
    [me.data?.memberships],
  );
  const activeId = resolveActiveCompanyId(memberships, chosen);

  // Keep the cookie in sync when the fallback (first membership) was used or
  // the persisted company disappeared.
  useEffect(() => {
    if (activeId !== null && activeId !== chosen) {
      writeCompanyCookie(activeId);
      setChosen(activeId);
    }
  }, [activeId, chosen]);

  // An account with no workspace belongs in onboarding (SPEC §4.1).
  const needsOnboarding = me.isSuccess && memberships.length === 0;
  useEffect(() => {
    if (needsOnboarding) router.replace("/onboarding");
  }, [needsOnboarding, router]);

  const switchCompany = useCallback((companyId: string) => {
    writeCompanyCookie(companyId);
    setChosen(companyId);
  }, []);

  const value = useMemo<CompanyContextValue | null>(() => {
    if (!me.data || activeId === null) return null;
    const membership = memberships.find((m) => m.company_id === activeId);
    if (!membership) return null;
    return {
      companyId: activeId,
      membership,
      memberships,
      role: membership.role,
      userId: me.data.user_id,
      displayName: me.data.display_name,
      switchCompany,
    };
  }, [me.data, activeId, memberships, switchCompany]);

  // An owner/admin whose checkout never completed belongs back in onboarding to
  // finish paying (SPEC §4.1). Members can't pay, so they stay in the app and
  // see the "ask your owner" workspace banner instead of a dead redirect loop.
  const needsCheckout =
    value !== null &&
    value.role !== "member" &&
    (value.membership.subscription_status === "incomplete" ||
      value.membership.subscription_status === "incomplete_expired");
  useEffect(() => {
    if (needsCheckout) router.replace("/onboarding");
  }, [needsCheckout, router]);

  if (me.isError) {
    // The last retry-only dead end from the #207 gate-escape audit: with /me
    // failed, memberships are unknowable, so no workspace switcher is possible
    // here - but sign-out must still be reachable (shared GateSignOut, the
    // same escape the gate layouts mount).
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-sm text-muted-foreground">
          We couldn&apos;t load your workspace. Check your connection and try
          again.
        </p>
        <Button onClick={() => me.refetch()} variant="outline" size="sm">
          Try again
        </Button>
        <GateSignOut />
      </div>
    );
  }

  if (!value || needsCheckout) {
    // Loading (or redirecting to onboarding): named state, never a bare
    // spinner (G1 "no spinners without words").
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-6">
        <Skeleton className="h-8 w-40" />
        <p className="text-sm text-muted-foreground">
          {needsOnboarding || needsCheckout
            ? "Taking you to setup…"
            : "Loading your workspace…"}
        </p>
      </div>
    );
  }

  return (
    <CompanyContext.Provider value={value}>{children}</CompanyContext.Provider>
  );
}

/** Active company context; throws outside the (app) shell. */
export function useActiveCompany(): CompanyContextValue {
  const value = useContext(CompanyContext);
  if (!value) {
    throw new Error("useActiveCompany must be used inside CompanyProvider");
  }
  return value;
}

/** Shorthand for the X-Company-Id every scoped hook injects. */
export function useCompanyId(): string {
  return useActiveCompany().companyId;
}
