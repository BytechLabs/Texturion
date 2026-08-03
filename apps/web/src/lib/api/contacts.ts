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
  /**
   * #459: read digits as keypad letters too (2 is ABC, so 262 finds "Bob").
   * Opt-in, because in a search box "416" means an area code and quietly
   * returning names as well would answer a question nobody asked.
   */
  t9 = false,
  /**
   * #291: narrow to one answer in one of the workspace's own fields. Both
   * halves or neither — the server refuses a field with no value, because
   * "has any answer" and "has none" are different questions and guessing
   * either would filter somebody's list by a rule they did not choose.
   */
  field?: ContactFieldFilter,
): Promise<Page<ContactListItem>> {
  // List rows carry `opted_out` (the G6 opted-out badge) and
  // `last_activity_at` (the G6 "Last activity" column — conversation
  // activity, null when the contact has never texted).
  return apiFetch<Page<ContactListItem>>("/v1/contacts", {
    companyId,
    searchParams: {
      q: q === "" ? undefined : q,
      cursor,
      t9: t9 && q !== "" ? "1" : undefined,
      field: field?.key,
      // Sent even when empty: "" is a real answer on a custom field, and
      // dropping it would silently widen the list back to everybody.
      value: field ? field.value : undefined,
    },
  });
}

/** #291 — one field, one answer. Two conditions combined is a report. */
export interface ContactFieldFilter {
  key: string;
  value: string;
}

/** Contacts table — trgm-backed search via `q` (G6), keypad letters via `t9`. */
export function useContacts(
  q = "",
  options: { t9?: boolean; field?: ContactFieldFilter } = {},
) {
  const companyId = useCompanyId();
  const trimmed = q.trim();
  const t9 = options.t9 === true;
  const field = options.field;
  return useInfiniteQuery({
    // The flag is part of the key: the same digits mean a different result set
    // with names folded in, and sharing a cache entry would show one caller the
    // other's answer. #291: the FILTER is part of it for the same reason — a
    // filtered list sharing a cache entry with an unfiltered one would show
    // rows the filter excludes.
    queryKey: [
      ...keys.contacts.list(companyId, trimmed),
      t9 ? "t9" : "n",
      field ? `${field.key}=${field.value}` : "all",
    ],
    queryFn: ({ pageParam }) =>
      fetchContactsPage(companyId, trimmed, pageParam, t9, field),
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

/**
 * Fold a saved contact back into the cached detail.
 *
 * PATCH and POST echo the stored COLUMNS and nothing computed — the derived
 * fields (`conversation_count`, `first_conversation_at`, the created/updated-by
 * names, the resolved clock) exist only in the GET handler. So the response is
 * a partial view of the detail, and writing it over the cache DROPS whatever it
 * does not mention.
 *
 * #505: that was a live #410 defect. Editing a name blanked the panel's
 * "Customer since March 2026 · 7 conversations" until something refetched,
 * because the merge listed five fields to carry forward and stopped there.
 * Spreading `existing` carries every derived field, including the ones added
 * after this was written — an explicit list is a thing to forget, and it was
 * forgotten once already.
 *
 * The saved columns still win, so the edit the user just made is what shows.
 */
export function mergeContactDetail(
  existing: ContactDetail | undefined,
  saved: Contact,
): ContactDetail {
  return {
    // Defaults for the case where nothing is cached yet.
    opted_out: existing?.opted_out ?? false,
    opt_out_source: existing?.opt_out_source ?? null,
    // #292: the write echoes the stored OVERRIDE, not the resolved clock.
    // Carrying the previous resolution forward beats blanking the line
    // mid-edit; a timezone change refetches it.
    timezone_resolved: existing?.timezone_resolved ?? "UTC",
    timezone_source: existing?.timezone_source ?? "company",
    local_hour: existing?.local_hour ?? 0,
    ...existing,
    ...saved,
  };
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
        (existing) => mergeContactDetail(existing, contact),
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
  /**
   * #291: the workspace's own fields, as a WHOLE object. A partial send would
   * drop every value it left out — the API stores what it is given, because
   * merging would leave no way to clear one.
   */
  custom_fields?: Record<string, string>;
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
        (existing) => mergeContactDetail(existing, contact),
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

/**
 * #246 — the likely duplicates in this workspace.
 *
 * Two signals the server can explain: the same name, or the same ten digits
 * reached by different prefix habits. Read on the contacts page rather than
 * behind its own route — somebody finds out they have duplicates by being
 * shown them, not by going looking.
 */
export interface DuplicatePair {
  contact_a: string;
  name_a: string | null;
  phone_a: string;
  contact_b: string;
  name_b: string | null;
  phone_b: string;
  reason: string;
}

export function useDuplicateContacts() {
  const companyId = useCompanyId();
  return useQuery({
    queryKey: keys.contacts.duplicates(companyId),
    queryFn: () =>
      apiFetch<Page<DuplicatePair>>("/v1/contacts/duplicates", { companyId }),
  });
}

/**
 * #246 — POST /v1/contacts/:id/merge.
 *
 * Invalidates every contact query AND the conversation lists: a merge moves
 * whole threads onto a different contact, so a cached inbox would keep showing
 * them under a record that no longer owns them.
 */
export function useMergeContacts() {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { fromContactId: string; intoContactId: string }) =>
      apiFetch<{
        merged: true;
        moved: number;
        closed: number;
        opted_out: boolean;
      }>(`/v1/contacts/${input.fromContactId}/merge`, {
        method: "POST",
        companyId,
        body: { into_contact_id: input.intoContactId },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: [companyId, "contacts"],
      });
      void queryClient.invalidateQueries({
        queryKey: keys.conversations.lists(companyId),
      });
    },
  });
}

