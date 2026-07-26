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
import { Skeleton } from "@/components/ui/skeleton";
import {
  useAccountDeletionPreview,
  useDeleteAccount,
} from "@/lib/api/account";
import { ApiError } from "@/lib/api/error";
import { releasePushOnThisDevice } from "@/lib/push/release";
import { getSupabaseBrowser } from "@/lib/supabase/browser";

/** What has to be typed. Short, unambiguous, and not a name we might change. */
const CONFIRM_WORD = "delete";

/**
 * #346 — deleting your own account.
 *
 * Apple 5.1.1(v) requires this, but the reason to build it properly is that a
 * crew member who wants to leave has had no way to: workspace deletion is the
 * owner's alone, and being removed by somebody else is not the same thing.
 *
 * The copy draws the line the implementation actually draws — your identity
 * goes, the work stays. Someone deleting their account will assume their texts
 * to customers go with them; they do not, they cannot (the business owns that
 * record, and part of it is under a legal retention floor), and finding that
 * out afterwards would be a betrayal. So it is said first.
 */
export function DeleteAccountCard() {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const preview = useAccountDeletionPreview(expanded);
  const remove = useDeleteAccount();

  const blocked = preview.data?.blocked_by === "owner";
  const owned = preview.data?.owned_workspaces ?? [];
  const confirmed = typed.trim().toLowerCase() === CONFIRM_WORD;

  async function confirm() {
    remove.mutate(undefined, {
      onSuccess: async () => {
        await releasePushOnThisDevice(null);
        await getSupabaseBrowser().auth.signOut();
        toast.success("Your account is deleted.");
        router.replace("/login");
      },
      onError: (cause) =>
        toast.error(
          cause instanceof ApiError
            ? cause.message
            : "Couldn't delete your account. Try again in a moment.",
        ),
    });
  }

  return (
    <SettingsCard
      title="Delete your account"
      description="Removes you from Loonext entirely. This cannot be undone."
    >
      <div className="space-y-4 p-4 pt-0">
        {!expanded ? (
          <Button variant="outline" size="sm" onClick={() => setExpanded(true)}>
            Delete my account
          </Button>
        ) : preview.isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : blocked ? (
          <div className="space-y-2 text-sm">
            <p>
              You own{" "}
              <strong>{owned.map((row) => row.name).join(", ")}</strong>. A
              workspace cannot be left without an owner, so hand it to someone
              else or close it first — then you can delete your account.
            </p>
            <p className="text-muted-foreground">
              Closing a workspace is on its Workspace settings page.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <ul className="space-y-1.5 text-sm text-muted-foreground">
              <li>
                You are signed out everywhere and cannot sign back in. Your
                name comes off the app, and notifications stop.
              </li>
              {preview.data && preview.data.memberships > 0 && (
                <li>
                  You leave{" "}
                  {preview.data.memberships === 1
                    ? "your workspace"
                    : `all ${preview.data.memberships} of your workspaces`}
                  {preview.data.open_conversations + preview.data.open_tasks > 0
                    ? ", and anything you are still working on goes back to the crew so nothing is lost."
                    : "."}
                </li>
              )}
              <li>
                Texts you sent to customers, jobs you logged and notes you
                wrote stay with the business. They have to — that record is
                theirs, and some of it we are required by law to keep. They
                will no longer carry your name.
              </li>
              {/* #371: said here rather than in a toast, because the moment
                  this succeeds you are signed out and there is no screen left
                  to read one on. */}
              <li>
                We email you a confirmation before your address is removed. It
                is the last thing you will get from us, and it is worth
                keeping.
              </li>
            </ul>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setOpen(true)}
              >
                Delete my account
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setExpanded(false)}
              >
                Never mind
              </Button>
            </div>
          </div>
        )}
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
            <DialogTitle>Delete your account?</DialogTitle>
            <DialogDescription>
              You will be signed out everywhere and will not be able to sign
              back in. Your work stays with the business, without your name on
              it. Nobody can undo this.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="delete-account-confirm">
              {"Type "}
              <span className="font-medium text-foreground">
                {CONFIRM_WORD}
              </span>
              {" to confirm"}
            </Label>
            <Input
              id="delete-account-confirm"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              autoComplete="off"
              placeholder={CONFIRM_WORD}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Keep my account
            </Button>
            <Button
              variant="destructive"
              disabled={!confirmed || remove.isPending}
              onClick={() => void confirm()}
            >
              {remove.isPending ? "Deleting…" : "Delete my account"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsCard>
  );
}
