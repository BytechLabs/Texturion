"use client";

import { SimpleSelect } from "@/components/ui/simple-select";
import { type Translate } from "@/i18n/provider";
import type { Member } from "@/lib/api/types";

export type AssignableRole = "admin" | "member" | "read_only" | "bookkeeper";

/** The roles a person can be given, in the order every list shows them. */
export const ASSIGNABLE_ROLES: readonly AssignableRole[] = [
  "member",
  "admin",
  "read_only",
  "bookkeeper",
];

export function roleLabels(t: Translate): Record<Member["role"], string> {
  return {
    owner: t("appShell.roleOwner"),
    admin: t("appShell.roleAdmin"),
    member: t("appShell.roleMember"),
    read_only: t("appShell.roleReadOnly"),
    bookkeeper: t("appShell.roleBookkeeper"),
  };
}

/**
 * #315: what each role is FOR, in the words an owner picking one would use.
 * A checkbox grid is a correct model and a bad product for a crew of four, so
 * the roles ship as named presets and the picker says what each is for.
 */
export function roleBlurbs(t: Translate): Record<AssignableRole, string> {
  return {
    admin: t("appShell.roleAdminBlurb"),
    member: t("appShell.roleMemberBlurb"),
    read_only: t("appShell.roleReadOnlyBlurb"),
    bookkeeper: t("appShell.roleBookkeeperBlurb"),
  };
}

/**
 * #746: the one role control. Invites and Members draw it the same way: the
 * closed trigger shows the role's name only, and the one-line description sits
 * in the open list (and under the field, where the caller shows it).
 * *Applying: Zen of Clarity, and Chunking: the name is the answer, the
 * description is help.*
 */
export function RoleSelect({
  value,
  onValueChange,
  t,
  disabled,
  ariaLabel,
  id,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
}: {
  value: AssignableRole | "owner";
  onValueChange: (role: AssignableRole) => void;
  t: Translate;
  disabled?: boolean;
  ariaLabel?: string;
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "true" | "false";
}) {
  const labels = roleLabels(t);
  const blurbs = roleBlurbs(t);
  return (
    <SimpleSelect
      value={value}
      onValueChange={(next) => onValueChange(next as AssignableRole)}
      options={ASSIGNABLE_ROLES.map((role) => ({
        value: role,
        label: labels[role],
        description: blurbs[role],
      }))}
      id={id}
      ariaLabel={ariaLabel}
      aria-describedby={ariaDescribedBy}
      aria-invalid={ariaInvalid}
      disabled={disabled}
      className="w-full sm:w-40"
    />
  );
}
