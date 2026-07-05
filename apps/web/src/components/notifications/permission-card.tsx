"use client";

import { BellOff, BellRing } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { isIosBrowserTab, permissionRecoverySteps } from "@/lib/push/support";
import { usePushSubscription } from "@/lib/push/use-push-subscription";

/**
 * The push-permission card (G8/G9), used on /settings/notifications: a calm
 * explainer + enable button. Browser permission is requested only from here
 * (or the first-visit prompt card) — never an unprompted browser dialog.
 *
 * Every state designed (G11): checking (skeleton), unsupported (with honest
 * iOS install guidance), blocked (browser-specific recovery steps), off,
 * turning on/off (busy button), on, and inline error sentences.
 */
export function PermissionCard() {
  const push = usePushSubscription();

  // navigator/matchMedia are read after mount so server and client render
  // the same first frame.
  const [environment, setEnvironment] = useState<{
    recovery: string;
    iosTab: boolean;
  }>({ recovery: permissionRecoverySteps(""), iosTab: false });
  useEffect(() => {
    setEnvironment({
      recovery: permissionRecoverySteps(navigator.userAgent),
      iosTab: isIosBrowserTab(
        navigator.userAgent,
        window.matchMedia("(display-mode: standalone)").matches,
      ),
    });
  }, []);

  const blocked = push.permission === "denied";
  const busyLabel = push.subscribed ? "Turning off…" : "Turning on…";
  const checking = push.phase === "initializing";

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          {blocked ? (
            <BellOff className="size-4" strokeWidth={1.75} />
          ) : (
            <BellRing className="size-4" strokeWidth={1.75} />
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm font-medium">Push on this device</p>
          {checking ? (
            <div className="space-y-2 pt-1" aria-label="Checking push status">
              <Skeleton className="h-4 w-56" />
            </div>
          ) : !push.supported ? (
            <p className="text-sm text-muted-foreground">
              {environment.iosTab
                ? "On iPhone, push needs Loonext on your home screen: tap Share, choose “Add to Home Screen”, then turn notifications on from there."
                : "This browser doesn't support push notifications. Email notifications still work."}
            </p>
          ) : blocked ? (
            <p className="text-sm text-muted-foreground">
              Notifications are blocked for Loonext in this browser.{" "}
              {environment.recovery}
            </p>
          ) : push.subscribed ? (
            <p className="text-sm text-muted-foreground">
              This device gets a notification when a customer texts you.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Get a notification on this device when a customer texts you —
              even with Loonext closed.
            </p>
          )}
          {push.error && (
            <p role="alert" className="text-sm text-destructive">
              {push.error}
            </p>
          )}
        </div>
        {push.supported && !checking && !blocked && (
          <Button
            size="sm"
            variant={push.subscribed ? "outline" : "default"}
            disabled={push.pending}
            onClick={() =>
              void (push.subscribed ? push.unsubscribe() : push.subscribe())
            }
          >
            {push.pending ? busyLabel : push.subscribed ? "Turn off" : "Turn on"}
          </Button>
        )}
      </div>
    </div>
  );
}
