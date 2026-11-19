"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadError } from "@/components/ui/load-error";
import { PageHeader } from "@/components/ui/page-header";
import { useT } from "@/i18n/provider";
import { useCustomerErasure, useEraseCustomer } from "@/lib/api/contacts";
import type { CustomerErasure } from "@/lib/api/contacts";
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
      <ConfirmDialog
        open={open}
        onOpenChange={changeOpen}
        title={t("appShell.customerErasureAction")}
        description={t("appShell.customerErasureHint")}
        confirmLabel={t("appShell.customerErasureAction")}
        confirmDisabled={!allowed || confirmation !== "ERASE"}
        pending={erase.isPending}
        onConfirm={() => erase.mutate(confirmation)}
      >
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
      </ConfirmDialog>
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
      <PageHeader title={t(status.state === "erased" ? "appShell.customerErasureDone" : "appShell.customerErasureInProgress")} />
      {status.date && (
        <time dateTime={status.date} className="block text-sm">{formatAbsoluteDateTime(status.date, undefined, t.locale)}</time>
      )}
      <ErasureCounts status={status} />
      <p className="text-sm text-muted-foreground">{t("appShell.customerErasureKept")}</p>
      {status.state === "erasing" && status.legal_hold && <p>{t("appShell.customerErasureHeld")}</p>}
    </section>
  );
}
