"use client";

import { Check, X } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";

import {
  PORT_HONEST_WINDOW,
  portabilityFailCopy,
  portabilityOkCopy,
} from "@/components/porting/copy";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { useT, type MessageKey } from "@/i18n/provider";
import { ApiError } from "@/lib/api/error";
import {
  useCheckPortability,
  useCreatePortRequest,
} from "@/lib/api/porting";
import type { Country, PortabilityCheck } from "@/lib/api/types";
import { formatPhone } from "@/lib/format/phone";

/**
 * Post-signup "bring a number" flow (PORTING.md §6 / D16): an owner/admin on an
 * active subscription starts a transfer from Settings → Numbers. Two phases in
 * one dialog — check the number (POST /v1/port-requests/check), then collect the
 * intake and create the port (POST /v1/port-requests), which starts the saga
 * immediately (creating the Telnyx draft; the owner uploads the LOA + invoice on
 * the port card and submits). Field validation mirrors the create route; the
 * server re-validates and re-runs the check as its gate.
 */

/** Normalize any typed phone to +1E.164, or null. */
function toE164(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  const ten =
    digits.length === 11 && digits.startsWith("1")
      ? digits.slice(1)
      : digits.length === 10
        ? digits
        : null;
  if (!ten || !/^[2-9]\d{2}[2-9]\d{6}$/.test(ten)) return null;
  return `+1${ten}`;
}

