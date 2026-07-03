import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";

import { useCompanyId } from "@/lib/company/provider";

import { apiFetch } from "./client";
import { keys } from "./keys";
import type {
  CreatePortRequestInput,
  Page,
  PortabilityCheck,
  PortRequest,
  UpdatePortRequestInput,
} from "./types";

/**
 * TanStack Query hooks for the port-in routes (PORTING.md §6/§7,
 * `apps/api/src/routes/porting.ts`): portability check, create, get/list,
 * edit, upload documents (LOA + invoice), submit (documents-gated), resubmit,
 * and cancel. Typed to the real request/response shapes; every failure throws
 * the shared {@link ApiError} the callers surface as one plain sentence.
 *
 * Two flavors, mirroring the split already in the codebase:
 *   - the plain hooks (context companyId, via {@link useCompanyId}) for the
 *     in-app Settings → Numbers surface (inside CompanyProvider);
 *   - the `*ForCompany` hooks (explicit companyId) for the /onboarding wizard,
 *     which runs OUTSIDE CompanyProvider (the provider needs a membership).
 * Both share the same request builders + query keys so the cache is unified.
 */

// ---------------------------------------------------------------------------
// Request builders (the single source of truth for path/shape per route)
// ---------------------------------------------------------------------------

/** POST /v1/port-requests/check — portability check (pre-payment allowed). */
function requestCheck(
  companyId: string,
  phoneE164: string,
): Promise<PortabilityCheck> {
  return apiFetch<PortabilityCheck>("/v1/port-requests/check", {
    method: "POST",
    companyId,
    body: { phone_e164: phoneE164 },
  });
}

/**
 * POST /v1/port-requests — create a port request. Requires a client-UUID
 * Idempotency-Key (SPEC §7); the same key replays the same row. The server
 * re-runs the portability check and, for a wireless number, rejects a missing
 * `ssn_sin_last4` / `pin_passcode` with `validation_failed`.
 */
function requestCreate(
  companyId: string,
  input: CreatePortRequestInput,
  idempotencyKey: string,
): Promise<PortRequest> {
  return apiFetch<PortRequest>("/v1/port-requests", {
    method: "POST",
    companyId,
    idempotencyKey,
    body: input,
  });
}

/** GET /v1/port-requests — the company's ports (SPEC §7 list envelope). */
function requestList(companyId: string): Promise<Page<PortRequest>> {
  return apiFetch<Page<PortRequest>>("/v1/port-requests", { companyId });
}

/** GET /v1/port-requests/:id — one port's full state. */
function requestDetail(
  companyId: string,
  portId: string,
): Promise<PortRequest> {
  return apiFetch<PortRequest>(`/v1/port-requests/${portId}`, { companyId });
}

/** PUT /v1/port-requests/:id — edit port data while draft/exception. */
function requestUpdate(
  companyId: string,
  portId: string,
  patch: UpdatePortRequestInput,
): Promise<PortRequest> {
  return apiFetch<PortRequest>(`/v1/port-requests/${portId}`, {
    method: "PUT",
    companyId,
    body: patch,
  });
}

/**
 * PUT /v1/port-requests/:id/documents — upload the LOA and/or the invoice
 * (multipart). Each part is a File; the server forwards them to Telnyx and
 * stores the returned document UUIDs. Blocked until the subscription is active
 * (documents are a post-payment, Telnyx-committing action, §3.2 / D16).
 */
function requestUploadDocuments(
  companyId: string,
  portId: string,
  docs: { loa?: File; invoice?: File },
): Promise<PortRequest> {
  const form = new FormData();
  if (docs.loa) form.append("loa", docs.loa);
  if (docs.invoice) form.append("invoice", docs.invoice);
  return apiFetch<PortRequest>(`/v1/port-requests/${portId}/documents`, {
    method: "PUT",
    companyId,
    formData: form,
  });
}

/**
 * POST /v1/port-requests/:id/submit — the post-payment completion step. Confirms
 * a draft port once the LOA + invoice are uploaded (documents-gated: `conflict`
 * if either is missing, or if the port is not `draft`).
 */
function requestSubmit(
  companyId: string,
  portId: string,
): Promise<PortRequest> {
  return apiFetch<PortRequest>(`/v1/port-requests/${portId}/submit`, {
    method: "POST",
    companyId,
  });
}

/**
 * POST /v1/port-requests/:id/resubmit — fix-and-resubmit after an exception.
 * Documents-gated like submit; `conflict` if status is not `exception`.
 */
function requestResubmit(
  companyId: string,
  portId: string,
): Promise<PortRequest> {
  return apiFetch<PortRequest>(`/v1/port-requests/${portId}/resubmit`, {
    method: "POST",
    companyId,
  });
}

/** POST /v1/port-requests/:id/cancel — owner only; abandon a pre-completion port. */
function requestCancel(
  companyId: string,
  portId: string,
): Promise<PortRequest> {
  return apiFetch<PortRequest>(`/v1/port-requests/${portId}/cancel`, {
    method: "POST",
    companyId,
  });
}

// ---------------------------------------------------------------------------
// Cache helpers — keep the list + detail caches consistent after a mutation
// ---------------------------------------------------------------------------

/** Upsert a port into both the list page and its detail cache. */
function cachePort(
  queryClient: QueryClient,
  companyId: string,
  port: PortRequest,
): void {
  queryClient.setQueryData(keys.portRequests.detail(companyId, port.id), port);
  queryClient.setQueryData<Page<PortRequest>>(
    keys.portRequests.list(companyId),
    (page) => {
      if (!page) return page;
      const exists = page.data.some((p) => p.id === port.id);
      return {
        ...page,
        data: exists
          ? page.data.map((p) => (p.id === port.id ? port : p))
          : [port, ...page.data],
      };
    },
  );
}

