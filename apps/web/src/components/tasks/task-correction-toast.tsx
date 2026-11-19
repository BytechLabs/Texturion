"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/i18n/provider";
import { useCancelScheduledMessage, useUpdateScheduledMessage } from "@/lib/api/scheduled-messages";
import type { BookingCorrection } from "@/lib/api/types";

export function showBookingCorrection(correction: BookingCorrection | undefined) {
  if (!correction) return;
  toast.custom((id) => <BookingCorrectionToast correction={correction} close={() => toast.dismiss(id)} />, {
    id: correction.id, duration: Infinity,
  });
}

function BookingCorrectionToast({ correction, close }: { correction: BookingCorrection; close: () => void }) {
  const t = useT();
  const cancel = useCancelScheduledMessage();
  const update = useUpdateScheduledMessage();
  const [draft, setDraft] = useState<string | null>(null);
  const pending = cancel.isPending || update.isPending;
  return (
    <div className="w-full space-y-2 rounded-xl border border-border bg-background p-3 text-sm shadow-lg">
      <p>{correction.recipient
        ? t("tasks.correctionQueued", { name: correction.recipient })
        : t("tasks.correctionQueuedAnonymous")}</p>
      {draft !== null && (
        <Textarea aria-label={t("tasks.correctionEdit")} value={draft}
          maxLength={1600} onChange={(event) => setDraft(event.target.value)} />
      )}
      <div className="flex flex-wrap gap-2">
        {draft === null ? (
          <Button type="button" variant="outline" size="sm" onClick={() => setDraft(correction.body)}>
            {t("tasks.correctionEdit")}
          </Button>
        ) : (
          <Button type="button" size="sm" disabled={pending || draft.trim() === ""}
            onClick={() => update.mutate({ id: correction.id, body: draft }, {
              onSuccess: close, onError: () => toast.error(t("thread.scheduledUpdateFailed")),
            })}>
            {t("common.save")}
          </Button>
        )}
        <Button type="button" variant="outline" size="sm" disabled={pending}
          onClick={() => cancel.mutate(correction.id, {
            onSuccess: close, onError: () => toast.error(t("thread.scheduledUpdateFailed")),
          })}>
          {t("tasks.correctionCancel")}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={close}>{t("common.close")}</Button>
      </div>
    </div>
  );
}
