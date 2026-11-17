"use client";

import { Copy } from "lucide-react";
import { toast } from "sonner";

import { useT } from "@/i18n/provider";

export function CopyablePhoneNumber({ number, label = number }: { number: string; label?: string }) {
  const t = useT();
  const copyLabel = t("recordMenu.copyNumber");

  async function copy() {
    try {
      await navigator.clipboard.writeText(number);
      toast.success(t("thread.numberCopied"));
    } catch {
      toast.error(t("thread.copyFailed"));
    }
  }

  return (
    <button
      type="button"
      className="inline-flex select-all items-center gap-1.5 rounded-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={`${copyLabel}: ${label}`}
      title={copyLabel}
      onClick={copy}
    >
      {label}
      <Copy className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
    </button>
  );
}
