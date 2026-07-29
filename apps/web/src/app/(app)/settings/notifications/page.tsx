"use client";

import { toast } from "sonner";

import { LeadChaseRow } from "@/components/settings/lead-chase-row";
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
import { ApiError } from "@/lib/api/error";
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

  function toggle(key: "email_enabled" | "push_enabled", value: boolean) {
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
  );
}
