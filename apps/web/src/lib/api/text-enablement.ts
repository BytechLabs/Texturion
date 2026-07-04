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
  Page,
  TextEnablement,
  TextEnablementVerificationMethod,
} from "./types";

/**
 * TanStack Query hooks for the keep-your-number text-enablement routes
 * (FEATURE-GAPS voice wave path B, `apps/api/src/routes/text-enablement.ts`):
 * list, create (client-UUID Idempotency-Key), upload the LOA + recent bill,
 * the number-ownership verification step (request a code by sms/call, then
 * verify it — no local state; the Telnyx order is the source of truth),
 * resubmit after a stall, and owner-only cancel. Typed to the real sanitize()
 * response shape; every failure throws the shared {@link ApiError} the callers
 * surface as one plain sentence.
 *
 * Unlike porting there is deliberately NO `*ForCompany` onboarding flavor:
 * text-enablement has no wizard fork — Settings → Numbers is its one surface,
 * always inside CompanyProvider.
 */

// ---------------------------------------------------------------------------
// Request builders (the single source of truth for path/shape per route)
// ---------------------------------------------------------------------------

/** GET /v1/text-enablements — the company's orders (SPEC §7 list envelope). */
function requestList(companyId: string): Promise<Page<TextEnablement>> {
  return apiFetch<Page<TextEnablement>>("/v1/text-enablements", { companyId });
}

/**
 * POST /v1/text-enablements — text-enable an existing number (owner/admin).
 * Requires a client-UUID Idempotency-Key (SPEC §7); the same key replays the
 * same order row. The server validates the number is a US/CA local geographic
 * number in the company's country and claims a plan slot atomically.
 */
function requestCreate(
  companyId: string,
  phoneE164: string,
  idempotencyKey: string,
): Promise<TextEnablement> {
  return apiFetch<TextEnablement>("/v1/text-enablements", {
    method: "POST",
    companyId,
    idempotencyKey,
    body: { phone_e164: phoneE164 },
  });
}

/**
 * PUT /v1/text-enablements/:id/documents — upload the signed LOA and/or a
 * recent bill (multipart, PDF only — the hosted-messaging carrier action both
 * files feed accepts nothing else). Allowed while pending/action-required/
 * failed; blocked until the subscription is active (Telnyx-committing).
 */
function requestUploadDocuments(
  companyId: string,
  orderId: string,
  docs: { loa?: File; bill?: File },
): Promise<TextEnablement> {
  const form = new FormData();
  if (docs.loa) form.append("loa", docs.loa);
  if (docs.bill) form.append("bill", docs.bill);
  return apiFetch<TextEnablement>(
    `/v1/text-enablements/${orderId}/documents`,
    { method: "PUT", companyId, formData: form },
  );
}

/**
 * POST /v1/text-enablements/:id/verification-codes — ask the carrier to send
 * a number-ownership verification code to the number itself, by 'sms' or an
 * automated 'call' (owner/admin — the owner still controls the line on their
 * current carrier). A 422 carries the carrier's per-number delivery error
 * (e.g. a landline that can't receive SMS) so the caller offers the other
 * method; a 409 means the vendor order doesn't exist yet or the order left
 * the review window.
 */
function requestVerificationCode(
  companyId: string,
  orderId: string,
  method: TextEnablementVerificationMethod,
): Promise<{ requested: boolean; verification_method: string }> {
  return apiFetch<{ requested: boolean; verification_method: string }>(
    `/v1/text-enablements/${orderId}/verification-codes`,
    { method: "POST", companyId, body: { verification_method: method } },
  );
}

/**
 * POST /v1/text-enablements/:id/verification-codes/verify — submit the code
 * the owner received on the number (owner/admin). Verified (or already
 * verified) → 200; a rejected code → 422 with a plain retry sentence. No
 * local verification state exists — the Telnyx order is the source of truth.
 */
function requestVerifyCode(
  companyId: string,
  orderId: string,
  code: string,
): Promise<{ verified: boolean }> {
  return apiFetch<{ verified: boolean }>(
    `/v1/text-enablements/${orderId}/verification-codes/verify`,
    { method: "POST", companyId, body: { code } },
  );
}

/**
 * POST /v1/text-enablements/:id/resubmit — try again after a stall
 * (owner/admin). Allowed from failed/action-required; resets the attempt
 * budget and moves the order back to pending for the carrier.
 */
