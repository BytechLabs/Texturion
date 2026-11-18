"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TOAST_SHORTCUT } from "@/components/ui/sonner";
import { useT } from "@/i18n/provider";
import { INBOX_KEYMAP } from '@/lib/inbox/shortcuts';
import type { ShortcutAction } from '@/lib/inbox/shortcuts';
import { CALL_SHORTCUTS } from '@/lib/softphone/shortcuts';

const ORDER: ShortcutAction[] = [
  "next",
  "previous",
  "open",
  "close",
  "snooze",
  "assign",
  "tag",
  "reply",
  "toggleUnread",
  "search",
  "help",
];
const SHORTCUTS = [
  ...ORDER.map((action) => INBOX_KEYMAP[action]),
  { cap: TOAST_SHORTCUT.cap, label: "inbox.shortcutFocusNotifications" as const },
];

export function ShortcutCheatSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("inbox.shortcutsTitle")}</DialogTitle>
          <DialogDescription>{t("inbox.shortcutsDescription")}</DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 text-sm">
          {SHORTCUTS.map(({ cap, label }) => (
            <div key={cap} className="contents">
              <dt>
                <kbd className="inline-flex min-w-7 justify-center rounded-md border border-app-line bg-app-ground px-1.5 py-0.5 font-mono text-xs font-medium text-app-ink">
                  {cap}
                </kbd>
              </dt>
              <dd className="text-app-ink">{t(label)}</dd>
            </div>
          ))}
          {Object.values(CALL_SHORTCUTS).map(({ keys, label }) => (
            <div key={keys} className="contents">
              <dt><kbd className="font-mono text-xs">{keys}</kbd></dt>
              <dd className="text-app-ink">{t(label)}</dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}
