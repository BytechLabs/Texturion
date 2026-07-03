"use client";

import {
  ArrowLeft,
  Ban,
  ChevronDown,
  Info,
  MoreHorizontal,
  OctagonAlert,
  Undo2,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import { MemberAvatar, useMemberNames } from "@/components/inbox/member-avatar";
import { StatusPill } from "@/components/inbox/status-pill";
import { Button } from "@/components/ui/button";
import { undoableToast } from "@/components/ui/optimistic-undo";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useOptOutContact, useRevokeOptOut } from "@/lib/api/contacts";
import { useUpdateConversation } from "@/lib/api/conversations";
import { ApiError } from "@/lib/api/error";
import { useMembers } from "@/lib/api/team";
import type {
  ConversationDetail,
  ConversationStatus,
  ContactDetail,
} from "@/lib/api/types";
import { useActiveCompany } from "@/lib/company/provider";
import { contactDisplayName, formatPhone } from "@/lib/format/phone";
import { cn } from "@/lib/utils";

const STATUSES: ConversationStatus[] = ["new", "open", "waiting", "closed"];

function onApiError(error: unknown, fallback: string) {
  toast.error(error instanceof ApiError ? error.message : fallback);
}

/**
 * G5 thread header: back (mobile), contact name (tap → contact panel),
 * number below, status select (inline pill dropdown), assignee select
 * (avatar menu), overflow (Close/Reopen, Mark spam, Opt out contact, View
 * contact).
 */
