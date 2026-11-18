"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadError } from "@/components/ui/load-error";
import { useT } from "@/i18n/provider";
import { useCustomerErasure, useEraseCustomer, type CustomerErasure } from "@/lib/api/contacts";
import { formatAbsoluteDateTime } from "@/lib/format/time";

export function CustomerErasureAction({ contactId }: { contactId: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const preview = useCustomerErasure(contactId, open);
  const erase = useEraseCustomer(contactId);
  const allowed = preview.data?.state === "ready" && !preview.data.legal_hold;

  function changeOpen(value: boolean) {
    if (erase.isPending) return;
    setOpen(value);
    setConfirmation("");
    erase.reset();
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-sm text-muted-foreground">{t("appShell.customerErasureHint")}</p>
      <Button variant="ghost" size="sm" className="text-destructive" onClick={() => changeOpen(true)}>
        {t("appShell.customerErasureAction")}
      </Button>
      <Dialog open={open} onOpenChange={changeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("appShell.customerErasureAction")}</DialogTitle>
            <DialogDescription>{t("appShell.customerErasureHint")}</DialogDescription>
          </DialogHeader>
          {preview.isPending && <p role="status">{t("appShell.contactLoading")}</p>}
          {preview.isError && <LoadError onRetry={() => preview.refetch()} />}
          {preview.data && <ErasureCounts status={preview.data} />}
          {preview.data?.legal_hold && <p role="status">{t("appShell.customerErasureHeld")}</p>}
          {allowed && (
            <div className="space-y-2">
              <Label htmlFor="customer-erasure-confirmation">{t("appShell.customerErasureConfirm")}</Label>
              <Input id="customer-erasure-confirmation" value={confirmation} disabled={erase.isPending}
                autoComplete="off" onChange={(event) => setConfirmation(event.target.value)} />
            </div>
          )}
          {erase.isError && <p role="alert" className="text-sm text-destructive">{erase.error.message}</p>}
          <DialogFooter>
            <Button variant="outline" disabled={erase.isPending} onClick={() => changeOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button variant="destructive" disabled={!allowed || confirmation !== "ERASE" || erase.isPending}
              onClick={() => erase.mutate(confirmation)}>
              {t("appShell.customerErasureAction")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ErasureCounts({ status }: { status: CustomerErasure }) {
  const t = useT();
  return <p className="text-sm">{t("appShell.customerErasureCounts", status.counts)}</p>;
}

export function CustomerErasureReceipt({ status }: { status: CustomerErasure }) {
  const t = useT();
  return (
    <section className="space-y-2 rounded-lg border bg-card p-5" aria-live="polite">
      <h1 className="font-semibold">{t(status.state === "erased" ? "appShell.customerErasureDone" : "appShell.customerErasureInProgress")}</h1>
      {status.date && (
        <time dateTime={status.date} className="block text-sm">{formatAbsoluteDateTime(status.date, undefined, t.locale)}</time>
      )}
      <ErasureCounts status={status} />
      <p className="text-sm text-muted-foreground">{t("appShell.customerErasureKept")}</p>
      {status.state === "erasing" && status.legal_hold && <p>{t("appShell.customerErasureHeld")}</p>}
    </section>
  );
}
