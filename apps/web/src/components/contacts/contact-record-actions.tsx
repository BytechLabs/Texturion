"use client";

import {
  Ban,
  Copy,
  ExternalLink,
  MessageSquareText,
  Phone,
  Trash2,
  Undo2,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  BlockNumberDialog,
  useBlockedNumber,
} from "@/components/blocked/block-number";
import { usePlaceCall } from "@/components/calls/call-button";
import { useT, type Translate } from "@/i18n/provider";
import {
  useDeleteContact,
  useOptOutContact,
  useRevokeOptOut,
} from "@/lib/api/contacts";
import { ApiError } from "@/lib/api/error";
import { isCarrierEnforcedOptOut, type OptOutSource } from "@/lib/api/types";
import { contactDisplayName, formatPhone } from "@/lib/format/phone";
import { useCanDeleteRecords } from "@/lib/hooks/use-records-delete";
import type { RecordAction } from "@/lib/record-actions/types";
import { useNavigate } from "@/lib/use-navigate";

/**
 * #712 — the contact's ONE action list. The contact page's ⋯ and the contacts
 * list row's right-click / long-press menu both render it.
 *
 * Opt-out follows the carrier-truth rule: a STOP the customer sent is a carrier
 * block that only they can lift, so it is a note, never a button.
 */
export interface ContactActionsInput {
  t: Translate;
  optedOut: boolean;
  carrierEnforced: boolean;
  blocked: boolean;
  unblocking: boolean;
  viewer: {
    /** `conversations.note`: block and unblock. */
    canBlock: boolean;
    /** `records.delete`. */
    canDelete: boolean;
  };
  /** Absent on the contact's own page. */
  openHref?: string;
  calling: boolean;
  run: {
    open: () => void;
    text: () => void;
    call: () => void;
    copyNumber: () => void;
    askBlock: () => void;
    unblock: () => void;
    askOptOut: () => void;
    optIn: () => void;
    askDelete: () => void;
  };
}

export function buildContactActions(input: ContactActionsInput): RecordAction[] {
  const { t, run } = input;
  return [
    {
      id: "open",
      label: t("recordMenu.open"),
      icon: ExternalLink,
      group: "primary",
      allowed: input.openHref !== undefined,
      onSelect: run.open,
    },
    {
      id: "text",
      label: t("recordMenu.text"),
      icon: MessageSquareText,
      group: "primary",
      allowed: true,
      onSelect: run.text,
    },
    {
      // Opted-out contacts stay callable: STOP is SMS consent, and a requested
      // callback may be the only channel left.
      id: "call",
      label: t("recordMenu.call"),
      icon: Phone,
      group: "primary",
      allowed: true,
      disabled: input.calling,
      onSelect: run.call,
    },
    {
      id: "copy-number",
      label: t("recordMenu.copyNumber"),
      icon: Copy,
      group: "primary",
      allowed: true,
      onSelect: run.copyNumber,
    },
    input.blocked
      ? {
          id: "unblock",
          label: t("blockedNumbers.unblockAction"),
          icon: Undo2,
          group: "danger",
          allowed: input.viewer.canBlock,
          disabled: input.unblocking,
          onSelect: run.unblock,
        }
      : {
          id: "block",
          label: t("blockedNumbers.blockAction"),
          icon: Ban,
          group: "danger",
          allowed: input.viewer.canBlock,
          onSelect: run.askBlock,
        },
    {
      id: "opt-in",
      label: t("appShell.contactMarkOptedIn"),
      icon: Undo2,
      group: "danger",
      allowed: input.optedOut && !input.carrierEnforced,
      onSelect: run.optIn,
    },
    {
      id: "carrier-stop",
      label: t("appShell.contactCarrierOptOut"),
      group: "danger",
      allowed: input.optedOut && input.carrierEnforced,
      note: true,
    },
    {
      id: "opt-out",
      label: t("appShell.contactOptOutAction"),
      icon: Ban,
      group: "danger",
      allowed: !input.optedOut,
      destructive: true,
      onSelect: run.askOptOut,
    },
    {
      id: "delete",
      label: t("appShell.contactDeleteAction"),
      icon: Trash2,
      group: "danger",
      allowed: input.viewer.canDelete,
      destructive: true,
      onSelect: run.askDelete,
    },
  ];
}

