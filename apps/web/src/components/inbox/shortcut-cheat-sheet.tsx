"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useT } from "@/i18n/provider";
import { INBOX_KEYMAP, type ShortcutAction } from "@/lib/inbox/shortcuts";

/** The cheat sheet reads the same keymap the key handler uses. */
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
          {ORDER.map((action) => (
            <div key={action} className="contents">
              <dt>
                <kbd className="inline-flex min-w-7 justify-center rounded-md border border-app-line bg-app-ground px-1.5 py-0.5 font-mono text-xs font-medium text-app-ink">
                  {INBOX_KEYMAP[action].cap}
                </kbd>
              </dt>
              <dd className="text-app-ink">{t(INBOX_KEYMAP[action].label)}</dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}
