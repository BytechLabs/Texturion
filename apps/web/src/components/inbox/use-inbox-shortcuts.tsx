"use client";

import { snoozePresets } from "@loonext/shared";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { toast } from "sonner";

import { useT } from "@/i18n/provider";
import {
  useMarkConversationRead,
  useMarkConversationUnread,
  useSnoozeConversation,
} from "@/lib/api/conversations";
import { useTags } from "@/lib/api/tags";
import { useMembers } from "@/lib/api/team";
import type { ConversationListItem } from "@/lib/api/types";
import type { BulkConversationsBody } from "@/lib/inbox/bulk-selection";
import { queueThreadHeading, useInboxFocus } from "@/lib/inbox/navigation-focus";
import { useSingleKeyShortcuts } from "@/lib/inbox/shortcut-preference";
import { inboxHref } from "@/lib/inbox/thread-href";
import { requestComposerFocus, shortcutForEvent } from '@/lib/inbox/shortcuts';
import type { ShortcutAction } from '@/lib/inbox/shortcuts';
import { contactDisplayName } from "@/lib/format/phone";

import { toastSnoozed } from "../thread/snooze-menu";
import { ShortcutCheatSheet } from "./shortcut-cheat-sheet";
import { ShortcutPicker } from './shortcut-picker';
import type { PickerOption } from './shortcut-picker';

type PickerKind = "snooze" | "assign" | "tag";

/** Sentinel for "no assignee"; real ids are UUIDs so it cannot collide. */
const UNASSIGN = "__unassign__";

/**
 * #694: the keyboard layer on the inbox list.
 *
 * Owns the row cursor, the key handler and the three overlays (cheat sheet and
 * the s/a/l choosers). The key bindings live in `lib/inbox/shortcuts.ts`; this
 * only says what each action does to the list.
 */
