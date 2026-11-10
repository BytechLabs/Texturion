"use client";

import { X } from "lucide-react";

import { useT } from "@/i18n/provider";

/**
 * #718: a link named a message that is deleted or past retention. The thread
 * opened at the newest instead, and says why rather than landing somewhere
 * with no explanation.
 */
export function AnchorMissingNotice({ onDismiss }: { onDismiss: () => void }) {
  const t = useT();
  return (
    <div className="shrink-0 px-4 pb-1 pt-2 md:px-6">
      <div
        role="status"
        className="mx-auto flex w-full max-w-[42rem] items-center justify-between gap-3 rounded-app-card border border-app-line bg-app-inset px-3 py-2 text-[13px] text-app-muted"
      >
        <span>{t("thread.messageGone")}</span>
        <button
          type="button"
          onClick={onDismiss}
          aria-label={t("thread.dismissNotice")}
          className="tap-target grid size-6 shrink-0 place-items-center rounded-full text-app-muted-2 hover:text-app-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="size-3.5" strokeWidth={1.75} aria-hidden />
        </button>
      </div>
    </div>
  );
}
