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
import { useT } from "@/i18n/provider";
import { ApiError } from "@/lib/api/error";
import { useSetWorkspaceMfa } from "@/lib/api/mfa";
import { useActionConfirmation } from "@/lib/hooks/use-action-confirmation";
import { HandoverConfirmDialog } from "@/components/ownership/handover-confirm-dialog";
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
  const t = useT();
  const setMfa = useSetWorkspaceMfa();
  // #537 audit: turning this OFF lowers the whole crew's protection in one silent
  // save, which is the first move somebody makes with a session they stole. Turning
  // it ON asks for nothing — friction belongs on the door that opens.
  const gate = useActionConfirmation();
  const [confirming, setConfirming] = useState(false);
  const [graceDays, setGraceDays] = useState("14");

  const enforcing = graceUntil !== null && Date.parse(graceUntil) <= Date.now();

  function apply(nextRequired: boolean, code?: string) {
    setMfa.mutate(
      nextRequired
        ? { required: true, graceDays: Number(graceDays) }
        : { required: false, code },
      {
        onSuccess: (result) => {
          gate.dismiss();
          setConfirming(false);
          toast.success(
            nextRequired
              ? result.grace_until
                ? t("settingsMore.mfaOnWithDeadline", {
                    when: formatAbsoluteDateTime(result.grace_until),
                  })
                : t("settingsMore.mfaOn")
              : t("settingsMore.mfaOff"),
          );
        },
        onError: (error) => {
          if (
            gate.demanded(error, "relax_mfa", (digits) =>
              apply(nextRequired, digits),
            )
          ) {
            return;
          }
          gate.dismiss();
          toast.error(
            error instanceof ApiError
              ? error.message
              : t("settingsMore.saveThatFailedRetry"),
          );
        },
      },
    );
  }

  return (
    <SettingsCard
      title={t("settingsMore.mfaTitle")}
      description={t("settingsMore.mfaDescription")}
    >
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-sm font-medium">
              {required
                ? enforcing
                  ? t("settingsMore.mfaStateInForce")
                  : t("settingsMore.mfaStateGrace")
                : t("settingsMore.mfaStateOff")}
            </p>
            <p className="text-sm text-muted-foreground">
              {required && graceUntil ? (
                enforcing ? (
                  <>{t("settingsMore.mfaInForceBody")}</>
                ) : (
                  <>
                    {t("settingsMore.mfaGraceBody", {
                      when: formatAbsoluteDateTime(graceUntil),
                    })}
                  </>
                )
              ) : (
                <>{t("settingsMore.mfaOffBody")}</>
              )}
            </p>
          </div>
          <Switch
            checked={required}
            disabled={setMfa.isPending}
            aria-label={t("settingsMore.mfaSwitchAria")}
            onCheckedChange={(next) => {
              if (next) setConfirming(true);
              else apply(false);
            }}
          />
        </div>

        {required && graceUntil && !enforcing && (
          <p className="rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            {t("settingsMore.mfaDeadlineFixed")}
          </p>
        )}
      </div>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("settingsMore.mfaConfirmTitle")}</DialogTitle>
            <DialogDescription>
              {t("settingsMore.mfaConfirmBody")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <span className="text-sm font-medium">
              {t("settingsMore.mfaGraceLabel")}
            </span>
            <Select value={graceDays} onValueChange={setGraceDays}>
              <SelectTrigger className="w-full sm:w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">
                  {t("settingsMore.mfaGrace7")}
                </SelectItem>
                {/* Two weeks by default: long enough to catch somebody on
                    holiday, short enough to still mean something. */}
                <SelectItem value="14">
                  {t("settingsMore.mfaGrace14")}
                </SelectItem>
                <SelectItem value="30">
                  {t("settingsMore.mfaGrace30")}
                </SelectItem>
                <SelectItem value="0">
                  {t("settingsMore.mfaGrace0")}
                </SelectItem>
              </SelectContent>
            </Select>
            {graceDays === "0" && (
              <p className="text-sm text-amber-600 dark:text-amber-500">
                {t("settingsMore.mfaGrace0Warning")}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirming(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              disabled={setMfa.isPending}
              onClick={() => apply(true)}
            >
              {t("settingsMore.mfaRequireIt")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* #537 audit: the proof the server asks for before this comes off. Never
          reached on the way on — that call is not gated. */}
      <HandoverConfirmDialog
        kind={gate.kind}
        pending={setMfa.isPending || gate.requesting}
        rejected={gate.rejected}
        onConfirm={gate.confirm}
        onResend={gate.resend}
        onCancel={gate.dismiss}
      />
    </SettingsCard>
  );
}