export function ThreadHeader({
  conversation,
  contact,
  onToggleContactPanel,
  panelOpen,
}: {
  conversation: ConversationDetail;
  contact: ContactDetail | undefined;
  onToggleContactPanel: () => void;
  panelOpen: boolean;
}) {
  const update = useUpdateConversation(conversation.id);
  const optOut = useOptOutContact();
  const revokeOptOut = useRevokeOptOut();
  const members = useMembers();
  const memberNames = useMemberNames();
  const { userId } = useActiveCompany();
  const [confirmOptOut, setConfirmOptOut] = useState(false);

  const name = contactDisplayName(conversation.contact);
  const assigneeName = conversation.assigned_user_id
    ? memberNames.get(conversation.assigned_user_id) ?? "Teammate"
    : null;
  const closed = conversation.status === "closed";

  const setStatus = (status: ConversationStatus) => {
    if (status === conversation.status) return;
    update.mutate(
      { status },
      { onError: (e) => onApiError(e, "Couldn't update the status.") },
    );
  };

  // §4/§5: close / reopen / assign / mark-spam are routine and reversible —
  // do them instantly, then offer a 5s "Undo" toast (no confirm gauntlet).
  // Each captures the prior value so Undo fires the exact inverse mutation.
  const closeOrReopen = () => {
    const wasClosed = conversation.status === "closed";
    const prev = conversation.status;
    update.mutate(
      { status: wasClosed ? "open" : "closed" },
      {
        onError: (e) => onApiError(e, "Couldn't update the status."),
        onSuccess: () =>
          undoableToast({
            message: wasClosed ? "Conversation reopened" : "Conversation closed",
            onUndo: () =>
              update.mutate(
                { status: prev },
                { onError: (e) => onApiError(e, "Couldn't undo.") },
              ),
          }),
      },
    );
  };

  const toggleSpam = () => {
    const wasSpam = conversation.is_spam;
    update.mutate(
      { is_spam: !wasSpam },
      {
        onError: (e) => onApiError(e, "Couldn't update spam."),
        onSuccess: () =>
          undoableToast({
            message: wasSpam ? "Marked as not spam" : "Marked as spam",
            onUndo: () =>
              update.mutate(
                { is_spam: wasSpam },
                { onError: (e) => onApiError(e, "Couldn't undo.") },
              ),
          }),
      },
    );
  };

  const assignTo = (userId: string | null) => {
    const prev = conversation.assigned_user_id;
    if (userId === prev) return;
    const label =
      userId === null
        ? "Unassigned"
        : `Assigned to ${memberNames.get(userId) ?? "teammate"}`;
    update.mutate(
      { assigned_user_id: userId },
      {
        onError: (e) => onApiError(e, "Couldn't assign."),
        onSuccess: () =>
          undoableToast({
            message: label,
            onUndo: () =>
              update.mutate(
                { assigned_user_id: prev },
                { onError: (e) => onApiError(e, "Couldn't undo.") },
              ),
          }),
      },
    );
  };

  return (
    <header className="flex items-center gap-2 border-b border-border bg-background px-2 py-2 md:px-4">
      <Button
        asChild
        variant="ghost"
        size="icon-sm"
        className="md:hidden"
        aria-label="Back to inbox"
      >
        <Link href="/inbox">
          <ArrowLeft className="size-4" strokeWidth={1.75} />
        </Link>
      </Button>

      <button
        type="button"
        onClick={onToggleContactPanel}
        className="min-w-0 flex-1 rounded-md px-1 py-0.5 text-left transition-colors duration-150 ease-out hover:bg-secondary/60"
        aria-label={`View contact details for ${name}`}
      >
        {/* §3.2: the customer's name is near-black but 500-weight (the thread
            body is the hero, not the header); the number recedes to 13px
            stone-500. No petrol anywhere in this header. */}
        <span className="block truncate text-sm font-medium text-foreground">
          {name}
        </span>
        <span className="block truncate text-[13px] tabular-nums text-muted-foreground">
          {formatPhone(conversation.contact.phone_e164)}
        </span>
      </button>

      <div className="flex shrink-0 items-center gap-1.5">
        {/* Status: inline pill dropdown. */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`Status: ${conversation.status}. Change status`}
              // min sizes below md: the G11 ≥44px mobile hit-target bar.
              className="flex min-h-11 items-center gap-0.5 rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 md:min-h-0"
              disabled={update.isPending}
            >
              <StatusPill status={conversation.status} />
              <ChevronDown
                className="size-3 text-foreground-tertiary"
                strokeWidth={1.75}
                aria-hidden
              />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {STATUSES.map((status) => (
              <DropdownMenuItem
                key={status}
                onSelect={() => setStatus(status)}
                className={cn(
                  status === conversation.status && "bg-secondary",
                )}
              >
                <StatusPill status={status} />
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Assignee: avatar menu. */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={
                assigneeName ? `Assigned to ${assigneeName}. Reassign` : "Assign"
              }
              className="flex min-h-11 min-w-11 items-center justify-center rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 md:min-h-0 md:min-w-0"
              disabled={update.isPending}
            >
              {assigneeName ? (
                <MemberAvatar name={assigneeName} className="size-6" />
              ) : (
                <span className="flex size-6 items-center justify-center rounded-full border border-dashed border-border text-muted-foreground">
                  <UserRound className="size-3.5" strokeWidth={1.75} />
                </span>
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Assign to</DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => assignTo(null)}>
              Unassigned
            </DropdownMenuItem>
            {(members.data?.data ?? [])
              .filter((m) => m.deactivated_at === null)
              .map((member) => (
                <DropdownMenuItem
                  key={member.user_id}
                  onSelect={() => assignTo(member.user_id)}
                >
                  <MemberAvatar
                    name={member.display_name || "Teammate"}
                    className="size-5"
                  />
                  {member.display_name || "Teammate"}
                  {member.user_id === userId ? " (you)" : ""}
                </DropdownMenuItem>
              ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Contact panel toggle (persisted on desktop). */}
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onToggleContactPanel}
          aria-label={panelOpen ? "Hide contact details" : "Show contact details"}
          aria-pressed={panelOpen}
          className={cn("hidden md:inline-flex", panelOpen && "bg-secondary")}
        >
          <Info className="size-4" strokeWidth={1.75} />
        </Button>

        {/* Overflow. */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="More actions">
              <MoreHorizontal className="size-4" strokeWidth={1.75} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={closeOrReopen}>
              <Undo2 className="size-4" strokeWidth={1.75} />
              {closed ? "Reopen conversation" : "Close conversation"}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={toggleSpam}>
              <OctagonAlert className="size-4" strokeWidth={1.75} />
              {conversation.is_spam ? "Not spam" : "Mark as spam"}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onToggleContactPanel}>
              <UserRound className="size-4" strokeWidth={1.75} />
              View contact
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {contact?.opted_out ? (
              <DropdownMenuItem
                onSelect={() =>
                  revokeOptOut.mutate(conversation.contact_id, {
                    onSuccess: () => toast.success("Marked opted in again."),
                    onError: (e) => onApiError(e, "Couldn't update opt-out."),
                  })
                }
              >
                <Undo2 className="size-4" strokeWidth={1.75} />
                Mark opted in again
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => setConfirmOptOut(true)}
              >
                <Ban className="size-4" strokeWidth={1.75} />
                Opt out contact
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Dialog open={confirmOptOut} onOpenChange={setConfirmOptOut}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Opt out {name}?</DialogTitle>
            <DialogDescription>
              They won&apos;t receive texts from you anymore. Use this when a
              customer asks to stop hearing from you in any words.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOptOut(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={optOut.isPending}
              onClick={() =>
                optOut.mutate(conversation.contact_id, {
                  onSuccess: () => {
                    setConfirmOptOut(false);
                    toast.success("Contact opted out.");
                  },
                  onError: (e) => onApiError(e, "Couldn't opt out the contact."),
                })
              }
            >
              {optOut.isPending ? "Opting out…" : "Opt out"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </header>
  );
}
