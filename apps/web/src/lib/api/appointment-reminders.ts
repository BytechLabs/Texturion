"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiFetch } from "./client";
import { useCompanyId } from "@/lib/company/provider";

/**
 * #237 — how long before a job a reminder goes, and what it says.
 *
 * NO RULES MEANS NO REMINDERS. The API deliberately does not seed the defaults
 * on company creation — that would start texting every existing workspace's
 * customers automatically — so it returns them as `suggested` instead, and the
 * card offers them in one tap.
 */
export interface ReminderRule {
  id?: string;
  offset_minutes: number;
  body: string;
  enabled: boolean;
}

interface ReminderRulesResponse {
  rules: ReminderRule[];
  /** What the two industry-standard rules would be. Offered, never applied. */
  suggested: { offset_minutes: number; body: string }[];
  cap: number;
}

const reminderKey = (companyId: string) =>
  ["appointment-reminders", companyId] as const;

export function useReminderRules() {
  const companyId = useCompanyId();
  return useQuery({
    queryKey: reminderKey(companyId),
    queryFn: () =>
      apiFetch<ReminderRulesResponse>("/v1/appointment-reminders", {
        companyId,
      }),
  });
}

/**
 * Replace the whole set.
 *
 * Not per-rule saves. There are at most two, they are edited on one screen
 * together, and a partial save could leave the workspace texting on a rule
 * nobody meant to keep. It also makes "turn reminders off" an empty array
 * rather than a second verb.
 */
export function useSaveReminderRules() {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (rules: ReminderRule[]) =>
      apiFetch<{ rules: ReminderRule[] }>("/v1/appointment-reminders", {
        method: "PUT",
        companyId,
        body: {
          rules: rules.map((rule) => ({
            offset_minutes: rule.offset_minutes,
            body: rule.body,
            enabled: rule.enabled,
          })),
        },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: reminderKey(companyId) });
    },
  });
}
