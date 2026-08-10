"use client";

import { FileText } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { capabilitiesOf } from "@loonext/shared";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/i18n/provider";
import { ApiError } from "@/lib/api/error";
import { useExportContactHistory } from "@/lib/api/exports";
import { useActiveCompany } from "@/lib/company/provider";

/**
 * #304 — this customer's message history, as a document.
 *
 * The case the issue opens with: a dispute or an insurance claim needs the
 * texts with one customer over a date range, it is time-sensitive, and the
 * current answer is screenshots.
 *
 * Design notes, and the principles behind them:
 *
 * - **In "Manage this contact", not beside the everyday actions.** Taking a
 *   permanent copy of somebody's correspondence out of the product is not
 *   inbox work, and it belongs with the other things you do deliberately.
 *   *Applying: Zen of Clarity — the primary view stays about the customer.*
 *
 * - **Absent for anybody who cannot do it.** `contacts.bulk`, asked as a
 *   CAPABILITY rather than re-derived as a rank: #315's whole point is that a
 *   rank is not a permission model, and "owner or admin" spelled out here
 *   would be a fourth place to keep that in step.
 *
 * - **The dates are optional and empty means everything.** A date pair is the
 *   narrowing, not the requirement — somebody who wants the whole history
 *   should not have to work out what to type to get it. *Applying: Smart
 *   Defaults — the useful default is no filter, and it costs nothing to say.*
 *
 * - **It says what happens next, before it happens.** It is built in the
 *   background and the owner is emailed about it. Both are surprises if they
 *   arrive afterwards, and the second one is the kind that makes somebody feel
 *   watched rather than protected. *Applying: Ethical Friction, on the edge
 *   that has a consequence for the person acting.*
 */
export function ExportHistory({ contactId }: { contactId: string }) {
  const t = useT();
  const { role } = useActiveCompany();
  const request = useExportContactHistory(contactId);
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const allowed = role
    ? capabilitiesOf(role).includes("contacts.bulk")
    : false;
  if (!allowed) return null;

  async function submit() {
    try {
      const result = await request.mutateAsync({
        // A date input gives a day; the API wants an instant. The start of the
        // first day and the END of the last, so a range typed as "the 1st to
        // the 31st" includes the 31st — which is what anybody means by it.
        from: from ? new Date(`${from}T00:00:00`).toISOString() : undefined,
        to: to ? new Date(`${to}T23:59:59.999`).toISOString() : undefined,
      });
      setOpen(false);
      toast.success(
        t(
          result.already_building
            ? "contacts.exportAlreadyBuilding"
            : "contacts.exportBuilding",
        ),
      );
    } catch (cause) {
      toast.error(
        cause instanceof ApiError
          ? cause.message
          : t("contacts.exportStartFailed"),
      );
    }
  }

  if (!open) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {t("contacts.exportHistoryBlurb")}
        </p>
        <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
          <FileText className="size-3.5" strokeWidth={1.75} aria-hidden />
          {t("contacts.exportHistoryAction")}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-app-input border border-app-line bg-app-paper p-3">
      <p className="text-sm text-muted-foreground">
        {t("contacts.exportHistoryBlurb")}
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label htmlFor="export-from" className="text-[12px]">
            {t("contacts.exportFrom")}
          </Label>
          <Input
            id="export-from"
            type="date"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="export-to" className="text-[12px]">
            {t("contacts.exportTo")}
          </Label>
          <Input
            id="export-to"
            type="date"
            value={to}
            onChange={(event) => setTo(event.target.value)}
          />
        </div>
      </div>
      {/* Both surprises, said before rather than after. */}
      <p className="text-[12px] text-app-muted-2">
        {t("contacts.exportHistoryNote")}
      </p>
      <div className="flex items-center gap-2">
        <Button size="sm" disabled={request.isPending} onClick={() => void submit()}>
          {t("contacts.exportStart")}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
          {t("common.cancel")}
        </Button>
      </div>
    </div>
  );
}
