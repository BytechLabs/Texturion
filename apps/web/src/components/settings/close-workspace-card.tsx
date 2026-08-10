"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { supportMailto } from "@loonext/shared";

import { SettingsCard } from "@/components/settings/section";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/i18n/provider";
import { useCloseWorkspace } from "@/lib/api/companies";
import { useActionConfirmation } from "@/lib/hooks/use-action-confirmation";
import { HandoverConfirmDialog } from "@/components/ownership/handover-confirm-dialog";
import { ApiError } from "@/lib/api/error";
import type { CompanyView } from "@/lib/api/types";
import { formatAbsoluteDateTime } from "@/lib/format/time";
import { endSessionOnThisDevice } from "@/lib/auth/end-session";
import { getSupabaseBrowser } from "@/lib/supabase/browser";

/**
 * #341 / D48 — closing the workspace, and saying what that means first.
 *
 * The consequence copy here is the feature, not decoration. "Deleted now" and
 * "deleted in 30 days" are different promises and only the second one is
 * keepable, so this says which. It also says the two things that outlive the
 * workspace — a STOP stays on the do-not-text list, and a stripped record that
 * consent existed is kept for three years — because a deletion screen that
 * implies total erasure is making a promise the law does not let us keep.
 *
 * The name must be typed. This is the one place in the product where a
 * deliberate pause is right: it ends the business's account, releases their
 * number for good, and after 30 days nobody can undo it.
 */
export function CloseWorkspaceCard({ company }: { company: CompanyView }) {
  const t = useT();
  const router = useRouter();
  const close = useCloseWorkspace();
  // #537 audit: this file's own copy calls the closure irreversible after 30 days,
  // and the number release irreversible immediately. Being the owner is what a
  // stolen session already is, so the server now asks who this actually is.
  const gate = useActionConfirmation();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");

  const confirmed = typed.trim() === company.name.trim();

  async function confirm(code?: string) {
    close.mutate(code, {
      onSuccess: async (result) => {
        // The gate cannot see a mutation succeed, so it is told — first, before
        // anything below is awaited. Every sibling call site dismisses on
        // success; this one did not, and the cost here is worse than a stale
        // dialog. Ending the session is a real round trip (push release, session
        // revoke, GoTrue sign-out) and the redirect waits on it, so the code
        // prompt stayed on screen with Confirm live over a workspace that had
        // ALREADY been closed. A second press fired a third `close.mutate` and a
        // second Supabase challenge — a double-fire on the one action nobody can
        // undo after 30 days.
        gate.dismiss();
        setOpen(false);
        // The session is already dead server-side; clear this browser too so
        // nothing lingers on a shared machine.
        await endSessionOnThisDevice(company.id);
        const when = result.purge_after
          ? formatAbsoluteDateTime(result.purge_after)
          : t("settings.closeWorkspaceInThirtyDays");
        // #371: the toast is the last thing they see before being signed out,
        // so it has to say where the details went. Only claimed when the send
        // actually landed — pointing someone at an inbox with nothing in it is
        // worse than saying nothing.
        toast.success(
          t("settings.closeWorkspaceDone", { when }),
          result.receipt_emailed
            ? { description: t("settings.closeWorkspaceReceipt") }
            : undefined,
        );
        router.replace("/login");
      },
      onError: (cause) => {
        if (gate.demanded(cause, "close_workspace", (digits) => void confirm(digits))) {
          return;
        }
        gate.dismiss();
        toast.error(
          cause instanceof ApiError
            ? cause.message
            : t("settings.closeWorkspaceFailed"),
        );
      },
    });
  }

  return (
    <SettingsCard
      title={t("settings.closeWorkspaceTitle")}
      description={t("settings.closeWorkspaceDescription")}
    >
      <div className="space-y-4 p-4 pt-0">
        <ul className="space-y-1.5 text-sm text-muted-foreground">
          {/* #413: "released" reads as "gone". It is not — the number goes back
              to the phone company and can be given to another business, so the
              customers who have it saved end up texting a stranger. Saying so is
              the same standard DELETION.md sets for data, applied to numbers, and
              it is the only version of this sentence somebody can act on. */}
          <li>{t("settings.closeWorkspaceNumberReleased")}</li>
          <li>
            {t("settings.closeWorkspacePortLead")}{" "}
            <span className="font-medium text-foreground">
              {t("settings.closeWorkspacePortEmphasis")}
            </span>
            {t("settings.closeWorkspacePortTail")}
          </li>
          <li>{t("settings.closeWorkspaceBilling")}</li>
          <li>
            {t("settings.closeWorkspaceUndoLead")}{" "}
            {/* #382: this sentence promised a human on the one screen with no
                route to one. A high-stakes irreversible action has to offer a
                genuine way back, not the description of one. */}
            <a
              className="font-medium underline underline-offset-2 hover:no-underline"
              href={supportMailto({
                companyId: company.id,
                companyName: company.name,
                plan: company.plan,
                platform: "web",
                subject: `Please undo the closure of ${company.name}`,
              })}
            >
              {t("settings.closeWorkspaceEmailUs")}
            </a>{" "}
            {t("settings.closeWorkspaceUndoTail")}
          </li>
          <li>{t("settings.closeWorkspaceStopKept")}</li>
          <li>{t("settings.closeWorkspaceConsentRecord")}</li>
        </ul>
        <Button variant="destructive" size="sm" onClick={() => setOpen(true)}>
          {t("settings.closeWorkspaceAction")}
        </Button>
      </div>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setTyped("");
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("settings.closeWorkspaceConfirmTitle", { name: company.name })}
            </DialogTitle>
            <DialogDescription>
              {t("settings.closeWorkspaceConfirmDescription")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="close-confirm">
              {t("settings.typeToConfirmLead")}
              {" "}
              <span className="font-medium text-foreground">{company.name}</span>
              {" "}
              {t("settings.typeToConfirmTail")}
            </Label>
            <Input
              id="close-confirm"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              autoComplete="off"
              placeholder={company.name}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t("settings.closeWorkspaceKeep")}
            </Button>
            <Button
              variant="destructive"
              disabled={!confirmed || close.isPending}
              onClick={() => void confirm()}
            >
              {close.isPending
                ? t("settings.closeWorkspaceClosing")
                : t("settings.closeWorkspaceConfirmAction")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* #537 audit: the proof the server asks for before a business account ends.
          A sibling of the type-to-confirm dialog, so it stacks over it. */}
      <HandoverConfirmDialog
        kind={gate.kind}
        pending={close.isPending || gate.requesting}
        rejected={gate.rejected}
        onConfirm={gate.confirm}
        onResend={gate.resend}
        onCancel={gate.dismiss}
      />
    </SettingsCard>
  );
}