export function useInboxShortcuts({
  rows,
  activeConversationId,
  listQuery = "",
  scrollToIndex,
  runBulkOn,
}: {
  rows: ConversationListItem[];
  activeConversationId: string | null;
  listQuery?: string;
  scrollToIndex: (index: number) => void;
  runBulkOn: (
    ids: string[],
    body: Omit<BulkConversationsBody, "ids" | "filter">,
    verb: string,
  ) => void;
}): {
  cursorId: string | null;
  announcement: string;
  overlays: ReactNode;
} {
  const t = useT();
  const router = useRouter();
  const [enabled] = useSingleKeyShortcuts();
  const [cursorId, setCursorId] = useState<string | null>(null);
  const focus = useInboxFocus();
  const [helpOpen, setHelpOpen] = useState(false);
  const [picker, setPicker] = useState<{ kind: PickerKind; id: string } | null>(null);
  const members = useMembers();
  const tags = useTags();
  const snooze = useSnoozeConversation();
  const markRead = useMarkConversationRead();
  const markUnread = useMarkConversationUnread();

  // The handler reads the latest rows and cursor without re-subscribing on
  // every render.
  const latest = useRef({
    rows,
    cursorId,
    activeConversationId,
    listQuery,
    scrollToIndex,
    runBulkOn,
    t,
  });
  useEffect(() => {
    latest.current = {
      rows,
      cursorId,
      activeConversationId,
      listQuery,
      scrollToIndex,
      runBulkOn,
      t,
    };
  });

  useEffect(() => {
    if (!enabled) return;
    const run = (action: ShortcutAction) => {
      const {
        rows: list,
        cursorId: cursor,
        activeConversationId: active,
        listQuery,
        scrollToIndex,
        runBulkOn,
        t,
      } = latest.current;
      const current = cursor ?? active;
      const index = current ? list.findIndex((row) => row.id === current) : -1;
      const row = index >= 0 ? list[index] : undefined;

      switch (action) {
        case "next":
        case "previous": {
          if (list.length === 0) return;
          const step = action === "next" ? 1 : -1;
          const target = Math.min(
            list.length - 1,
            Math.max(0, index < 0 ? (step === 1 ? 0 : list.length - 1) : index + step),
          );
          setCursorId(list[target].id);
          scrollToIndex(target);
          return;
        }
        case "help": {
          setHelpOpen(true);
          return;
        }
        case "search": {
          document
            .querySelector<HTMLInputElement>("[data-inbox-search]")
            ?.focus();
          return;
        }
      }

      if (!row) return;
      switch (action) {
        case "open": {
          if (row.id !== active) queueThreadHeading(focus, row.id);
          router.push(inboxHref({ conversationId: row.id, listQuery }));
          return;
        }
        case "reply": {
          if (row.id !== active) router.push(inboxHref({ conversationId: row.id, listQuery }));
          requestComposerFocus();
          return;
        }
        case "close": {
          const next = list[index + 1] ?? list[index - 1];
          runBulkOn([row.id], { action: "set_status", target_status: "closed" }, t("inbox.shortcutClosed"));
          setCursorId(next?.id ?? null);
          return;
        }
        case "toggleUnread": {
          const onError = () => toast.error(t("inbox.shortcutFailed"));
          if (row.unread) markRead.mutate(row.id, { onError });
          else markUnread.mutate(row.id, { onError });
          return;
        }
        case "snooze":
        case "assign":
        case "tag": {
          setPicker({ kind: action, id: row.id });
        }
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const action = shortcutForEvent(event);
      if (!action) return;
      event.preventDefault();
      run(action);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [enabled, focus, router, markRead, markUnread]);

  const cursorRow = cursorId ? rows.find((row) => row.id === cursorId) : undefined;
  const announcement = cursorRow
    ? t("inbox.rowAriaConversationWith", { name: contactDisplayName(cursorRow.contact) })
    : "";

  let overlays: ReactNode = null;
  if (picker) {
    const close = () => setPicker(null);
    if (picker.kind === "snooze") {
      const presets = snoozePresets();
      overlays = (
        <ShortcutPicker
          title={t("inbox.shortcutPickSnooze")}
          empty=""
          options={presets.map((p) => ({ id: String(p.at), label: p.label }))}
          onClose={close}
          onPick={(at) => {
            const until = new Date(Number(at)).toISOString();
            snooze.mutate(
              { conversationId: picker.id, until, kind: "snooze" },
              {
                onSuccess: () => toastSnoozed(until, "snooze", t),
                onError: () => toast.error(t("inbox.shortcutFailed")),
              },
            );
          }}
        />
      );
    } else if (picker.kind === "assign") {
      const options: PickerOption[] = [
        ...(members.data?.data ?? [])
          .filter((m) => m.deactivated_at === null)
          .map((m) => ({ id: m.user_id, label: m.display_name })),
        { id: UNASSIGN, label: t("inbox.shortcutUnassigned") },
      ];
      overlays = (
        <ShortcutPicker
          title={t("inbox.shortcutPickAssign")}
          empty=""
          options={options}
          onClose={close}
          onPick={(userId) =>
            runBulkOn(
              [picker.id],
              { action: "assign", target_user_id: userId === UNASSIGN ? null : userId },
              t("inbox.shortcutAssign"),
            )
          }
        />
      );
    } else {
      overlays = (
        <ShortcutPicker
          title={t("inbox.shortcutPickTag")}
          empty={t("inbox.shortcutNoTags")}
          options={(tags.data?.data ?? []).map((tag) => ({ id: tag.id, label: tag.name }))}
          onClose={close}
          onPick={(tagId) =>
            runBulkOn([picker.id], { action: "add_tag", target_tag_id: tagId }, t("inbox.shortcutTag"))
          }
        />
      );
    }
  }

  return {
    cursorId,
    announcement,
    overlays: (
      <>
        {overlays}
        <ShortcutCheatSheet open={helpOpen} onOpenChange={setHelpOpen} />
      </>
    ),
  };
}
