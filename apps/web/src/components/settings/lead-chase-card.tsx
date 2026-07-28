"use client";

import { useState } from "react";
import { toast } from "sonner";

import { SettingsCard } from "@/components/settings/section";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { ApiError } from "@/lib/api/error";
import { useCompany, useUpdateCompany } from "@/lib/api/companies";
import { useActiveCompany } from "@/lib/company/provider";
import {
  LEAD_CHASE_NUDGE_MINUTES,
  LEAD_CHASE_WIDEN_MINUTES,
} from "@loonext/shared";

/**
 * #388 — chasing a lead nobody has answered.
 *
 * Sits on the Notifications page because that is where somebody goes to ask
 * "why did my phone buzz twice", but in its OWN card and explicitly labelled
 * workspace-wide: the card above it is per-person, and silently mixing the two
 * scopes would leave a member thinking they had turned something off for
 * themselves when they had changed it for everyone.
 * *Applying: the Safety Principle — a control's blast radius has to be
 * legible before it is touched, not after.*
 *
 * Two switches and no minute pickers. The rungs are a pair, and exposing the
 * intervals would ask an owner to tune a number they have no data for while
 * making the feature look like a configuration exercise rather than a promise.
 * *Applying: Chunking, and Smart Defaults — the product ships with an opinion
 * instead of an empty form.*
 */
export function LeadChaseCard() {
  const company = useCompany();
  const update = useUpdateCompany();
  const { role } = useActiveCompany();
  const canEdit = role === "owner" || role === "admin";
  const [error, setError] = useState<string | null>(null);

  function toggle(
    key: "lead_chase_enabled" | "lead_chase_crew_enabled",
    value: boolean,
  ) {
    setError(null);
    update.mutate(
      { [key]: value },
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

  if (company.isPending) {
    return <Skeleton className="h-40 w-full rounded-lg" />;
  }
  if (company.isError || !company.data) return null;

  const chasing = company.data.lead_chase_enabled;

  return (
    <SettingsCard
      title="Chasing unanswered leads"
      description="Applies to everyone in the workspace. Only owners and admins can change it."
    >
      <div className="space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-0.5">
            <Label htmlFor="lead-chase" className="text-sm font-medium">
              Buzz again after {LEAD_CHASE_NUDGE_MINUTES} minutes
            </Label>
            <p className="text-sm text-muted-foreground">
              When a new customer texts and nobody has replied, send the same
              people one more notification. A phone in a pocket misses the
              first one, and the job usually goes to whoever answers first.
            </p>
          </div>
          <Switch
            id="lead-chase"
            checked={chasing}
            disabled={!canEdit || update.isPending}
            onCheckedChange={(checked) => toggle("lead_chase_enabled", checked)}
          />
        </div>

        <div className="flex items-start justify-between gap-4">
          <div className="space-y-0.5">
            <Label htmlFor="lead-chase-crew" className="text-sm font-medium">
              Tell the whole crew after {LEAD_CHASE_WIDEN_MINUTES} minutes
            </Label>
            <p className="text-sm text-muted-foreground">
              If a conversation is assigned to one person and they still
              haven&apos;t replied, notify everyone who can see it. This one
              reaches people who weren&apos;t told the first time, so it&apos;s
              off unless you turn it on.
            </p>
          </div>
          <Switch
            id="lead-chase-crew"
            checked={company.data.lead_chase_crew_enabled}
            // Disabled when chasing is off entirely: the second rung is only
            // ever reached through the first, so leaving it live would let an
            // owner switch on something that cannot fire.
            // *Applying: the Zen of Clarity — a control that does nothing is
            // worse than a control that isn't there.*
            disabled={!canEdit || !chasing || update.isPending}
            onCheckedChange={(checked) =>
              toggle("lead_chase_crew_enabled", checked)
            }
          />
        </div>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <p className="text-xs text-muted-foreground">
          Only during your business hours, and never to anyone who has turned
          their own notifications off. Outside hours your away reply answers
          instead.
        </p>
      </div>
    </SettingsCard>
  );
}
