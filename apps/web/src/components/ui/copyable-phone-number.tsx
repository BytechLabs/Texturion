"use client";

import { Copy } from "lucide-react";
import type { MouseEvent } from "react";
import { toast } from "sonner";

import { useT } from "@/i18n/provider";
import { formatPhone } from "@/lib/format/phone";
import { cn } from "@/lib/utils";

export function CopyablePhoneNumber({
  number,
  label = formatPhone(number),
  iconOnly = false,
  className,
}: {
  number: string;
  label?: string;
  iconOnly?: boolean;
  className?: string;
}) {
  const t = useT();
  const copyLabel = t("recordMenu.copyNumber");

  async function copy(event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
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
      className={cn("tap-target inline-flex select-all items-center gap-1.5 rounded-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", className)}
      aria-label={`${copyLabel}: ${label}`}
      title={copyLabel}
      onClick={copy}
    >
      {!iconOnly && label}
      <Copy className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
    </button>
  );
}
