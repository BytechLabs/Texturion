"use client";

import { toast } from "sonner";

import { LeadChaseRow } from "@/components/settings/lead-chase-row";
import { PushContentRow } from "@/components/settings/push-content-row";
import { DeliveryModesCard } from "@/components/settings/delivery-modes-card";
import { QuietHoursRow } from "@/components/settings/quiet-hours-row";
import { PermissionCard } from "@/components/notifications/permission-card";
import { EmailReachabilityCard } from "@/components/settings/email-reachability-card";
import {
  LoadError,
  SettingsCard,
  SettingsPage,
} from "@/components/settings/section";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  isOnCallNow,
  ON_CALL_SILENCE_CANCEL,
  ON_CALL_SILENCE_CONFIRM,
  onCallSilenceWarning,
} from "@loonext/shared";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ApiError } from "@/lib/api/error";
import { useMe } from "@/lib/api/me";
import { useOnCallShifts } from "@/lib/api/on-call";
import {
  useNotificationPrefs,
  useUpdateNotificationPrefs,
} from "@/lib/api/notifications";

/**
 * /settings/notifications (G8): per-user email/push toggles with sentence
 * descriptions, plus the device push-permission card (cross-track contract:
 * PermissionCard + usePushSubscription).
 */
export default function NotificationsSettingsPage() {
  const prefs = useNotificationPrefs();
  const update = useUpdateNotificationPrefs();
  // #538 (audit): am I the one holding the phone right now?
  //
  // A crew nominates somebody on call, and unclaimed leads page that person. If
  // they switch push off — reasonable on an ordinary evening — the pages still
  // fire and reach nothing, and nobody else is told. The customer texted, nobody
  // answered, and the first anyone hears is the customer going elsewhere.
  const shifts = useOnCallShifts();
  const me = useMe();
  const onCall = isOnCallNow(shifts.data ?? [], me.data?.user_id ?? "");
  const [silencing, setSilencing] = useState<"email_enabled" | "push_enabled" | null>(
    null,
  );

  function toggle(key: "email_enabled" | "push_enabled", value: boolean) {
    if (!prefs.data) return;
    // Warn, do not refuse. Somebody who wants a quiet phone is entitled to one,
    // and a product that says no is one people work around by turning the phone
    // off — which is worse, because then we cannot tell.
    if (onCall && !value) {
      setSilencing(key);
      return;
    }
    save(key, value);
  }

  function save(key: "email_enabled" | "push_enabled", value: boolean) {
    if (!prefs.data) return;
    update.mutate(
      { ...prefs.data, [key]: value },
      {
        onError: (cause) =>
          toast.error(
            cause instanceof ApiError
              ? cause.message
              : "Couldn't save that. Try again.",
          ),
      },
    );
  }

  return (
    <>
    {/* #538 (audit): the one high-stakes switch on this screen that said nothing.
        Every other irreversible-ish action in settings already named its
        consequence; going quiet while on call did not, and it is the one where
        silence IS the failure. */}
    <Dialog
      open={silencing !== null}
      onOpenChange={(open) => !open && setSilencing(null)}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>You&apos;re on call</DialogTitle>
          <DialogDescription>
            {onCallSilenceWarning(
              true,
              true,
              silencing === "push_enabled" ? "push" : "email",
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setSilencing(null)}>
            {ON_CALL_SILENCE_CANCEL}
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              const key = silencing;
              setSilencing(null);
              if (key) save(key, false);
            }}
          >
            {ON_CALL_SILENCE_CONFIRM}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <SettingsPage
      title="Notifications"
      description="How you hear about customer texts, missed calls, and teammates who need you. These are your settings; teammates set their own."
    >
      {prefs.isPending ? (
        <div className="space-y-4" aria-label="Loading notification settings">
          <Skeleton className="h-28 w-full rounded-lg" />
          <Skeleton className="h-20 w-full rounded-lg" />
        </div>
      ) : prefs.isError ? (
        <LoadError onRetry={() => prefs.refetch()} />
      ) : (
        <div className="space-y-6">
          {/* #244: with the other per-member switches, because it IS one —
              the difference from "notifications off" is that this one ends by
              itself at 7am. */}
          {/* #297: above quiet hours, because it is the broader question. How
              loud each kind of notification is comes first; when your phone is
              silent regardless is the refinement on top of it. */}
          <DeliveryModesCard
            prefs={prefs.data}
            saving={update.isPending}
            onSave={(next) => update.mutateAsync(next)}
          />
          <QuietHoursRow
            prefs={prefs.data}
            saving={update.isPending}
            onSave={(next) => update.mutateAsync(next)}
          />
          {/* #386. ABOVE the toggles, because it contradicts the one directly
              below it: an Email switch reading ON while every message bounces
              is the screen telling a comfortable lie. Renders nothing when
              email is working.
              *Applying: the Zen of Clarity — the surface is silent unless it
              has something true to say.* */}
          <EmailReachabilityCard />

          <SettingsCard title="When something needs you">
            <div className="space-y-5">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-0.5">
                  <Label htmlFor="pref-email" className="text-sm font-medium">
                    Email
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    Email you when a new conversation starts or a customer
                    texts back after a quiet spell, never one email per
                    message.
                  </p>
                </div>
                <Switch
                  id="pref-email"
                  checked={prefs.data.email_enabled}
                  onCheckedChange={(checked) =>
                    toggle("email_enabled", checked)
                  }
                />
              </div>
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-0.5">
                  <Label htmlFor="pref-push" className="text-sm font-medium">
                    Push
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    Send a notification to your devices for those same moments,
                    plus a missed call and any note where a teammate mentions
                    you. Each device also needs push turned on below.
                  </p>
                </div>
                <Switch
                  id="pref-push"
                  checked={prefs.data.push_enabled}
                  onCheckedChange={(checked) => toggle("push_enabled", checked)}
                />
              </div>

              {/* #463: no longer its own card. A whole titled section for one
                  switch is ceremony, and the owner said so.

                  The card it used to have carried a real warning though —
                  everything else on this page is per-person and this is
                  workspace-wide, and silently mixing the two would let a
                  member think they had muted something for themselves when
                  they changed it for everyone. That warning has not been
                  dropped, it has moved onto the row, which is where a reader
                  looks before touching a switch anyway.
                  *Applying: the Safety Principle — blast radius legible before
                  it is touched, not after.* */}
              <LeadChaseRow />

              {/* #430: sits with the other push settings rather than in a
                  privacy section of its own, because an owner looking for it
                  is thinking "what do my notifications show", not "what is my
                  data-protection posture". It is directly below the push
                  switch it qualifies.
                  *Applying: Relationship Strength — a control belongs beside
                  the thing it modifies.* */}
              <PushContentRow />
            </div>
          </SettingsCard>

          <PermissionCard />

          <p className="px-1 text-xs text-muted-foreground">
            Billing, usage, and registration emails always go to owners and
            admins. They can&apos;t be turned off here.
          </p>
        </div>
      )}
    </SettingsPage>
    </>
  );
}
