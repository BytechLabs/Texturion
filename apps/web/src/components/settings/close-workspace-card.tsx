"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

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
import { useCloseWorkspace } from "@/lib/api/companies";
import { ApiError } from "@/lib/api/error";
import type { CompanyView } from "@/lib/api/types";
import { formatAbsoluteDateTime } from "@/lib/format/time";
import { releasePushOnThisDevice } from "@/lib/push/release";
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
  const router = useRouter();
  const close = useCloseWorkspace();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");

  const confirmed = typed.trim() === company.name.trim();

  async function confirm() {
    close.mutate(undefined, {
      onSuccess: async (result) => {
        // The session is already dead server-side; clear this browser too so
        // nothing lingers on a shared machine.
        await releasePushOnThisDevice(company.id);
        await getSupabaseBrowser().auth.signOut();
        const when = result.purge_after
          ? formatAbsoluteDateTime(result.purge_after)
          : "in 30 days";
        // #371: the toast is the last thing they see before being signed out,
        // so it has to say where the details went. Only claimed when the send
        // actually landed — pointing someone at an inbox with nothing in it is
        // worse than saying nothing.
        toast.success(
          `Workspace closed. Everything is erased on ${when}.`,
          result.receipt_emailed
            ? { description: "We've emailed you the details and the date." }
            : undefined,
        );
        router.replace("/login");
      },
      onError: (cause) =>
        toast.error(
          cause instanceof ApiError
            ? cause.message
            : "Couldn't close the workspace. Try again in a moment.",
        ),
    });
  }

  return (
    <SettingsCard
      title="Close this workspace"
      description="Ends the account for everyone on it. This is not reversible after 30 days."
    >
      <div className="space-y-4 p-4 pt-0">
        <ul className="space-y-1.5 text-sm text-muted-foreground">
          <li>
            Everyone loses access straight away, and your number is released —
            you will not be able to get that number back.
          </li>
          <li>
            Billing stops today. Everything in the workspace — messages, photos,
            voicemails, contacts, tasks — is erased 30 days from now.
          </li>
          <li>
            Until then, contact us and we can undo it. After that nobody can.
          </li>
          <li>
            Anyone who replied STOP stays on the do-not-text list. That record
            is theirs, not ours, and it protects them.
          </li>
          <li>
            A record that consent existed is kept for three years, with names
            and message contents removed. That is the law we operate under.
          </li>
        </ul>
        <Button variant="destructive" size="sm" onClick={() => setOpen(true)}>
          Close this workspace
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
            <DialogTitle>Close {company.name}?</DialogTitle>
            <DialogDescription>
              Everyone is signed out now and the number is released now. The
              rest is erased in 30 days, and after that it cannot be undone by
              anyone — including us.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="close-confirm">
              {"Type "}
              <span className="font-medium text-foreground">{company.name}</span>
              {" to confirm"}
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
              Keep it
            </Button>
            <Button
              variant="destructive"
              disabled={!confirmed || close.isPending}
              onClick={() => void confirm()}
            >
              {close.isPending ? "Closing…" : "Close workspace"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsCard>
  );
}
