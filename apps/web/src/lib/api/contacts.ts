import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { useCompanyId } from "@/lib/company/provider";

import { apiFetch } from "./client";
import { keys } from "./keys";
import { nextCursorParam } from "./pagination";
import type {
  Contact,
  ContactDetail,
  ContactListItem,
  ImportResult,
  OptOut,
  Page,
} from "./types";

export function fetchContactsPage(
  companyId: string,
  q: string,
  cursor?: string,
): Promise<Page<ContactListItem>> {
  // List rows carry `opted_out` (the G6 opted-out badge) and
  // `last_activity_at` (the G6 "Last activity" column — conversation
  // activity, null when the contact has never texted).
  return apiFetch<Page<ContactListItem>>("/v1/contacts", {
    companyId,
    searchParams: { q: q === "" ? undefined : q, cursor },
  });
}

/** Contacts table — trgm-backed search via `q` (G6). */
export function useContacts(q = "") {
  const companyId = useCompanyId();
  const trimmed = q.trim();
  return useInfiniteQuery({
    queryKey: keys.contacts.list(companyId, trimmed),
    queryFn: ({ pageParam }) =>
      fetchContactsPage(companyId, trimmed, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: nextCursorParam,
    // Keep the previous result set visible while a new search term resolves —
    // each keystroke moves to a fresh (uncached) query key, which otherwise
    // collapsed the whole table to skeleton (+ lost loaded pages + scroll).
    placeholderData: (previous) => previous,
  });
}

/** GET /v1/contacts/:id — includes the app-side `opted_out` flag. */
export function useContact(contactId: string) {
  const companyId = useCompanyId();
  return useQuery({
    queryKey: keys.contacts.detail(companyId, contactId),
    queryFn: () =>
      apiFetch<ContactDetail>(`/v1/contacts/${contactId}`, { companyId }),
  });
}

export interface ContactCreateInput {
  phone_e164: string;
  name?: string;
  address?: string;
  notes?: string;
}

/** POST /v1/contacts — upsert on (company, phone); resurrects soft-deletes. */
export function useCreateContact() {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ContactCreateInput) =>
      apiFetch<Contact>("/v1/contacts", {
        method: "POST",
        companyId,
        body: input,
      }),
    onSuccess: (contact) => {
      queryClient.setQueryData<ContactDetail>(
        keys.contacts.detail(companyId, contact.id),
        (existing) => ({
          opted_out: existing?.opted_out ?? false,
          opt_out_source: existing?.opt_out_source ?? null,
          // #292: the PATCH echoes the stored override, not the resolved
          // clock — the detail refetch below brings that. Keeping the previous
          // resolution meanwhile beats blanking the line mid-edit.
          timezone_resolved: existing?.timezone_resolved ?? "UTC",
          timezone_source: existing?.timezone_source ?? "company",
          local_hour: existing?.local_hour ?? 0,
          ...contact,
        }),
      );
      queryClient.invalidateQueries({
        queryKey: keys.contacts.lists(companyId),
        refetchType: "active",
      });
    },
  });
}

export interface ContactPatch {
  name?: string | null;
  address?: string | null;
  notes?: string | null;
  /**
   * #292/D49: correct the area-code inference, or null to go back to
   * inferring — which is what you want after fixing a wrong NUMBER rather than
   * a customer who moved.
   */
  timezone?: string | null;
  /** §5 consent attestation — only literal true has meaning. */
  consent_attested?: true;
}

/** PATCH /v1/contacts/:id — inline edits + consent attestation (G6). */
export function useUpdateContact(contactId: string) {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: ContactPatch) =>
      apiFetch<Contact>(`/v1/contacts/${contactId}`, {
        method: "PATCH",
        companyId,
        body: patch,
      }),
    onSuccess: (contact, patch) => {
      queryClient.setQueryData<ContactDetail>(
        keys.contacts.detail(companyId, contactId),
        (existing) => ({
          opted_out: existing?.opted_out ?? false,
          opt_out_source: existing?.opt_out_source ?? null,
          // #292: the PATCH echoes the stored OVERRIDE, not the resolved
          // clock. Carrying the previous resolution forward beats blanking the
          // line mid-edit; a timezone change refetches it below.
          timezone_resolved: existing?.timezone_resolved ?? "UTC",
          timezone_source: existing?.timezone_source ?? "company",
          local_hour: existing?.local_hour ?? 0,
          ...contact,
        }),
      );
      queryClient.invalidateQueries({
        queryKey: keys.contacts.lists(companyId),
        refetchType: "active",
      });
      // #292: only the timezone changes what the server RESOLVES, and only it
      // is worth a round trip — an autosaved name would refetch the detail on
      // every keystroke pause for no change anyone can see.
      if ("timezone" in patch) {
        queryClient.invalidateQueries({
          queryKey: keys.contacts.detail(companyId, contactId),
          refetchType: "active",
        });
      }
    },
  });
}

/** DELETE /v1/contacts/:id — soft delete (hides from lists only). */
export function useDeleteContact() {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (contactId: string) =>
      apiFetch<void>(`/v1/contacts/${contactId}`, {
        method: "DELETE",
        companyId,
      }),
    onSuccess: (_void, contactId) => {
      queryClient.removeQueries({
        queryKey: keys.contacts.detail(companyId, contactId),
      });
      queryClient.invalidateQueries({
        queryKey: keys.contacts.lists(companyId),
        refetchType: "active",
      });
    },
  });
}

/**
 * POST /v1/contacts/import — CSV multipart (owner/admin). Returns
 * `{ imported, updated, skipped, errors }` for the G6 import summary.
 */
export function useImportContacts() {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (file: File | Blob) => {
      const formData = new FormData();
      formData.append("file", file);
      return apiFetch<ImportResult>("/v1/contacts/import", {
        method: "POST",
        companyId,
        formData,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: keys.contacts.lists(companyId),
        refetchType: "active",
      });
    },
  });
}

/** POST /v1/contacts/:id/opt-out — manual opt-out (FCC revocation, §5). */
export function useOptOutContact() {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (contactId: string) =>
      apiFetch<OptOut>(`/v1/contacts/${contactId}/opt-out`, {
        method: "POST",
        companyId,
      }),
    onSuccess: (_optOut, contactId) => {
      queryClient.setQueryData<ContactDetail>(
        keys.contacts.detail(companyId, contactId),
        (existing) =>
          existing ? { ...existing, opted_out: true } : existing,
      );
      // List rows carry `opted_out` (G6 badge) — keep the table honest.
      queryClient.invalidateQueries({
        queryKey: keys.contacts.lists(companyId),
        refetchType: "active",
      });
    },
  });
}

/** POST /v1/contacts/:id/opt-out/revoke — "Mark opted in again" (§5). */
export function useRevokeOptOut() {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (contactId: string) =>
      apiFetch<OptOut>(`/v1/contacts/${contactId}/opt-out/revoke`, {
        method: "POST",
        companyId,
      }),
    onSuccess: (_optOut, contactId) => {
      queryClient.setQueryData<ContactDetail>(
        keys.contacts.detail(companyId, contactId),
        (existing) =>
          existing ? { ...existing, opted_out: false } : existing,
      );
      // List rows carry `opted_out` (G6 badge) — keep the table honest.
      queryClient.invalidateQueries({
        queryKey: keys.contacts.lists(companyId),
        refetchType: "active",
      });
    },
  });
}