function requestResubmit(
  companyId: string,
  orderId: string,
): Promise<TextEnablement> {
  return apiFetch<TextEnablement>(
    `/v1/text-enablements/${orderId}/resubmit`,
    { method: "POST", companyId },
  );
}

/** POST /v1/text-enablements/:id/cancel — owner only; abandon a non-terminal order. */
function requestCancel(
  companyId: string,
  orderId: string,
): Promise<TextEnablement> {
  return apiFetch<TextEnablement>(`/v1/text-enablements/${orderId}/cancel`, {
    method: "POST",
    companyId,
  });
}

// ---------------------------------------------------------------------------
// Cache helpers — keep the list + detail caches consistent after a mutation
// ---------------------------------------------------------------------------

/** Upsert an order into both the list page and its detail cache. */
function cacheEnablement(
  queryClient: QueryClient,
  companyId: string,
  order: TextEnablement,
): void {
  queryClient.setQueryData(
    keys.textEnablements.detail(companyId, order.id),
    order,
  );
  queryClient.setQueryData<Page<TextEnablement>>(
    keys.textEnablements.list(companyId),
    (page) => {
      if (!page) return page;
      const exists = page.data.some((o) => o.id === order.id);
      return {
        ...page,
        data: exists
          ? page.data.map((o) => (o.id === order.id ? order : o))
          : [order, ...page.data],
      };
    },
  );
}

/**
 * An enablement claims/updates a `phone_numbers[source=hosted]` row server-side
 * (create inserts one; cancel converges it toward released), so the numbers
 * list AND the company view (numbers embed) refetch after those mutations.
 */
function invalidateNumberSurfaces(
  queryClient: QueryClient,
  companyId: string,
): void {
  queryClient.invalidateQueries({
    queryKey: keys.numbers(companyId),
    refetchType: "active",
  });
  queryClient.invalidateQueries({
    queryKey: keys.company(companyId),
    refetchType: "active",
  });
}

// ---------------------------------------------------------------------------
// Hooks (context companyId) — Settings → Numbers
// ---------------------------------------------------------------------------

/** GET /v1/text-enablements — the company's orders (any member). */
export function useTextEnablements() {
  const companyId = useCompanyId();
  return useQuery({
    queryKey: keys.textEnablements.list(companyId),
    queryFn: () => requestList(companyId),
  });
}

/** POST /v1/text-enablements — start text-enabling a number (owner/admin). */
export function useCreateTextEnablement() {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (phoneE164: string) =>
      requestCreate(companyId, phoneE164, crypto.randomUUID()),
    onSuccess: (order) => {
      cacheEnablement(queryClient, companyId, order);
      invalidateNumberSurfaces(queryClient, companyId);
    },
  });
}

/** PUT /v1/text-enablements/:id/documents — upload LOA + bill (owner/admin). */
export function useUploadTextEnablementDocs(orderId: string) {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (docs: { loa?: File; bill?: File }) =>
      requestUploadDocuments(companyId, orderId, docs),
    onSuccess: (order) => cacheEnablement(queryClient, companyId, order),
  });
}

/**
 * POST /v1/text-enablements/:id/verification-codes — send the ownership code
 * to the number by sms/call (owner/admin). No cache to touch: verification
 * lives on the Telnyx order, never locally.
 */
export function useRequestTextEnablementCode(orderId: string) {
  const companyId = useCompanyId();
  return useMutation({
    mutationFn: (method: TextEnablementVerificationMethod) =>
      requestVerificationCode(companyId, orderId, method),
  });
}

/**
 * POST /v1/text-enablements/:id/verification-codes/verify — check the code
 * the owner received (owner/admin). Verification can nudge the carrier review
 * along, so the order list refetches for a fresh status.
 */
export function useVerifyTextEnablementCode(orderId: string) {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (code: string) => requestVerifyCode(companyId, orderId, code),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: keys.textEnablements.all(companyId),
        refetchType: "active",
      });
    },
  });
}

/** POST /v1/text-enablements/:id/resubmit — try again after a stall (owner/admin). */
export function useResubmitTextEnablement(orderId: string) {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => requestResubmit(companyId, orderId),
    onSuccess: (order) => cacheEnablement(queryClient, companyId, order),
  });
}

/** POST /v1/text-enablements/:id/cancel — abandon a non-terminal order (owner). */
export function useCancelTextEnablement(orderId: string) {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => requestCancel(companyId, orderId),
    onSuccess: (order) => {
      cacheEnablement(queryClient, companyId, order);
      invalidateNumberSurfaces(queryClient, companyId);
    },
  });
}
