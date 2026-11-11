"use client";

import {
  AlarmClock,
  AlarmClockOff,
  Ban,
  Bell,
  BellOff,
  BellPlus,
  BellRing,
  CalendarClock,
  CircleCheck,
  ExternalLink,
  Images,
  Mail,
  MailOpen,
  OctagonAlert,
  Pin,
  RotateCcw,
  SquareArrowOutUpRight,
  Trash2,
  Undo2,
  UserRound,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import {
  followUpPresets,
  roleHasCapability,
  snoozePresets,
  type DeferralKind,
} from "@loonext/shared";

import {
  BlockNumberDialog,
  useBlockedNumber,
} from "@/components/blocked/block-number";
import { useMemberNames } from "@/components/inbox/member-avatar";
import { DeleteConversationsDialog } from "@/components/thread/delete-conversations-dialog";
import { AiOrb } from "@/components/ui/ai-orb";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { undoableToast } from "@/components/ui/optimistic-undo";
import { useT, type Translate } from "@/i18n/provider";
import { useOptOutContact, useRevokeOptOut } from "@/lib/api/contacts";
import {
  useFollowConversation,
  useMarkConversationRead,
  useMarkConversationUnread,
  useMuteConversation,
  useSnoozeConversation,
  useUnmuteConversation,
  useUnsnoozeConversation,
  useUpdateConversation,
} from "@/lib/api/conversations";
import { ApiError } from "@/lib/api/error";
import { useMembers } from "@/lib/api/team";
import {
  isCarrierEnforcedOptOut,
  type ConversationStatus,
  type MuteDuration,
  type OptOutSource,
} from "@/lib/api/types";
import { useActiveCompany } from "@/lib/company/provider";
import { useCanDeleteRecords } from "@/lib/hooks/use-records-delete";
import { contactDisplayName } from "@/lib/format/phone";
import type { RecordAction } from "@/lib/record-actions/types";
import { useNavigate } from "@/lib/use-navigate";

import { MUTE_DURATIONS } from "./mute-menu";
import {
  SnoozeDialog,
  formatPresetHint,
  toastSnoozed,
} from "./snooze-menu";

/**
 * #712 — the conversation's ONE action list.
 *
 * The thread header's ⋯ and the inbox row's right-click / long-press menu both
 * render what `buildConversationActions` returns, so they cannot offer
 * different things for the same conversation.
 *
 * What a surface cannot offer is simply not allowed: an inbox row has no
 * gallery to open and no catch-up to run, a list row does not carry the
 * contact's opt-out state. Those three are `allowed: false` there rather than
 * a second list.
 */
export interface ConversationActionsInput {
  t: Translate;
  state: {
    status: ConversationStatus;
    isSpam: boolean;
    pinned: boolean;
    unread: boolean;
    muted: boolean;
    followed: boolean;
    snoozedUntil: string | null;
    snoozeKind: DeferralKind | null;
    assignedUserId: string | null;
    /** #722: the server's status moves for this member; absent on a list row. */
    allowedActions?: readonly string[];
  };
  members: { id: string; name: string; isYou: boolean }[];
  viewer: {
    /** `conversations.note`: status, assignment, pin, spam and block. */
    canWrite: boolean;
    /** `records.delete`. */
    canDelete: boolean;
  };
  blocked: boolean;
  unblocking: boolean;
  /** Absent where the surface does not know the contact's opt-out state. */
  optOut?: { optedOut: boolean; carrierEnforced: boolean };
  /** What this surface can offer at all. */
  surface: {
    openHref?: string;
    hasGallery: boolean;
    hasCatchUp: boolean;
  };
  run: {
    open: () => void;
    openInNewTab: () => void;
    markRead: () => void;
    markUnread: () => void;
    catchUp: () => void;
    togglePin: () => void;
    snooze: (until: string, kind: DeferralKind) => void;
    unsnooze: () => void;
    pickCustom: (kind: DeferralKind) => void;
    mute: (duration: MuteDuration) => void;
    unmute: () => void;
    toggleFollow: () => void;
    setStatus: (status: ConversationStatus) => void;
    assign: (userId: string | null) => void;
    openGallery: () => void;
    toggleSpam: () => void;
    askBlock: () => void;
    unblock: () => void;
    askDelete: () => void;
    askOptOut: () => void;
    optIn: () => void;
  };
}

function CatchUpIcon() {
  return <AiOrb size={16} />;
}

/** The status each conversation action moves a thread to. */
const STATUS_MOVES: Record<string, ConversationStatus> = {
  mark_open: "open",
  reopen: "open",
  mark_waiting: "waiting",
  close: "closed",
};

/**
 * #722: whether this member may make a status move. The server's list decides
 * where it was sent; a surface without one (a list row) falls back to the role.
 */
export function statusMoveAllowed(
  allowed: readonly string[] | undefined,
  action: string,
  canWrite: boolean,
): boolean {
  return allowed ? allowed.includes(action) : canWrite;
}

/**
 * #722: the statuses a status picker offers: the current one, and each one an
 * allowed move reaches. Without the server's list, every status for a member
 * who can write.
 */
export function statusChoices(
  current: ConversationStatus,
  allowed: readonly string[] | undefined,
  canWrite: boolean,
): ConversationStatus[] {
  const all: ConversationStatus[] = ["new", "open", "waiting", "closed"];
  if (!allowed) return canWrite ? all : [current];
  const reachable = new Set(allowed.map((action) => STATUS_MOVES[action]));
  return all.filter((status) => status === current || reachable.has(status));
}

export function buildConversationActions(
  input: ConversationActionsInput,
): RecordAction[] {
  const { t, state, viewer, run, surface } = input;
  const deferred = state.snoozedUntil !== null;
  const withPresets = (
    presets: { id: string; label: string; at: number }[],
    kind: DeferralKind,
  ) =>
    presets.map((preset) => ({
      id: preset.id,
      label: preset.label,
      trailing: formatPresetHint(preset.at, t),
      onSelect: () => run.snooze(new Date(preset.at).toISOString(), kind),
    }));

  return [
    // ---- primary: where the record lives ---------------------------------
    {
      id: "open",
      label: t("recordMenu.open"),
      icon: ExternalLink,
      group: "primary",
      allowed: surface.openHref !== undefined,
      onSelect: run.open,
    },
    {
      id: "open-new-tab",
      label: t("recordMenu.openInNewTab"),
      icon: SquareArrowOutUpRight,
      group: "primary",
      allowed: surface.openHref !== undefined,
      onSelect: run.openInNewTab,
    },

    // ---- state ------------------------------------------------------------
    state.unread
      ? {
          id: "mark-read",
          label: t("recordMenu.markRead"),
          icon: Mail,
          group: "state",
          allowed: true,
          onSelect: run.markRead,
        }
      : {
          id: "mark-unread",
          label: t("thread.markUnread"),
          icon: MailOpen,
          group: "state",
          allowed: true,
          onSelect: run.markUnread,
        },
    {
      id: "catch-up",
      label: t("thread.catchMeUp"),
      icon: CatchUpIcon,
      group: "state",
      allowed: surface.hasCatchUp,
      onSelect: run.catchUp,
    },
    {
      id: "assign",
      label: t("thread.assignTo"),
      icon: UserRound,
      group: "state",
      allowed: viewer.canWrite && input.members.length > 0,
      submenu: [
        {
          id: "unassigned",
          label: t("thread.unassigned"),
          trailing:
            state.assignedUserId === null ? t("recordMenu.currentMark") : undefined,
          onSelect: () => run.assign(null),
        },
        ...input.members.map((member) => ({
          id: member.id,
          label: `${member.name}${member.isYou ? t("thread.youSuffix") : ""}`,
          trailing:
            state.assignedUserId === member.id
              ? t("recordMenu.currentMark")
              : undefined,
          onSelect: () => run.assign(member.id),
        })),
      ],
    },
    state.status === "closed"
      ? {
          id: "reopen",
          label: t("recordMenu.reopenConversation"),
          icon: RotateCcw,
          group: "state",
          allowed: statusMoveAllowed(state.allowedActions, "reopen", viewer.canWrite),
          onSelect: () => run.setStatus("open"),
        }
      : {
          id: "close",
          label: t("recordMenu.closeConversation"),
          icon: CircleCheck,
          group: "state",
          allowed: statusMoveAllowed(state.allowedActions, "close", viewer.canWrite),
          onSelect: () => run.setStatus("closed"),
        },
    {
      id: "pin",
      label: t("thread.pinned"),
      icon: Pin,
      group: "state",
      allowed: viewer.canWrite,
      checked: state.pinned,
      keepOpen: true,
      onSelect: run.togglePin,
    },
    deferred
      ? {
          id: "unsnooze",
          label:
            state.snoozeKind === "follow_up"
              ? t("thread.cancelTheReminder")
              : t("thread.bringBackNow"),
          icon: AlarmClockOff,
          group: "state",
          allowed: true,
          onSelect: run.unsnooze,
        }
      : {
          id: "snooze",
          label: t("thread.snoozeUntilMenu"),
          icon: AlarmClock,
          group: "state",
          allowed: true,
          hint: t("thread.snoozeHint"),
          submenu: [
            ...withPresets(snoozePresets(), "snooze"),
            {
              id: "custom",
              label: t("thread.pickADate"),
              icon: CalendarClock,
              onSelect: () => run.pickCustom("snooze"),
            },
          ],
        },
    {
      id: "follow-up",
      label: t("thread.remindMeToChaseMenu"),
      icon: BellRing,
      group: "state",
      allowed: !deferred,
      submenu: [
        ...withPresets(followUpPresets(), "follow_up"),
        {
          id: "custom",
          label: t("thread.pickADate"),
          icon: CalendarClock,
          onSelect: () => run.pickCustom("follow_up"),
        },
      ],
    },

    // ---- alerts (#710: apart from Snooze, so they read as different) -------
    state.muted
      ? {
          id: "unmute",
          label: t("thread.unmute"),
          icon: Bell,
          group: "alerts",
          allowed: true,
          onSelect: run.unmute,
        }
      : {
          id: "mute",
          label: t("thread.muteMenu"),
          icon: BellOff,
          group: "alerts",
          allowed: true,
          hint: t("thread.muteHint"),
          submenu: MUTE_DURATIONS.map((duration) => ({
            id: duration.id,
            label: t(duration.label),
            onSelect: () => run.mute(duration.id),
          })),
        },
    {
      id: "follow",
      label: t(state.followed ? "thread.unfollow" : "thread.follow"),
      icon: BellPlus,
      group: "alerts",
      allowed: true,
      onSelect: run.toggleFollow,
    },

    // ---- attachments -------------------------------------------------------
    {
      id: "attachments",
      label: t("thread.viewAttachments"),
      icon: Images,
      group: "attachments",
      allowed: surface.hasGallery,
      onSelect: run.openGallery,
    },

    // ---- danger: spam, block, delete, opt-out (always last) ----------------
    {
      id: "spam",
      label: t("thread.spam"),
      icon: OctagonAlert,
      group: "danger",
      allowed: viewer.canWrite,
      checked: state.isSpam,
      keepOpen: true,
      onSelect: run.toggleSpam,
    },
    input.blocked
      ? {
          id: "unblock",
          label: t("blockedNumbers.unblockAction"),
          icon: Undo2,
          group: "danger",
          allowed: viewer.canWrite,
          disabled: input.unblocking,
          onSelect: run.unblock,
        }
      : {
          id: "block",
          label: t("blockedNumbers.blockAction"),
          icon: Ban,
          group: "danger",
          allowed: viewer.canWrite,
          onSelect: run.askBlock,
        },
    {
      id: "delete",
      label: t("trash.deleteConversation"),
      icon: Trash2,
      group: "danger",
      allowed: viewer.canDelete,
      destructive: true,
      onSelect: run.askDelete,
    },
    {
      id: "opt-in",
      label: t("thread.markOptedInAgain"),
      icon: Undo2,
      group: "danger",
      allowed: !!input.optOut?.optedOut && !input.optOut.carrierEnforced,
      onSelect: run.optIn,
    },
    {
      // A STOP the customer sent is a carrier block, and only they can lift it.
      id: "carrier-stop",
      label: t("thread.carrierStopNote"),
      group: "danger",
      allowed: !!input.optOut?.optedOut && input.optOut.carrierEnforced,
      note: true,
    },
    {
      id: "opt-out",
      label: t("thread.optOutContact"),
      icon: Ban,
      group: "danger",
      allowed: input.optOut !== undefined && !input.optOut.optedOut,
      destructive: true,
      onSelect: run.askOptOut,
    },
  ];
}

function onApiError(error: unknown, fallback: string) {
  toast.error(error instanceof ApiError ? error.message : fallback);
}

/** What the hook needs of a conversation: both the list row and the detail fit. */
export interface ConversationLike {
  id: string;
  contact_id: string;
  status: ConversationStatus;
  is_spam: boolean;
  pinned_at: string | null;
  assigned_user_id: string | null;
  muted?: boolean;
  followed?: boolean;
  snoozed_until?: string | null;
  snooze_kind?: DeferralKind | null;
  unread?: boolean;
  allowed_actions?: readonly string[];
  contact: { name: string | null; phone_e164: string };
}

/**
 * Wires a conversation's action list to the API. Returns the list, the dialogs
 * some actions open (render them OUTSIDE any menu: a Radix Dialog mounted
 * inside menu content unmounts the moment the menu closes, #293), and the
 * handlers the header's own status and assignee controls share.
 */
export function useConversationActions({
  conversation,
  optOut,
  openHref,
  onOpenGallery,
  onCatchUp,
  onDeleted,
}: {
  conversation: ConversationLike;
  /** Absent on surfaces that do not know the contact's opt-out state. */
  optOut?: { optedOut: boolean; source: OptOutSource | null };
  openHref?: string;
  onOpenGallery?: () => void;
  onCatchUp?: () => void;
  onDeleted?: () => void;
}) {
  const t = useT();
  const navigate = useNavigate();
  const update = useUpdateConversation(conversation.id);
  const markUnread = useMarkConversationUnread();
  const markRead = useMarkConversationRead();
  const snooze = useSnoozeConversation();
  const unsnooze = useUnsnoozeConversation();
  const mute = useMuteConversation();
  const unmute = useUnmuteConversation();
  const follow = useFollowConversation();
  const optOutContact = useOptOutContact();
  const revokeOptOut = useRevokeOptOut();
  const members = useMembers();
  const memberNames = useMemberNames();
  const { userId, role } = useActiveCompany();
  const canDelete = useCanDeleteRecords();
  const canWrite = roleHasCapability(role, "conversations.note");
  const blockedNumber = useBlockedNumber(conversation.contact.phone_e164);
  const [confirmOptOut, setConfirmOptOut] = useState(false);
  const [confirmBlock, setConfirmBlock] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [snoozePicker, setSnoozePicker] = useState<DeferralKind | null>(null);

  const name = contactDisplayName(conversation.contact);
  const pinned = conversation.pinned_at !== null;
  const snoozedUntil = conversation.snoozed_until ?? null;
  const snoozeKind = conversation.snooze_kind ?? null;
  const followed = conversation.followed === true;

  const setStatus = (status: ConversationStatus) => {
    if (status === conversation.status) return;
    // #295: closing removes the thread from the open inbox, the one status
    // change with no obvious way back, so it carries an Undo.
    const previous = conversation.status;
    const closing = status === "closed";
    update.mutate(
      { status },
      {
        onError: (e) => onApiError(e, t("thread.statusUpdateFailed")),
        onSuccess: closing
          ? () =>
              undoableToast({
                undoLabel: t("thread.undo"),
                message: t("thread.conversationClosed"),
                onUndo: () =>
                  update.mutate(
                    { status: previous },
                    { onError: (e) => onApiError(e, t("thread.undoFailed")) },
                  ),
              })
          : undefined,
      },
    );
  };

  const toggleSpam = () => {
    const wasSpam = conversation.is_spam;
    update.mutate(
      { is_spam: !wasSpam },
      {
        onError: (e) => onApiError(e, t("thread.spamUpdateFailed")),
        onSuccess: () =>
          undoableToast({
            undoLabel: t("thread.undo"),
            message: wasSpam
              ? t("thread.markedAsNotSpam")
              : t("thread.markedAsSpam"),
            onUndo: () =>
              update.mutate(
                { is_spam: wasSpam },
                { onError: (e) => onApiError(e, t("thread.undoFailed")) },
              ),
          }),
      },
    );
  };

  const togglePin = () => {
    update.mutate(
      { pinned: !pinned },
      {
        onError: (e) => onApiError(e, t("thread.pinUpdateFailed")),
        onSuccess: () =>
          toast.success(
            pinned
              ? t("thread.conversationUnpinned")
              : t("thread.conversationPinned"),
          ),
      },
    );
  };

  const snoozeUntil = (
    until: string,
    kind: DeferralKind = "snooze",
    note?: string,
  ) => {
    snooze.mutate(
      { conversationId: conversation.id, until, kind, note },
      {
        onError: (e) =>
          onApiError(
            e,
            kind === "follow_up"
              ? t("thread.reminderSetFailed")
              : t("thread.snoozeFailed"),
          ),
        onSuccess: () => toastSnoozed(until, kind, t),
      },
    );
  };

  const bringBack = () => {
    unsnooze.mutate(conversation.id, {
      onError: (e) => onApiError(e, t("thread.bringBackFailed")),
      onSuccess: () =>
        toast.success(
          snoozeKind === "follow_up"
            ? t("thread.reminderCancelled")
            : t("thread.backInYourInbox"),
        ),
    });
  };

  const assignTo = (assignId: string | null) => {
    const prev = conversation.assigned_user_id;
    if (assignId === prev) return;
    const label =
      assignId === null
        ? t("thread.unassigned")
        : t("thread.assignedTo", {
            name: memberNames.get(assignId) ?? t("thread.teammateLower"),
          });
    update.mutate(
      { assigned_user_id: assignId },
      {
        onError: (e) => onApiError(e, t("thread.assignFailed")),
        onSuccess: () =>
          undoableToast({
            undoLabel: t("thread.undo"),
            message: label,
            onUndo: () =>
              update.mutate(
                { assigned_user_id: prev },
                { onError: (e) => onApiError(e, t("thread.undoFailed")) },
              ),
          }),
      },
    );
  };

  const actions = buildConversationActions({
    t,
    state: {
      status: conversation.status,
      isSpam: conversation.is_spam,
      pinned,
      unread: conversation.unread === true,
      muted: conversation.muted === true,
      followed,
      snoozedUntil,
      snoozeKind,
      assignedUserId: conversation.assigned_user_id,
      allowedActions: conversation.allowed_actions,
    },
    members: (members.data?.data ?? [])
      .filter((member) => member.deactivated_at === null)
      .map((member) => ({
        id: member.user_id,
        name: member.display_name || t("thread.teammate"),
        isYou: member.user_id === userId,
      })),
    viewer: { canWrite, canDelete },
    blocked: blockedNumber.blocked !== undefined,
    unblocking: blockedNumber.unblocking,
    // A STOP the customer sent is lifted only by them: the menu offers a note, not the undo.
    optOut: optOut && {
      optedOut: optOut.optedOut,
      carrierEnforced: isCarrierEnforcedOptOut(optOut.source),
    },
    surface: {
      openHref,
      hasGallery: onOpenGallery !== undefined,
      hasCatchUp: onCatchUp !== undefined,
    },
    run: {
      open: () => openHref && navigate(openHref),
      openInNewTab: () =>
        openHref && window.open(openHref, "_blank", "noopener"),
      markRead: () =>
        markRead.mutate(conversation.id, {
          onError: (e) => onApiError(e, t("thread.markUnreadFailed")),
        }),
      markUnread: () =>
        markUnread.mutate(conversation.id, {
          onError: (e) => onApiError(e, t("thread.markUnreadFailed")),
          onSuccess: () => toast.success(t("thread.markedUnread")),
        }),
      catchUp: () => onCatchUp?.(),
      togglePin,
      snooze: snoozeUntil,
      unsnooze: bringBack,
      pickCustom: setSnoozePicker,
      mute: (duration) =>
        mute.mutate(
          { conversationId: conversation.id, duration },
          {
            onSuccess: () => toast.success(t("thread.mutedToast")),
            onError: (e) => onApiError(e, t("thread.muteFailed")),
          },
        ),
      unmute: () =>
        unmute.mutate(
          { conversationId: conversation.id },
          {
            onSuccess: () => toast.success(t("thread.unmutedToast")),
            onError: (e) => onApiError(e, t("thread.unmuteFailed")),
          },
        ),
      toggleFollow: () =>
        follow.mutate(
          { conversationId: conversation.id, follow: !followed },
          {
            onSuccess: () =>
              toast.success(
                t(followed ? "thread.unfollowedToast" : "thread.followedToast"),
              ),
            onError: (e) => onApiError(e, t("thread.followFailed")),
          },
        ),
      setStatus,
      assign: assignTo,
      openGallery: () => onOpenGallery?.(),
      toggleSpam,
      askBlock: () => setConfirmBlock(true),
      unblock: blockedNumber.unblock,
      askDelete: () => setConfirmDelete(true),
      askOptOut: () => setConfirmOptOut(true),
      optIn: () =>
        revokeOptOut.mutate(conversation.contact_id, {
          onSuccess: () => toast.success(t("thread.markedOptedInAgain")),
          onError: (e) => onApiError(e, t("thread.optOutUpdateFailed")),
        }),
    },
  });

  const dialogs = (
    <>
      <SnoozeDialog
        open={snoozePicker !== null}
        kind={snoozePicker ?? "snooze"}
        onOpenChange={(next) => setSnoozePicker(next ? "snooze" : null)}
        onConfirm={(until, note) =>
          snoozeUntil(until, snoozePicker ?? "snooze", note)
        }
      />
      {confirmBlock && (
        <BlockNumberDialog
          phone={conversation.contact.phone_e164}
          open
          onOpenChange={setConfirmBlock}
        />
      )}
      {canDelete && confirmDelete && (
        <DeleteConversationsDialog
          ids={[conversation.id]}
          open
          onOpenChange={(open) => {
            if (!open) setConfirmDelete(false);
          }}
          onDeleted={() => onDeleted?.()}
        />
      )}
      {confirmOptOut && (
        <ConfirmDialog
          open
          onOpenChange={setConfirmOptOut}
          title={t("thread.optOutTitle", { name })}
          description={t("thread.optOutDescription")}
          confirmLabel={t("thread.optOut")}
          pendingLabel={t("thread.optingOut")}
          pending={optOutContact.isPending}
          onConfirm={() =>
            optOutContact.mutate(conversation.contact_id, {
              onSuccess: () => {
                setConfirmOptOut(false);
                toast.success(t("thread.contactOptedOut"));
              },
              onError: (e) => onApiError(e, t("thread.optOutFailed")),
            })
          }
        />
      )}
    </>
  );

  return {
    actions,
    dialogs,
    setStatus,
    statusChoices: statusChoices(
      conversation.status,
      conversation.allowed_actions,
      canWrite,
    ),
    assignTo,
    bringBack,
    updating: update.isPending,
  };
}
