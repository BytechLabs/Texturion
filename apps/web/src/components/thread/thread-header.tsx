"use client";

import {
  ArrowLeft,
  Ban,
  Check,
  ChevronDown,
  Images,
  Info,
  MoreHorizontal,
  OctagonAlert,
  Phone,
  Star,
  Undo2,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import { avatarColorClass, avatarInitials } from "@/components/shell/avatar-color";
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
import { useCompany } from "@/lib/api/companies";
import { useOptOutContact, useRevokeOptOut } from "@/lib/api/contacts";
import { useUpdateConversation } from "@/lib/api/conversations";
import { ApiError } from "@/lib/api/error";
import { useRequestReview } from "@/lib/api/messages";
import { useMembers } from "@/lib/api/team";
import type {
  ConversationDetail,
  ConversationStatus,
  ContactDetail,
} from "@/lib/api/types";
import { useActiveCompany } from "@/lib/company/provider";
import { contactDisplayName, formatPhone } from "@/lib/format/phone";
import { cn } from "@/lib/utils";

import { reviewConfirmCopy, type ReviewConfirmCopy } from "./review-confirm";

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
  onOpenGallery,
}: {
  conversation: ConversationDetail;
  contact: ContactDetail | undefined;
  onToggleContactPanel: () => void;
  panelOpen: boolean;
  /** Open the attachments gallery — §5.2 single entry point. */
  onOpenGallery: () => void;
}) {
  const update = useUpdateConversation(conversation.id);
  const optOut = useOptOutContact();
  const revokeOptOut = useRevokeOptOut();
  const members = useMembers();
  const memberNames = useMemberNames();
  const { userId } = useActiveCompany();
  const company = useCompany();
  const requestReview = useRequestReview(conversation.id);
  const [confirmOptOut, setConfirmOptOut] = useState(false);
  const [reviewConfirm, setReviewConfirm] = useState<ReviewConfirmCopy | null>(
    null,
  );

  // FEATURE-GAPS Step 2 — the one-tap "Ask for a review" action. Cheap client
  // suppressions (disabled with a reason): no review link on file, or the
  // contact is opted out. The one-per-job "already asked / replied since"
  // suppression is the server's atomic decision (409) — surfaced as a toast.
  // The Step 0b quiet-hours + cold-thread gate answers the composer's stable
  // `quiet_hours_confirmation_required` code (409, matched structurally) —
  // that one opens the confirm dialog instead, and confirming retries the
  // send with quiet_hours_confirmed, exactly like the composer.
  const reviewLink = company.data?.google_review_link ?? null;
  const reviewDisabledReason = !reviewLink
    ? "Add your Google review link in Settings → Reviews first."
    : contact?.opted_out
      ? "This contact has opted out of texts."
      : null;

  const sendReview = (quietConfirmed: boolean) => {
    if (reviewDisabledReason) {
      toast.error(reviewDisabledReason);
      return;
    }
    requestReview.mutate(
      quietConfirmed ? { quiet_hours_confirmed: true } : undefined,
      {
        onSuccess: () => toast.success("Review request sent."),
        onError: (e) => {
          if (
            e instanceof ApiError &&
            e.code === "quiet_hours_confirmation_required"
          ) {
            setReviewConfirm(reviewConfirmCopy(conversation.contact.phone_e164));
            return;
          }
          onApiError(e, "Couldn't send the review request. Try again.");
        },
      },
    );
  };
  const askForReview = () => sendReview(false);

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

  const phone = conversation.contact.phone_e164;

  return (
    <header className="flex items-center gap-2 border-b border-app-line bg-app-white px-2 py-2.5 md:gap-3 md:px-4">
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

      {/* Colored-initial avatar (stable per contact), matching the list/panel. */}
      <span
        aria-hidden
        className={cn(
          "hidden size-[42px] shrink-0 place-items-center rounded-[13px] text-[14px] font-bold text-app-petrol-deep sm:grid",
          avatarColorClass(conversation.contact_id || name),
        )}
      >
        {avatarInitials(name)}
      </span>

      <button
        type="button"
        onClick={onToggleContactPanel}
        className="min-w-0 flex-1 rounded-md px-1 py-0.5 text-left transition-colors duration-150 ease-out hover:bg-app-stone-1"
        aria-label={`View contact details for ${name}`}
      >
        <span className="block truncate text-[15px] font-bold text-app-ink">
          {name}
        </span>
        <span className="block truncate text-[12.5px] tabular-nums text-app-muted">
          {formatPhone(phone)}
        </span>
      </button>

      <div className="flex shrink-0 items-center gap-1.5">
        {/* Call — a tel: link to the contact's number. */}
        <Button
          asChild
          variant="ghost"
          size="icon-sm"
          className="hidden sm:inline-flex"
          aria-label={`Call ${name}`}
        >
          <a href={`tel:${phone}`}>
            <Phone className="size-4" strokeWidth={1.75} />
          </a>
        </Button>

        {/* Ask for a review (FEATURE-GAPS Step 2) — MANUAL one-tap only. Sends
            the saved review ask with {review_link} merged. Disabled with a
            reason (title) when there is no review link or the contact opted
            out; the one-per-job suppression is enforced server-side. */}
        <Button
          variant="ghost"
          size="icon-sm"
          className="hidden sm:inline-flex"
          aria-label="Ask for a review"
          title={reviewDisabledReason ?? "Ask for a review"}
          disabled={requestReview.isPending || reviewDisabledReason !== null}
          onClick={askForReview}
        >
          <Star className="size-4" strokeWidth={1.75} />
        </Button>

        {/* Done — the app's completion gesture (close / reopen), styled as the
            mockup's petrol-tint Done button. */}
        <button
          type="button"
          onClick={closeOrReopen}
          disabled={update.isPending}
          aria-label={closed ? "Reopen conversation" : "Mark done"}
          className="inline-flex h-[34px] items-center gap-1.5 rounded-app-ctrl border border-app-petrol bg-app-petrol px-3 text-[13px] font-semibold text-white transition-[background,border-color] duration-150 ease-out hover:border-app-petrol-deep hover:bg-app-petrol-deep disabled:opacity-50"
        >
          <Check className="size-[17px] text-white" strokeWidth={2.2} />
          {closed ? "Reopen" : "Done"}
        </button>

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
            {/* FEATURE-GAPS Step 2 — one-tap review ask, also in the overflow
                (the header Star is hidden below sm). */}
            <DropdownMenuItem
              disabled={requestReview.isPending || reviewDisabledReason !== null}
              onSelect={askForReview}
            >
              <Star className="size-4" strokeWidth={1.75} />
              Ask for a review
            </DropdownMenuItem>
            {/* §5.2: the gallery's single entry point. */}
            <DropdownMenuItem onSelect={onOpenGallery}>
              <Images className="size-4" strokeWidth={1.75} />
              View attachments
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

      {/* Review-ask confirm (FEATURE-GAPS Step 0b / SPEC §5): driven by the
          API's stable 409 `quiet_hours_confirmation_required` code — the same
          contract as the composer's quiet-hours dialog. Covers both quiet
          hours and a cold thread; confirming retries with the flag set. */}
      <Dialog
        open={reviewConfirm !== null}
        onOpenChange={(open) => !open && setReviewConfirm(null)}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{reviewConfirm?.title}</DialogTitle>
            <DialogDescription>{reviewConfirm?.description}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReviewConfirm(null)}>
              Wait
            </Button>
            <Button
              onClick={() => {
                setReviewConfirm(null);
                sendReview(true);
              }}
              disabled={requestReview.isPending}
            >
              Send
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </header>
  );
}
