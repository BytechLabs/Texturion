"use client";

import {
  ArrowLeft,
  Ban,
  ChevronDown,
  Copy,
  Images,
  Info,
  MoreHorizontal,
  OctagonAlert,
  Pin,
  PinOff,
  Undo2,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import { CallButton } from "@/components/calls/call-button";
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
  DropdownMenuCheckboxItem,
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
import { useIsBelowMd } from "@/lib/use-is-below-md";
import { cn } from "@/lib/utils";

import {
  THREAD_CATEGORIES,
  THREAD_CATEGORY_LABELS,
  toggleThreadCategory,
  type ThreadFilter,
} from "./thread-filter";

const STATUSES: ConversationStatus[] = ["new", "open", "waiting", "closed"];

function onApiError(error: unknown, fallback: string) {
  toast.error(error instanceof ApiError ? error.message : fallback);
}

/**
 * G5 thread header (decluttered per issue #2): back (mobile), contact name
 * (tap → contact panel) with a copy-number button beside the number, Call, the
 * status select (the single status control), the assignee select, an Info
 * toggle (desktop) for the contact panel, and a lean overflow (spam /
 * attachments / opt-out).
 *
 * Removed: the redundant Done/Reopen bar button — "Closed" is one option in the
 * status dropdown, so the bar button just duplicated it — and the dedicated
 * "Ask for a review" action.
 */
export function ThreadHeader({
  conversation,
  contact,
  onToggleContactPanel,
  panelOpen,
  onOpenGallery,
  filter,
  onFilterChange,
}: {
  conversation: ConversationDetail;
  contact: ContactDetail | undefined;
  onToggleContactPanel: () => void;
  panelOpen: boolean;
  /** Open the attachments gallery — §5.2 single entry point. */
  onOpenGallery: () => void;
  /** #76: the in-thread view filter. On a phone the segmented bar is hidden and
   *  filtering lives in the overflow "Show" menu; desktop keeps the visible bar. */
  filter: ThreadFilter;
  onFilterChange: (next: ThreadFilter) => void;
}) {
  const update = useUpdateConversation(conversation.id);
  const optOut = useOptOutContact();
  const revokeOptOut = useRevokeOptOut();
  const members = useMembers();
  const memberNames = useMemberNames();
  const { userId } = useActiveCompany();
  const [confirmOptOut, setConfirmOptOut] = useState(false);
  // #76: the phone-only "Show" filter items are MOUNTED conditionally (not just
  // md:hidden) — a display:none menu item still lives in Radix's menu collection
  // and can silently capture typeahead ("m" → hidden "Messages" instead of "Mark
  // as spam") on a mouse-opened desktop menu. Mounting them only below md keeps
  // the desktop overflow menu byte-identical.
  const isBelowMd = useIsBelowMd();

  const name = contactDisplayName(conversation.contact);
  const assigneeName = conversation.assigned_user_id
    ? memberNames.get(conversation.assigned_user_id) ?? "Teammate"
    : null;
  const phone = conversation.contact.phone_e164;

  const copyPhone = async () => {
    try {
      await navigator.clipboard.writeText(phone);
      toast.success("Number copied.");
    } catch {
      toast.error("Couldn't copy. Your browser blocked clipboard access.");
    }
  };

  const setStatus = (status: ConversationStatus) => {
    if (status === conversation.status) return;
    update.mutate(
      { status },
      { onError: (e) => onApiError(e, "Couldn't update the status.") },
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

  // #3: pin/unpin the whole conversation to the top of the inbox. Trivially
  // reversible from the same menu, so a plain confirm toast (no undo affordance).
  const pinned = conversation.pinned_at !== null;
  const togglePin = () => {
    update.mutate(
      { pinned: !pinned },
      {
        onError: (e) => onApiError(e, "Couldn't update pin."),
        onSuccess: () =>
          toast.success(pinned ? "Conversation unpinned" : "Conversation pinned"),
      },
    );
  };

  const assignTo = (assignId: string | null) => {
    const prev = conversation.assigned_user_id;
    if (assignId === prev) return;
    const label =
      assignId === null
        ? "Unassigned"
        : `Assigned to ${memberNames.get(assignId) ?? "teammate"}`;
    update.mutate(
      { assigned_user_id: assignId },
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
    // #81: the whole header opens the contact panel, not just the name. The
    // onClick guard skips the toggle when the click lands on an interactive
    // control (buttons/links/menu triggers keep their own behavior); the name
    // and Info buttons still open it via their own handlers. It also skips
    // clicks that bubble up the React tree from PORTALED content (dropdown menu
    // items, dialogs) — those aren't DOM descendants of the header, so
    // e.currentTarget.contains(target) is false and selecting a menu item
    // never spuriously toggles the panel.
    <header
      onClick={(e) => {
        const target = e.target as HTMLElement;
        if (!e.currentTarget.contains(target)) return;
        if (target.closest("button, a")) return;
        onToggleContactPanel();
      }}
      className="flex items-center gap-2 border-b border-app-line bg-app-white px-2 py-1.5 md:gap-3 md:px-4 md:py-2.5"
    >
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

      {/* Name (tap → contact panel) + number with a copy button. */}
      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={onToggleContactPanel}
          aria-pressed={panelOpen}
          aria-label={`View contact details for ${name}, ${formatPhone(phone)}`}
          className="block max-w-full truncate rounded-md px-1 text-left text-[15px] font-bold leading-tight text-app-ink transition-colors duration-150 ease-out hover:bg-app-stone-1 md:leading-normal"
        >
          {name}
        </button>
        {/* #76: on a phone the number+copy is a duplicate second header line
            (the contact panel — one tap on the name — shows both). Hidden below
            md; the number is folded into the name button's aria-label.
            #101: an UNNAMED contact's title already IS the number, so repeating
            it here read as a glitch — the line becomes the "Add a name" door
            (the panel it opens holds the name field). */}
        <div className="hidden items-center gap-1 px-1 md:flex">
          {conversation.contact.name === null ? (
            <button
              type="button"
              onClick={onToggleContactPanel}
              className="truncate text-[12.5px] text-app-muted-2 transition-colors duration-150 ease-out hover:text-app-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Add a name
            </button>
          ) : (
            <span className="truncate text-[12.5px] tabular-nums text-app-muted">
              {formatPhone(phone)}
            </span>
          )}
          <button
            type="button"
            onClick={copyPhone}
            aria-label="Copy phone number"
            className="tap-target shrink-0 rounded p-0.5 text-app-muted-2 transition-colors duration-150 ease-out hover:text-app-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Copy className="size-3.5" strokeWidth={1.75} aria-hidden />
          </button>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        {/* Call — D38: the outbound bridge (business number presented; your
            cell rings first). #134/D42: calling is included on every plan,
            so there is no module gate. Visible at EVERY width (#133 — a
            trades owner lives on their phone; hiding this below sm left
            mobile with no way to place a call). #106: calling is outreach
            like texting, so note-level viewers get no dead control (the API
            would 403). */}
        {conversation.viewer_level === "text" && (
          <CallButton conversationId={conversation.id} contactName={name} />
        )}

        {/* Status: inline pill dropdown — the one status control (the redundant
            Done/Reopen bar button was removed; "Closed" lives in this menu). */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`Status: ${conversation.status}. Change status`}
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
                className={cn(status === conversation.status && "bg-secondary")}
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
          aria-label={
            panelOpen ? "Hide conversation info" : "Show conversation info"
          }
          aria-pressed={panelOpen}
          className={cn("hidden md:inline-flex", panelOpen && "bg-secondary")}
        >
          <Info className="size-4" strokeWidth={1.75} />
        </Button>

        {/* Overflow — spam / attachments / opt-out. */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="More actions">
              <MoreHorizontal className="size-4" strokeWidth={1.75} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {/* #76: on a phone the segmented filter bar is hidden, so filtering
                lives here as a "Show" section. Mounted only below md (not
                md:hidden) so these items never enter the desktop menu's
                typeahead/roving-focus collection. */}
            {isBelowMd && (
              <>
                {/* #89: the dedicated contact-info button is desktop-only
                    (`hidden md:inline-flex`), so on a phone opening the contact
                    panel (bottom sheet) lives here at the top of the menu. */}
                <DropdownMenuItem onSelect={onToggleContactPanel}>
                  <Info className="size-4" strokeWidth={1.75} aria-hidden />
                  Conversation info
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Show</DropdownMenuLabel>
                {/* #89: each kind is an independent toggle (mix-and-match), all
                    on by default. `onSelect`-preventDefault keeps the menu open
                    so several can be flipped in one pass. */}
                {THREAD_CATEGORIES.map((category) => (
                  <DropdownMenuCheckboxItem
                    key={category}
                    checked={filter[category]}
                    onSelect={(event) => event.preventDefault()}
                    onCheckedChange={() =>
                      onFilterChange(toggleThreadCategory(filter, category))
                    }
                  >
                    {THREAD_CATEGORY_LABELS[category]}
                  </DropdownMenuCheckboxItem>
                ))}
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem onSelect={togglePin}>
              {pinned ? (
                <PinOff className="size-4" strokeWidth={1.75} />
              ) : (
                <Pin className="size-4" strokeWidth={1.75} />
              )}
              {pinned ? "Unpin conversation" : "Pin conversation"}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={toggleSpam}>
              <OctagonAlert className="size-4" strokeWidth={1.75} />
              {conversation.is_spam ? "Not spam" : "Mark as spam"}
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
    </header>
  );
}
