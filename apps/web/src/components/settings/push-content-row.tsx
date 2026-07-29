"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ApiError } from "@/lib/api/error";
import { useCompany, useUpdateCompany } from "@/lib/api/companies";
import { useActiveCompany } from "@/lib/company/provider";

/**
 * #430 — whether a customer's words may ride a push notification.
 *
 * PHRASED POSITIVELY, and on by default, so the switch's "on" position is the
 * behaviour every workspace already has. A negative switch ("hide message
 * content") makes the safe-looking position the one that changes things, and
 * an owner reading quickly cannot tell which way is the status quo.
 * *Applying: Smart Defaults — the product ships with an opinion, and the
 * control describes the opinion rather than its negation.*
 *
 * THE DESCRIPTION LEADS WITH THE ROOM, NOT THE FEATURE. An owner does not
 * think about push payloads; they think about the phone on the workbench in a
 * customer's kitchen. Naming that is what makes the setting legible in the two
 * seconds someone spends on a row they have never seen.
 *
 * It also states its blast radius inline, for the same reason
 * {@link LeadChaseRow} does: everything else on this page is per-person and
 * this is workspace-wide, and silently mixing the two scopes would let a
 * member believe they had changed something for themselves.
 * *Applying: the Safety Principle — a control's blast radius has to be legible
 * before it is touched, not after.*
 */
export function PushContentRow() {
  const company = useCompany();
  const update = useUpdateCompany();
  const { role } = useActiveCompany();
  const canEdit = role === "owner" || role === "admin";
  const [error, setError] = useState<string | null>(null);

  if (company.isPending || company.isError || !company.data) return null;

  function toggle(value: boolean) {
    setError(null);
    update.mutate(
      { push_include_content: value },
      {
        onError: (cause) => {
          const message =
            cause instanceof ApiError
              ? cause.message
              : "Couldn't save that. Try again.";
          setError(message);
          toast.error(message);
        },
      },
    );
  }

  return (
    <div className="space-y-1">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-0.5">
          <Label htmlFor="push-content" className="text-sm font-medium">
            Show message text on lock screens
          </Label>
          <p className="text-sm text-muted-foreground">
            Notifications show who texted and the first line of what they said,
            so the crew can tell a lead from a &ldquo;thanks&rdquo; without
            unlocking. Turn this off and they&apos;ll still see who it was, but
            never what a customer wrote — useful if phones are out on the job,
            in other people&apos;s homes.{" "}
            <span className="font-medium text-foreground">
              This one is for the whole workspace, not just you
            </span>
            {canEdit ? "." : " — only owners and admins can change it."}
          </p>
        </div>
        <Switch
          id="push-content"
          checked={company.data.push_include_content}
          disabled={!canEdit || update.isPending}
          onCheckedChange={toggle}
        />
      </div>
      {error !== null && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
