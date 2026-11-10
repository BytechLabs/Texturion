"use client";

import { Merge } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useT } from "@/i18n/provider";
import { useUnmergeContact } from "@/lib/api/contacts";
import { ApiError } from "@/lib/api/error";
import type { ContactDetail } from "@/lib/api/types";
import { contactDisplayName } from "@/lib/format/phone";
import { useActiveCompany } from "@/lib/company/provider";
import { roleHasCapability } from "@loonext/shared";

/**
 * #695 - "Merged from Jane Smith (Nov 2)", and the way back.
 *
 * Shown on the SURVIVING contact for the most recent record folded into it.
 * Unmerge is gated like merge (`settings.manage`): the line is information for
 * everybody, the action only for those who could have done the merge.
 *
 * *Applying: Ethical Friction - a confirmation that says what does NOT come
 * back (the threads stay put, an opt-out stays) before the button does
 * anything. Zen of Clarity - one quiet line, and the action is a ghost button
 * rather than a banner.*
 */
export function MergedFrom({ contact }: { contact: ContactDetail }) {
  const t = useT();
  const { role } = useActiveCompany();
  const unmerge = useUnmergeContact();
  const [confirming, setConfirming] = useState(false);

  const merged = contact.merged_from;
  if (!merged) return null;

  const canUnmerge = roleHasCapability(role, "settings.manage");
  const name = contactDisplayName(
    { name: merged.name, phone_e164: merged.phone_e164 },
    t,
  );
  const date = new Intl.DateTimeFormat(t.locale, {
    month: "short",
    day: "numeric",
  }).format(new Date(merged.merged_at));

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card px-4 py-3">
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Merge className="size-4 shrink-0" strokeWidth={1.75} aria-hidden />
          {t("contacts.mergedFromLine", { name, date })}
        </p>
        {canUnmerge && (
          <Button variant="outline" size="sm" onClick={() => setConfirming(true)}>
            {t("contacts.unmergeAction")}
          </Button>
        )}
      </div>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("contacts.unmergeTitle", { name })}</DialogTitle>
            <DialogDescription>
              {t("contacts.unmergeBody", { name })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              disabled={unmerge.isPending}
              onClick={() =>
                unmerge.mutate(merged.id, {
                  onSuccess: () => {
                    setConfirming(false);
                    toast.success(t("contacts.unmerged", { name }));
                  },
                  onError: (cause) =>
                    toast.error(
                      cause instanceof ApiError
                        ? cause.message
                        : t("contacts.unmergeFailed"),
                    ),
                })
              }
            >
              {unmerge.isPending
                ? t("contacts.unmerging")
                : t("contacts.unmergeConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
