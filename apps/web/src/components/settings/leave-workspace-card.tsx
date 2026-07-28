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
import { useLeaveWorkspace } from "@/lib/api/team";
import { ApiError } from "@/lib/api/error";
import { releasePushOnThisDevice } from "@/lib/push/release";
import { getSupabaseBrowser } from "@/lib/supabase/browser";
import type { CompanyView } from "@/lib/api/types";

/**
 * #406 — leaving a workspace yourself.
 *
 * Every membership action was something done TO a member and never BY one, so
 * a tech who quit on Friday still had the customer list on Monday: the app kept
 * working until the owner remembered to open settings. The person with the
 * strongest reason to sever the connection was the only one who could not.
 *
 * Deliberately NOT in the destructive-red family that closing a workspace uses.
 * Leaving is not destruction — nothing is deleted, everything the person sent
 * stays attributed to them, and the workspace carries on without them. Dressing
 * it as demolition would misdescribe it.
 *
 * It still confirms, because it is disruptive and one tap on a phone in a truck
 * should not end somebody's access to their own work.
 * *Applying: Ethical Friction, and the Safety Principle — a consequential
 * action states its consequences before it happens, in the words they happen
 * in.*
 */
export function LeaveWorkspaceCard({ company }: { company: CompanyView }) {
  const router = useRouter();
  const leave = useLeaveWorkspace();
  const [open, setOpen] = useState(false);

  async function confirm() {
    try {
      const result = await leave.mutateAsync();
      // The seat is gone server-side; clear this device so a stale push cannot
      // arrive for a workspace the person has left.
      await releasePushOnThisDevice(company.id).catch(() => {});
      await getSupabaseBrowser().auth.signOut();
      toast.success(
        result.conversations_released + result.tasks_released > 0
          ? "You've left. Your open work went back to the team."
          : "You've left the workspace.",
      );
      router.replace("/login");
    } catch (cause) {
      setOpen(false);
      toast.error(
        cause instanceof ApiError ? cause.message : "Couldn't leave. Try again.",
      );
    }
  }

  return (
    <SettingsCard
      title="Leave this workspace"
      description="End your own access to this workspace. You can do this yourself — you don't need to ask an owner."
    >
      <div className="space-y-4">
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
          <li>
            Your access ends straight away, on every device you&rsquo;re signed
            in on.
          </li>
          <li>
            Anything you were working on goes back to the team, so nothing is
            left pointing at someone who has gone.
          </li>
          <li>
            Messages you sent stay on the record under your name. Leaving
            doesn&rsquo;t erase your work, and isn&rsquo;t meant to.
          </li>
          <li>
            To come back, someone in the workspace has to invite you again.
          </li>
        </ul>

        <div className="flex justify-end">
          <Button variant="outline" onClick={() => setOpen(true)}>
            Leave workspace
          </Button>
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Leave {company.name}?</DialogTitle>
            <DialogDescription>
              Your access ends now and your open work goes back to the team. To
              come back, someone will need to invite you again.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={leave.isPending}
            >
              Stay
            </Button>
            <Button onClick={confirm} disabled={leave.isPending}>
              {leave.isPending ? "Leaving…" : "Leave workspace"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsCard>
  );
}
