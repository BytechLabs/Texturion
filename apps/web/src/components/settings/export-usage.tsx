"use client";

import { FileSpreadsheet } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import {
  capabilitiesOf,
  EXPORT_USAGE_ACTION,
  EXPORT_USAGE_BLURB,
  EXPORT_USAGE_NOTE,
  lastCompleteMonth,
  USAGE_EXPORT_CAPABILITY,
} from "@loonext/shared";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/i18n/provider";
import { ApiError } from "@/lib/api/error";
import { useExportUsage } from "@/lib/api/exports";
import { useActiveCompany } from "@/lib/company/provider";

/**
 * #304 — this workspace's metered usage for a period, as a file.
 *
 * The reader is a bookkeeper reconciling against the Stripe invoice, and the
 * detail behind that invoice has until now had no way out of the product.
 *
 * Design notes, and the principles behind them:
 *
 * - **Defaulted to LAST MONTH, never empty.** The API requires a start, so an
 *   empty pair would be a form that cannot be submitted until somebody works
 *   out what to type. Last complete calendar month is what a bookkeeper wants
 *   almost every time they open this, and it stays editable. *Applying: Smart
 *   Defaults — the default is the common case, not a blank.*
 *
 * - **Collapsed until asked for.** The usage screen already carries meters,
 *   history bars, storage, AI and the spending cap. Pulling a file is a
 *   deliberate, occasional act and does not earn permanent space above them.
 *   *Applying: Zen of Clarity — the primary view stays about the numbers.*
 *
 * - **Absent for anybody who cannot do it.** `billing.manage`, asked as a
 *   capability rather than re-derived as a rank (#315). Deliberately NOT
 *   `contacts.bulk`, which guards customer data: this document holds no
 *   customer data at all, and gating it that way would lock out the
 *   bookkeeper — the person it is for.
 *
 * - **It says what it is not.** "Not a copy of the invoice" is on the file
 *   itself, but somebody deciding whether to click needs it before they wait
 *   for an email. *Applying: Ethical Friction — the honest caveat goes where
 *   the decision is made, not where the disappointment is.*
 */
export function ExportUsage() {
  const t = useT();
  const { role } = useActiveCompany();
  const request = useExportUsage();
  const [open, setOpen] = useState(false);
  // Year and month rather than a Date: the rule is shared with two phones now,
  // and nothing about this machine's time zone should cross that boundary.
  const today = new Date();
  const initial = lastCompleteMonth(today.getFullYear(), today.getMonth() + 1);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);

  const allowed = role
    ? capabilitiesOf(role).includes(USAGE_EXPORT_CAPABILITY)
    : false;
  if (!allowed) return null;

  async function submit() {
    try {
      const result = await request.mutateAsync({
        // A date input gives a day; the API wants an instant. The END of the
        // last day, so a period typed as "the 1st to the 30th" includes the
        // 30th — which is what anybody means by it, and what a month is.
        from: new Date(`${from}T00:00:00`).toISOString(),
        to: to ? new Date(`${to}T23:59:59.999`).toISOString() : undefined,
      });
      setOpen(false);
      toast.success(
        result.already_building
          ? t("settings.exportUsageAlready")
          : t("settings.exportUsageStarted"),
      );
    } catch (cause) {
      toast.error(
        cause instanceof ApiError
          ? cause.message
          : t("settings.exportUsageFailed"),
      );
    }
  }

  if (!open) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{EXPORT_USAGE_BLURB}</p>
        <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
          <FileSpreadsheet className="size-3.5" strokeWidth={1.75} aria-hidden />
          {EXPORT_USAGE_ACTION}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-app-input border border-app-line bg-app-paper p-3">
      <p className="text-sm text-muted-foreground">{EXPORT_USAGE_BLURB}</p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label htmlFor="usage-export-from" className="text-[12px]">
            {t("settings.exportUsageFrom")}
          </Label>
          <Input
            id="usage-export-from"
            type="date"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="usage-export-to" className="text-[12px]">
            {t("settings.exportUsageTo")}
          </Label>
          <Input
            id="usage-export-to"
            type="date"
            value={to}
            onChange={(event) => setTo(event.target.value)}
          />
        </div>
      </div>
      {/* The caveat where the decision is made, not where the file lands. */}
      <p className="text-[12px] text-app-muted-2">{EXPORT_USAGE_NOTE}</p>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          disabled={request.isPending || from === ""}
          onClick={() => void submit()}
        >
          {t("settings.exportUsageStart")}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
          {t("common.cancel")}
        </Button>
      </div>
    </div>
  );
}
