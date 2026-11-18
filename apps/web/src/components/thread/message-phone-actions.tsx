"use client";

import { messagePhones } from "@loonext/shared";
import Link from "next/link";
import { Fragment, useState } from "react";
import { toast } from "sonner";

import { Dialer } from "@/components/calls/dialer";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useT } from "@/i18n/provider";
import { formatPhone } from "@/lib/format/phone";

export function MessagePhoneText({ body, onSelect }: { body: string; onSelect?: (number: string) => void }) {
  if (!onSelect) return body;
  const phones = messagePhones(body);
  let offset = 0;
  return (
    <>
      {phones.map(({ start, end, e164 }) => {
        const prefix = body.slice(offset, start);
        offset = end;
        return (
          <Fragment key={start}>
            {prefix}
            <button
              type="button"
              aria-haspopup="dialog"
              className="rounded-sm underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2"
              onClick={() => onSelect(e164)}
            >
              {body.slice(start, end)}
            </button>
          </Fragment>
        );
      })}
      {body.slice(offset)}
    </>
  );
}

export function MessagePhoneActions({
  number,
  canContact,
  onClose,
}: {
  number: string;
  canContact: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const [dialer, setDialer] = useState(false);

  async function copyNumber() {
    try {
      await navigator.clipboard.writeText(number);
      toast.success(t("thread.copied"));
      onClose();
    } catch {
      toast.error(t("thread.copyFailed"));
    }
  }

  if (dialer && canContact) return <Dialer initialNumber={number} onClose={onClose} />;
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-xs" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{formatPhone(number)}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-2">
          {canContact && (
            <>
              <Button onClick={() => setDialer(true)}>{t("thread.callWithLoonext")}</Button>
              <Button asChild variant="outline">
                <Link href={`/inbox/new?to=${encodeURIComponent(number)}`} onClick={onClose}>
                  {t("shell.textAction")}
                </Link>
              </Button>
            </>
          )}
          <Button variant="outline" onClick={() => void copyNumber()}>{t("thread.copyPhoneNumber")}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