/**
 * #291 — a contact's addresses.
 *
 * Each hook invalidates the contact DETAIL, because that is where the list
 * lives: they ride the contact rather than having their own read, so a panel
 * never paints the record and then the addresses a moment later.
 */
export interface ContactAddress {
  id: string;
  label: string | null;
  address: string;
  is_primary: boolean;
  created_at: string;
}

/**
 * #291 — one of a customer's other numbers.
 *
 * No `is_primary`: the contact's own `phone_e164` is the primary, and a second
 * flag for the same idea would let the two disagree.
 */
export interface ContactPhone {
  id: string;
  phone_e164: string;
  label: string | null;
  created_at: string;
}

export function useAddContactAddress(contactId: string) {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      address: string;
      label?: string | null;
      is_primary?: boolean;
    }) =>
      apiFetch<{ data: ContactAddress }>(
        `/v1/contacts/${contactId}/addresses`,
        { method: "POST", companyId, body },
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: keys.contacts.detail(companyId, contactId),
      }),
  });
}

/**
 * #291 — a customer's other numbers.
 *
 * One row per request, like the addresses. The server refuses a number
 * somebody else already has, and its message names them: taking it would
 * silently redirect that customer's texts and calls onto this record.
 */
export function useAddContactPhone(contactId: string) {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { phone_e164: string; label?: string | null }) =>
      apiFetch<{ data: ContactPhone }>(`/v1/contacts/${contactId}/phones`, {
        method: "POST",
        companyId,
        body,
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: keys.contacts.detail(companyId, contactId),
      }),
  });
}

export function useRemoveContactPhone(contactId: string) {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (phoneId: string) =>
      apiFetch<{ deleted: true }>(
        `/v1/contacts/${contactId}/phones/${phoneId}`,
        { method: "DELETE", companyId },
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: keys.contacts.detail(companyId, contactId),
      }),
  });
}

export function useUpdateContactAddress(contactId: string) {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      addressId: string;
      label?: string | null;
      address?: string;
      is_primary?: boolean;
    }) => {
      const { addressId, ...body } = input;
      return apiFetch<{ data: ContactAddress }>(
        `/v1/contacts/${contactId}/addresses/${addressId}`,
        { method: "PATCH", companyId, body },
      );
    },
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: keys.contacts.detail(companyId, contactId),
      }),
  });
}

export function useRemoveContactAddress(contactId: string) {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (addressId: string) =>
      apiFetch<null>(`/v1/contacts/${contactId}/addresses/${addressId}`, {
        method: "DELETE",
        companyId,
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: keys.contacts.detail(companyId, contactId),
      }),
  });
}
