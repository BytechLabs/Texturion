"use client";

import { useState } from "react";
import { toast } from "sonner";

import { SettingsCard } from "@/components/settings/section";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ApiError } from "@/lib/api/error";
import { useSetWorkspaceMfa } from "@/lib/api/mfa";
import { formatAbsoluteDateTime } from "@/lib/format/time";

/**
 * #314 — the owner requires a second factor for the whole crew.
 *
 * The grace window is the entire safety of this control, so it is chosen
 * BEFORE the switch flips rather than tucked in afterwards: enforcement that
 * starts the instant somebody toggles a setting is how a security feature
 * becomes a crew standing in a customer's kitchen unable to open the app.
 *
 * Once set, the deadline never moves. The server refuses to extend it on a
 * later save, and this screen says so — an owner who tells their crew "you
 * have until the 12th" needs that to stay true.
 */
export function RequireTwoFactorCard({
  required,
  graceUntil,
}: {
  required: boolean;
  graceUntil: string | null;
}) {
  const setMfa = useSetWorkspaceMfa();
  const [confirming, setConfirming] = useState(false);
  const [graceDays, setGraceDays] = useState("14");

  const enforcing = graceUntil !== null && Date.parse(graceUntil) <= Date.now();

  function apply(nextRequired: boolean) {
    setMfa.mutate(
      nextRequired
        ? { required: true, graceDays: Number(graceDays) }
        : { required: false },
      {
        onSuccess: (result) => {
          setConfirming(false);
          toast.success(
            nextRequired
              ? result.grace_until
                ? `On. Everyone has until ${formatAbsoluteDateTime(result.grace_until)}.`
                : "Two-factor is now required."
              : "Two-factor is no longer required.",
          );
        },
        onError: (error) =>
          toast.error(
            error instanceof ApiError
              ? error.message
              : "Couldn't save that. Try again.",
          ),
      },
    );
  }

  return (
    <SettingsCard
      title="Require two-factor for everyone"
      description="Every person on this workspace has to set up an authenticator app. You choose how long they get."
    >
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-sm font-medium">
              {required
                ? enforcing
                  ? "Required — in force now"
                  : "Required — grace period running"
                : "Not required"}
            </p>
            <p className="text-sm text-muted-foreground">
              {required && graceUntil ? (
                enforcing ? (
                  <>
                    Anyone without it is asked to set it up before they can use
                    the workspace.
                  </>
                ) : (
                  <>
                    In force from {formatAbsoluteDateTime(graceUntil)}. Until
                    then everyone keeps working as normal.
                  </>
                )
              ) : (
                <>
                  A stolen password is enough to text your customers as you.
                  This is the setting that stops that.
                </>
              )}
            </p>
          </div>
          <Switch
            checked={required}
            disabled={setMfa.isPending}
            aria-label="Require two-factor authentication"
            onCheckedChange={(next) => {
              if (next) setConfirming(true);
              else apply(false);
            }}
          />
        </div>

        {required && graceUntil && !enforcing && (
          <p className="rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            This deadline is fixed. Saving again won&apos;t move it — so what
            you tell your crew stays true.
          </p>
        )}
      </div>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Require two-factor for everyone?</DialogTitle>
            <DialogDescription>
              Everyone gets a grace period to set it up. After that, anyone
              without it is sent to the setup screen instead of the app — so
              give the crew long enough to do it between jobs.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <span className="text-sm font-medium">Grace period</span>
            <Select value={graceDays} onValueChange={setGraceDays}>
              <SelectTrigger className="w-full sm:w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">7 days</SelectItem>
                {/* Two weeks by default: long enough to catch somebody on
                    holiday, short enough to still mean something. */}
                <SelectItem value="14">14 days (recommended)</SelectItem>
                <SelectItem value="30">30 days</SelectItem>
                <SelectItem value="0">Immediately</SelectItem>
              </SelectContent>
            </Select>
            {graceDays === "0" && (
              <p className="text-sm text-amber-600 dark:text-amber-500">
                Anyone without it right now — including you, if you have
                not set it up — is locked out of the workspace until they do.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirming(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={setMfa.isPending}
              onClick={() => apply(true)}
            >
              Require it
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsCard>
  );
}
