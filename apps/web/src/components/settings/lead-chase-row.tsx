"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ApiError } from "@/lib/api/error";
import { useCompany, useUpdateCompany } from "@/lib/api/companies";
import { useActiveCompany } from "@/lib/company/provider";
import { LEAD_CHASE_WIDEN_MINUTES } from "@loonext/shared";

/**
 * #463 — one switch, sitting among the other notification settings.
 *
 * It used to be two switches in a card of its own titled "Chasing unanswered
 * leads", and the owner's objection was that all of that was special treatment
 * for something that is just another notification setting. The second switch
 * was also unreachable in practice: the crew-wide alert required the
 * two-minute nudge to have fired first, so an owner who wanted only the
 * crew-wide one could not have it.
 *
 * WHAT THE OLD CARD GOT RIGHT AND THIS KEEPS. Everything else on that page is
 * per-person; this is workspace-wide. The card said so in its header, and
 * silently mixing the two scopes would let a member think they had muted
 * something for themselves when they had changed it for everyone. That warning
 * has not been dropped — it moved into this row's own description, which is
 * where somebody looks before touching a switch.
 * *Applying: the Safety Principle — a control's blast radius has to be legible
 * before it is touched, not after.*
 *
 * The business-hours limit moved with it, for the same reason: it is not a
 * setting, it is the difference between silence at 7pm being expected and
 * silence at 7pm being a bug worth reporting. Losing the card was not a reason
 * to lose the sentence.
 *
 * Still no minute picker. Exposing the interval would ask an owner to tune a
 * number they have no data for, and turn a promise into a configuration
 * exercise.
 * *Applying: Smart Defaults — the product ships with an opinion rather than an
 * empty form.*
 */
export function LeadChaseRow() {
  const company = useCompany();
  const update = useUpdateCompany();
  const { role } = useActiveCompany();
  const canEdit = role === "owner" || role === "admin";
  const [error, setError] = useState<string | null>(null);

  if (company.isPending || company.isError || !company.data) return null;

  function toggle(value: boolean) {
    setError(null);
    update.mutate(
      { lead_chase_crew_enabled: value },
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
          <Label htmlFor="lead-chase-crew" className="text-sm font-medium">
            Tell the whole crew after {LEAD_CHASE_WIDEN_MINUTES} minutes
          </Label>
          <p className="text-sm text-muted-foreground">
            When a conversation is assigned to one person and they still
            haven&apos;t replied, notify everyone who can see it. Business hours
            only, and never someone who has turned their own notifications off.{" "}
            <span className="font-medium text-foreground">
              This one is for the whole workspace, not just you
            </span>
            {canEdit ? "." : " — only owners and admins can change it."}
          </p>
        </div>
        <Switch
          id="lead-chase-crew"
          checked={company.data.lead_chase_crew_enabled}
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
