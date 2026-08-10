"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { normalizeNanpInput } from "@/components/inbox/e164";
import { useT } from "@/i18n/provider";
import { ApiError } from "@/lib/api/error";
import { useCreateTextEnablement } from "@/lib/api/text-enablement";

/**
 * Start a keep-your-number text-enablement (FEATURE-GAPS voice wave, path B):
 * an owner/admin on an active subscription enters the landline they already
 * have and the order is created (POST /v1/text-enablements, client-UUID
 * Idempotency-Key via the hook). One field, honest expectations up front —
 * voice never moves, carrier review takes a few business days, texting is
 * live only when the order completes. The server re-validates the number
 * (US/CA local geographic, company country) and claims the plan slot.
 */
export function StartTextEnableDialog() {
  const t = useT();
  const create = useCreateTextEnablement();

  const [open, setOpen] = useState(false);
  const [raw, setRaw] = useState("");
  const [error, setError] = useState<string | null>(null);

  function onOpenChange(next: boolean) {
    if (!next) {
      setRaw("");
      setError(null);
    }
    setOpen(next);
  }

  async function onStart() {
    setError(null);
    const e164 = normalizeNanpInput(raw);
    if (!e164) {
      setError(t("settingsMore.textEnableNumberInvalid"));
      return;
    }
    try {
      await create.mutateAsync(e164);
      toast.success(t("settingsMore.textEnableStarted"));
      onOpenChange(false);
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : t("settingsMore.textEnableStartFailed"),
      );
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline">
          {t("settingsMore.textEnableTrigger")}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("settingsMore.textEnableDialogTitle")}</DialogTitle>
          <DialogDescription>
            {t("settingsMore.textEnableDialogBody")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="start-text-enable-number">
              {t("settingsMore.textEnableNumberLabel")}
            </Label>
            <Input
              id="start-text-enable-number"
              value={raw}
              onChange={(e) => {
                setRaw(e.target.value);
                setError(null);
              }}
              placeholder="+16135551234"
              inputMode="tel"
              autoComplete="tel"
              className="tabular-nums"
            />
            <p className="text-[13px] text-muted-foreground">
              {t("settingsMore.textEnableNumberHint")}
            </p>
          </div>

          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              onClick={() => void onStart()}
              disabled={create.isPending}
            >
              {create.isPending
                ? t("settingsMore.regStarting")
                : t("settingsMore.textEnableStartAction")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
