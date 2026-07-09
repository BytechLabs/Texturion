"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { useMe } from "@/lib/api/me";
import {
  useOnboardingCompany,
  useOnboardingRegistration,
} from "@/lib/api/onboarding";
import { useSessionReady } from "@/lib/auth/use-session-ready";
import type { CompanyView, RegistrationState } from "@/lib/api/types";
import {
  readCompanyCookie,
  resolveActiveCompanyId,
} from "@/lib/company/cookie";

import { readOnboardingDraft } from "./local-draft";
import {
  pathForLocation,
  resolveOnboardingLocation,
  stepAllowed,
  type OnboardingDraft,
  type OnboardingSnapshot,
  type WizardStep,
} from "./steps";

export interface OnboardingState {
  status: "loading" | "error" | "ready";
  retry: () => void;
  /** Active company id (memberships + persisted cookie), null pre-creation. */
  companyId: string | null;
  company: CompanyView | null;
  registration: RegistrationState | null;
  role: "owner" | "admin" | "member" | null;
  draft: OnboardingDraft;
  snapshot: OnboardingSnapshot | null;
  /** Re-read the local draft after a step writes it (same-mount navigation). */
  refreshDraft: () => void;
}

/**
 * Assembles the wizard's resume state: GET /v1/me (memberships) →
 * GET /v1/company + GET /v1/registration for the active company, plus the
 * local pre-company draft. Runs outside CompanyProvider (which requires a
 * membership) — company id is resolved here the same way the provider does.
 */
export function useOnboardingState(): OnboardingState {
  // Gate /v1/me on the resolved session — a fresh OAuth signup lands here (not
  // in CompanyProvider), so without this the first /me fires tokenless and the
  // wizard shows "check your connection" until a refresh.
  const me = useMe(useSessionReady());
  // localStorage is unavailable during SSR; both renders start as {} and the
  // client fills it in before anything user-visible depends on it (the pages
  // render a skeleton until `status === "ready"`).
  const [draft, setDraft] = useState<OnboardingDraft>({});
  const [draftLoaded, setDraftLoaded] = useState(false);
  useEffect(() => {
    setDraft(readOnboardingDraft());
    setDraftLoaded(true);
  }, []);

  const memberships = me.data?.memberships ?? [];
  const companyId = me.data
    ? resolveActiveCompanyId(memberships, readCompanyCookie())
    : null;

  const company = useOnboardingCompany(companyId);
  const registration = useOnboardingRegistration(companyId);

  const role =
    memberships.find((m) => m.company_id === companyId)?.role ?? null;

  const loading =
    me.isPending ||
    !draftLoaded ||
    (companyId !== null && (company.isPending || registration.isPending));
  const error =
    me.isError ||
    (companyId !== null && (company.isError || registration.isError));

  const snapshot = useMemo<OnboardingSnapshot | null>(() => {
    if (loading || error) return null;
    return {
      company: company.data ?? null,
      registration: registration.data ?? null,
      draft,
    };
  }, [loading, error, company.data, registration.data, draft]);

  return {
    status: error ? "error" : loading ? "loading" : "ready",
    retry: () => {
      if (me.isError) void me.refetch();
      if (company.isError) void company.refetch();
      if (registration.isError) void registration.refetch();
    },
    companyId,
    company: company.data ?? null,
    registration: registration.data ?? null,
    role,
    draft,
    snapshot,
    refreshDraft: () => setDraft(readOnboardingDraft()),
  };
}

/**
 * Step guard: while a step's prerequisites are unmet (deep link, stale tab)
 * it redirects to the resumable location instead of rendering a broken form.
 */
export function useWizardStepGuard(step: WizardStep): {
  state: OnboardingState;
  ready: boolean;
} {
  const state = useOnboardingState();
  const router = useRouter();

  const allowed =
    state.snapshot !== null && stepAllowed(step, state.snapshot);
  const redirectTo =
    state.snapshot !== null && !allowed
      ? pathForLocation(resolveOnboardingLocation(state.snapshot))
      : null;

  useEffect(() => {
    if (redirectTo) router.replace(redirectTo);
  }, [redirectTo, router]);

  return { state, ready: state.status === "ready" && allowed };
}