export function StartPortDialog({ country }: { country: Country }) {
  const t = useT();
  const check = useCheckPortability();
  const create = useCreatePortRequest();

  const [open, setOpen] = useState(false);
  const [raw, setRaw] = useState("");
  const [checked, setChecked] = useState<PortabilityCheck | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Intake fields (phase 2).
  const [entityName, setEntityName] = useState("");
  const [authPersonName, setAuthPersonName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [pinPasscode, setPinPasscode] = useState("");
  const [ssnSinLast4, setSsnSinLast4] = useState("");
  const [street, setStreet] = useState("");
  const [locality, setLocality] = useState("");
  const [adminArea, setAdminArea] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [wantsBridge, setWantsBridge] = useState(false);

  const e164 = toE164(raw);
  const isWireless = checked?.is_wireless === true;
  const ssnSinLabel =
    country === "US"
      ? t("settingsMore.startPortSsn")
      : t("settingsMore.startPortSin");
  const regionLabel: MessageKey =
    country === "US"
      ? "settingsMore.portFixState"
      : "settingsMore.portFixProvince";
  const postalLabel: MessageKey =
    country === "US"
      ? "settingsMore.portFixZip"
      : "settingsMore.portFixPostalCode";

  function reset() {
    setRaw("");
    setChecked(null);
    setError(null);
    setEntityName("");
    setAuthPersonName("");
    setAccountNumber("");
    setPinPasscode("");
    setSsnSinLast4("");
    setStreet("");
    setLocality("");
    setAdminArea("");
    setPostalCode("");
    setWantsBridge(false);
  }

  function onOpenChange(next: boolean) {
    if (!next) reset();
    setOpen(next);
  }

  async function onCheck() {
    setError(null);
    setChecked(null);
    if (!e164) {
      setError(t("settingsMore.startPortNumberInvalid"));
      return;
    }
    try {
      const result = await check.mutateAsync(e164);
      setChecked(result);
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : t("settingsMore.startPortCheckFailed"),
      );
    }
  }

  async function onCreate() {
    setError(null);
    if (!e164) return;
    if (
      !entityName.trim() ||
      !authPersonName.trim() ||
      !accountNumber.trim() ||
      !street.trim() ||
      !locality.trim() ||
      !adminArea.trim() ||
      !postalCode.trim()
    ) {
      setError(t("settingsMore.startPortFieldsMissing"));
      return;
    }
    if (isWireless && (!/^\d{4}$/.test(ssnSinLast4.trim()) || !pinPasscode.trim())) {
      setError(
        t("settingsMore.startPortWirelessMissing", { idKind: ssnSinLabel }),
      );
      return;
    }
    try {
      await create.mutateAsync({
        phone_e164: e164,
        entity_name: entityName.trim(),
        auth_person_name: authPersonName.trim(),
        account_number: accountNumber.trim(),
        service_street: street.trim(),
        service_locality: locality.trim(),
        service_admin_area: adminArea.trim(),
        service_postal_code: postalCode.trim(),
        wants_bridge_number: wantsBridge,
        ...(isWireless
          ? { pin_passcode: pinPasscode.trim(), ssn_sin_last4: ssnSinLast4.trim() }
          : {}),
      });
      toast.success(t("settingsMore.startPortStarted"));
      onOpenChange(false);
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : t("settingsMore.startPortFailed"),
      );
    }
  }

  const portable = checked?.portable === true;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline">
          {t("settingsMore.startPortTrigger")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("settingsMore.portBringNumberTitle")}</DialogTitle>
          <DialogDescription>{PORT_HONEST_WINDOW}</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="start-port-number">
              {t("settingsMore.startPortNumberLabel")}
            </Label>
            <div className="flex gap-2">
              <Input
                id="start-port-number"
                value={raw}
                onChange={(e) => {
                  setRaw(e.target.value);
                  setChecked(null);
                  setError(null);
                }}
                placeholder="(416) 555-0182"
                inputMode="tel"
                autoComplete="tel"
                className="flex-1 tabular-nums"
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => void onCheck()}
                disabled={check.isPending}
              >
                {check.isPending
                  ? t("settingsMore.regOtpChecking")
                  : t("settingsMore.startPortCheck")}
              </Button>
            </div>
          </div>

          {checked && portable ? (
            <p className="flex items-start gap-2 text-sm text-success">
              <Check className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden />
              {portabilityOkCopy(e164 ? formatPhone(e164) : raw)}
            </p>
          ) : null}
          {checked && !portable ? (
            <p className="flex items-start gap-2 text-sm text-muted-foreground">
              <X className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden />
              {portabilityFailCopy(checked.reason)}
            </p>
          ) : null}

          {portable ? (
            <div className="space-y-4 border-t border-border-subtle pt-4">
              <p className="text-sm font-medium">
                {t("settingsMore.startPortCarrierAccount")}
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t("settingsMore.startPortAccountHolder")} value={entityName} onChange={setEntityName} />
                <Field label={t("settingsMore.portFixAuthPerson")} value={authPersonName} onChange={setAuthPersonName} />
              </div>
              <Field label={t("settingsMore.portFixAccountNumber")} value={accountNumber} onChange={setAccountNumber} />

              {isWireless ? (
                <div className="grid gap-3 rounded-md border border-border bg-muted/30 p-3 sm:grid-cols-2">
                  <Field label={t("settingsMore.startPortTransferPin")} value={pinPasscode} onChange={setPinPasscode} />
                  <Field
                    label={t("settingsMore.startPortLast4", {
                      idKind: ssnSinLabel,
                    })}
                    value={ssnSinLast4}
                    onChange={(v) => setSsnSinLast4(v.replace(/\D/g, "").slice(0, 4))}
                  />
                  <p className="text-[13px] text-muted-foreground sm:col-span-2">
                    {t("settingsMore.startPortWirelessNote", {
                      idKind: ssnSinLabel,
                    })}
                  </p>
                </div>
              ) : null}

              <p className="pt-1 text-sm font-medium">
                {t("settingsMore.startPortServiceAddress")}
              </p>
              <p className="text-[13px] text-muted-foreground">
                {t("settingsMore.startPortAddressNote")}
              </p>
              <Field label={t("settingsMore.regStreetLabel")} value={street} onChange={setStreet} />
              <Field label={t("settingsMore.portFixCity")} value={locality} onChange={setLocality} />
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t(regionLabel)} value={adminArea} onChange={setAdminArea} />
                <Field label={t(postalLabel)} value={postalCode} onChange={setPostalCode} />
              </div>

              <label className="flex items-start gap-2 text-sm">
                <Checkbox
                  checked={wantsBridge}
                  onCheckedChange={(c) => setWantsBridge(c === true)}
                  className="mt-0.5"
                  aria-label={t("settingsMore.startPortBridgeAria")}
                />
                <span className="text-muted-foreground">
                  {t("settingsMore.startPortBridge")}
                </span>
              </label>
            </div>
          ) : null}

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
              onClick={() => void onCreate()}
              disabled={!portable || create.isPending}
            >
              {create.isPending
                ? t("settingsMore.regStarting")
                : t("settingsMore.startPortAction")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  // Associate the label with the input so a screen reader announces the field's
  // name and a label click focuses it (Radix Label needs htmlFor to bind).
  const id = useId();
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="off"
      />
    </div>
  );
}
