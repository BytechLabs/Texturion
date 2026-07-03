"use client";

import { Check } from "lucide-react";

import { signInMethods, type IdentityLike } from "@/lib/auth/identities";

const METHOD_LABEL: Record<string, string> = {
  google: "Google",
  apple: "Apple",
  password: "Password",
};

/**
 * The "Sign-in methods" linked-methods list (D18 / APP-FEATURES-V2 §1.8): a
 * compact status list of Google · Apple · Password, each present or absent. No
 * provider colors, stone chrome — a status list, not a management console.
 * Manual unlink is out of MVP; the one action (set/change password) lives in
 * the password card below.
 */
export function AccountMethods({
  identities,
}: {
  identities: IdentityLike[] | null | undefined;
}) {
  const methods = signInMethods(identities);
  return (
    <ul className="divide-y divide-border-subtle">
      {methods.map(({ method, linked }) => (
        <li
          key={method}
          className="flex items-center justify-between py-2.5 first:pt-0 last:pb-0"
        >
          <span className="text-sm">{METHOD_LABEL[method]}</span>
          {linked ? (
            <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
              <Check
                className="size-4 text-primary"
                strokeWidth={2}
                aria-hidden
              />
              Linked
            </span>
          ) : (
            <span className="text-sm text-muted-foreground">Not linked</span>
          )}
        </li>
      ))}
    </ul>
  );
}