// ---------------------------------------------------------------------------
// In-app hooks (context companyId) — Settings → Numbers
// ---------------------------------------------------------------------------

/** GET /v1/port-requests — the company's ports (any member). */
export function usePortRequests() {
  const companyId = useCompanyId();
  return useQuery({
    queryKey: keys.portRequests.list(companyId),
    queryFn: () => requestList(companyId),
  });
}

/** GET /v1/port-requests/:id — one port's live state (opportunistic refresh). */
export function usePortRequest(portId: string | null) {
  const companyId = useCompanyId();
  return useQuery({
    queryKey: keys.portRequests.detail(companyId, portId ?? "none"),
    queryFn: () => requestDetail(companyId, portId as string),
    enabled: portId !== null,
  });
}

/** POST /v1/port-requests/check — portability check (owner/admin). */
export function useCheckPortability() {
  const companyId = useCompanyId();
  return useMutation({
    mutationFn: (phoneE164: string) => requestCheck(companyId, phoneE164),
  });
}

/** POST /v1/port-requests — start a post-signup port (owner/admin). */
export function useCreatePortRequest() {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreatePortRequestInput) =>
      requestCreate(companyId, input, crypto.randomUUID()),
    onSuccess: (port) => {
      cachePort(queryClient, companyId, port);
      queryClient.invalidateQueries({
        queryKey: keys.company(companyId),
        refetchType: "active",
      });
    },
  });
}

/** PUT /v1/port-requests/:id — edit port data (owner/admin, draft/exception). */
export function useUpdatePortRequest(portId: string) {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: UpdatePortRequestInput) =>
      requestUpdate(companyId, portId, patch),
    onSuccess: (port) => cachePort(queryClient, companyId, port),
  });
}

/** PUT /v1/port-requests/:id/documents — upload LOA + invoice (owner/admin). */
export function useUploadPortDocuments(portId: string) {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (docs: { loa?: File; invoice?: File }) =>
      requestUploadDocuments(companyId, portId, docs),
    onSuccess: (port) => cachePort(queryClient, companyId, port),
  });
}

/** POST /v1/port-requests/:id/submit — documents-gated confirm (owner/admin). */
export function useSubmitPortRequest(portId: string) {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => requestSubmit(companyId, portId),
    onSuccess: (port) => {
      cachePort(queryClient, companyId, port);
      queryClient.invalidateQueries({
        queryKey: keys.company(companyId),
        refetchType: "active",
      });
    },
  });
}

/** POST /v1/port-requests/:id/resubmit — fix-and-resubmit (owner/admin). */
export function useResubmitPortRequest(portId: string) {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => requestResubmit(companyId, portId),
    onSuccess: (port) => cachePort(queryClient, companyId, port),
  });
}

/** POST /v1/port-requests/:id/cancel — abandon a pre-completion port (owner). */
export function useCancelPortRequest(portId: string) {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => requestCancel(companyId, portId),
    onSuccess: (port) => {
      cachePort(queryClient, companyId, port);
      queryClient.invalidateQueries({
        queryKey: keys.company(companyId),
        refetchType: "active",
      });
    },
  });
}

// ---------------------------------------------------------------------------
// Onboarding hooks (explicit companyId) — the /onboarding port wizard runs
// OUTSIDE CompanyProvider, so these take the company id as an argument.
// ---------------------------------------------------------------------------

/**
 * GET /v1/port-requests for an explicit company id (onboarding). Lets the plan
 * step swap in the port-specific checkout copy, and the setting-up screen track
 * a just-created port draft. `enabled` guards the pre-company window.
 */
export function usePortRequestsForCompany(companyId: string | null) {
  return useQuery({
    queryKey: keys.portRequests.list(companyId ?? "none"),
    queryFn: () => requestList(companyId as string),
    enabled: companyId !== null,
  });
}

/** POST /v1/port-requests/check for an explicit company id (onboarding). */
export function useCheckPortabilityForCompany() {
  return useMutation({
    mutationFn: (input: { companyId: string; phoneE164: string }) =>
      requestCheck(input.companyId, input.phoneE164),
  });
}

/**
 * POST /v1/port-requests for an explicit company id (onboarding). During
 * onboarding the subscription is `incomplete`, so the server writes the
 * `draft` row and DEFERS the Telnyx order to the paid checkout webhook
 * (paid-first, D16). Returns the created (draft) port.
 */
export function useCreatePortRequestForCompany() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      companyId: string;
      body: CreatePortRequestInput;
      /** Stable across retries so a resubmit replays the same row (§7). */
      idempotencyKey: string;
    }) => requestCreate(input.companyId, input.body, input.idempotencyKey),
    onSuccess: (port, { companyId }) => {
      cachePort(queryClient, companyId, port);
      queryClient.invalidateQueries({
        queryKey: keys.company(companyId),
        refetchType: "active",
      });
    },
  });
}

/** PUT /v1/port-requests/:id/documents for an explicit company id (onboarding). */
export function useUploadPortDocumentsForCompany() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      companyId: string;
      portId: string;
      docs: { loa?: File; invoice?: File };
    }) => requestUploadDocuments(input.companyId, input.portId, input.docs),
    onSuccess: (port, { companyId }) => cachePort(queryClient, companyId, port),
  });
}

/** POST /v1/port-requests/:id/submit for an explicit company id (onboarding). */
export function useSubmitPortRequestForCompany() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { companyId: string; portId: string }) =>
      requestSubmit(input.companyId, input.portId),
    onSuccess: (port, { companyId }) => {
      cachePort(queryClient, companyId, port);
      queryClient.invalidateQueries({
        queryKey: keys.company(companyId),
        refetchType: "active",
      });
    },
  });
}
