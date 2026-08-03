"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { ContactFieldKind } from "@loonext/shared";

import { apiFetch } from "./client";
import { useCompanyId } from "@/lib/company/provider";

/**
 * #291 — the fields a workspace defines for itself.
 *
 * The equipment fields an HVAC company needs are not the ones a plumber needs,
 * and there is no set we could ship that would be right for both.
 */
export interface ContactFieldDef {
  key: string;
  label: string;
  kind: ContactFieldKind;
  options?: string[] | null;
  position?: number;
}

interface ContactFieldsResponse {
  data: ContactFieldDef[];
  /**
   * The ceiling, sent with the list rather than hardcoded in the card — a
   * client that kept its own copy would eventually disagree with the server
   * about when the Add button disappears.
   */
  cap: number;
}

const fieldsKey = (companyId: string) => ["contact-fields", companyId] as const;

/**
 * Read by anyone who can read conversations, not just by owners.
 *
 * A member cannot DEFINE a field, but they have to see the definitions to fill
 * one in on a contact — the settings screen and the contact panel read the
 * same list.
 */
export function useContactFields() {
  const companyId = useCompanyId();
  return useQuery({
    queryKey: fieldsKey(companyId),
    queryFn: () =>
      apiFetch<ContactFieldsResponse>("/v1/contact-fields", { companyId }),
  });
}

/**
 * Replace the whole set.
 *
 * Not per-field saves: there are at most ten, they are ordered relative to each
 * other, and they are edited together on one screen with a Save button. The
 * order in the array IS the order they appear on every contact.
 */
export function useSaveContactFields() {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (fields: ContactFieldDef[]) =>
      apiFetch<ContactFieldsResponse>("/v1/contact-fields", {
        method: "PUT",
        companyId,
        body: {
          fields: fields.map((field) => ({
            key: field.key,
            label: field.label,
            kind: field.kind,
            options: field.kind === "select" ? field.options ?? [] : null,
          })),
        },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: fieldsKey(companyId) });
      // The contact panel renders values against these definitions, so a
      // renamed or removed field has to reach any contact already on screen.
      void queryClient.invalidateQueries({ queryKey: ["contacts"] });
    },
  });
}