/** What the hook needs of a contact: the list row and the detail both fit. */
export interface ContactLike {
  id: string;
  name: string | null;
  phone_e164: string;
  opted_out: boolean;
  opt_out_source?: OptOutSource | null;
}

/**
 * Wires a contact's action list to the API. Render `dialogs` outside any menu:
 * a dialog mounted inside menu content unmounts the moment the menu closes.
 */
export function useContactActions({
  contact,
  openHref,
  onDeleted,
}: {
  contact: ContactLike;
  openHref?: string;
  onDeleted?: () => void;
}) {
  const t = useT();
  const navigate = useNavigate();
  const canDelete = useCanDeleteRecords();
  const optOut = useOptOutContact();
  const revoke = useRevokeOptOut();
  const deleteContact = useDeleteContact();
  const blockedNumber = useBlockedNumber(contact.phone_e164);
  const { place, busy } = usePlaceCall();
  const [confirmOptOut, setConfirmOptOut] = useState(false);
  const [confirmBlock, setConfirmBlock] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const name = contactDisplayName(contact);
  const failure = (error: unknown, fallback: string) =>
    toast.error(error instanceof ApiError ? error.message : fallback);

  const actions = buildContactActions({
    t,
    optedOut: contact.opted_out,
    carrierEnforced: isCarrierEnforcedOptOut(contact.opt_out_source ?? null),
    blocked: blockedNumber.blocked !== undefined,
    unblocking: blockedNumber.unblocking,
    viewer: { canBlock: blockedNumber.canManage, canDelete },
    openHref,
    calling: busy === true,
    run: {
      open: () => openHref && navigate(openHref),
      // The compose route reuses the contact's thread on send, so this is safe
      // whether or not one exists yet.
      text: () => navigate(`/inbox/new?contact=${contact.id}`),
      call: () => place({ contactId: contact.id, contactName: name }),
      copyNumber: async () => {
        try {
          await navigator.clipboard.writeText(contact.phone_e164);
          toast.success(t("thread.numberCopied"));
        } catch {
          toast.error(t("thread.copyFailed"));
        }
      },
      askBlock: () => setConfirmBlock(true),
      unblock: blockedNumber.unblock,
      askOptOut: () => setConfirmOptOut(true),
      optIn: () =>
        revoke.mutate(contact.id, {
          onSuccess: () => toast.success(t("appShell.contactOptedBackIn")),
          onError: (e) => failure(e, t("appShell.contactOptInFailed")),
        }),
      askDelete: () => setConfirmDelete(true),
    },
  });

  const dialogs = (
    <>
      {confirmBlock && (
        <BlockNumberDialog
          phone={contact.phone_e164}
          open
          onOpenChange={setConfirmBlock}
        />
      )}
      {confirmOptOut && (
        <ConfirmDialog
          open
          onOpenChange={setConfirmOptOut}
          title={t("appShell.contactOptOutTitle")}
          description={t("appShell.contactOptOutBody", {
            phone: formatPhone(contact.phone_e164),
          })}
          confirmLabel={t("appShell.contactOptOutConfirm")}
          pendingLabel={t("appShell.contactWorking")}
          pending={optOut.isPending}
          onConfirm={() =>
            optOut.mutate(contact.id, {
              onSuccess: () => {
                setConfirmOptOut(false);
                toast.success(t("appShell.contactOptedOut"));
              },
              onError: (e) => failure(e, t("appShell.contactOptOutFailed")),
            })
          }
        />
      )}
      {confirmDelete && (
        <ConfirmDialog
          open
          onOpenChange={setConfirmDelete}
          title={t("appShell.contactDeleteTitle")}
          description={t("appShell.contactDeleteBody")}
          cancelLabel={t("appShell.contactKeepContact")}
          confirmLabel={t("common.delete")}
          pendingLabel={t("appShell.contactDeleting")}
          pending={deleteContact.isPending}
          onConfirm={() =>
            deleteContact.mutate(contact.id, {
              onSuccess: () => {
                setConfirmDelete(false);
                toast.success(t("appShell.contactDeleted"));
                onDeleted?.();
              },
              onError: (e) => failure(e, t("appShell.contactDeleteFailed")),
            })
          }
        />
      )}
    </>
  );

  return { actions, dialogs };
}
