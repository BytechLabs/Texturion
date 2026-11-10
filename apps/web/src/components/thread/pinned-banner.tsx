"use client";

import { ChevronDown, Pin } from "lucide-react";
import { useEffect, useState } from "react";
import { mmsMediaKind } from "@loonext/shared";

import { useT } from "@/i18n/provider";
import type { Message } from "@/lib/api/types";
import { cn } from "@/lib/utils";

/**
 * #3 pinned-messages banner: a calm strip above the thread scroll holding the
 * pinned messages so a crew member finds the address / quote / gate code
 * without scrolling. Derived from the LOADED thread pages (a pin on a not-yet-
 * loaded older page appears once its page scrolls in; a conversation-wide pinned
 * query is a later increment). Clicking a row jumps to the source message.
 */

/** The one-line label a pinned row shows: the trimmed body, else a media note
 * derived from the first attachment's kind (#189: MMS is not photos-only). */
export function pinnedSnippet(
  message: Pick<Message, "body" | "attachments">,
): string {
  const body = message.body.trim();
  if (body !== "") return body;
  const first = message.attachments?.[0];
  if (!first) return "Attachment";
  switch (mmsMediaKind(first.content_type)) {
    case "image":
      return "Photo";
    case "audio":
      return "Audio";
    case "video":
      return "Video";
    case "contact":
      return "Contact card";
    case "calendar":
      return "Calendar invite";
    case "document":
      return "PDF";
    default:
      return "Attachment";
  }
}

/** The pinned messages, newest-pin-first (pinned_at desc). Pure — unit-tested. */
export function sortPinned(messages: readonly Message[]): Message[] {
  return messages
    .filter((m) => m.pinned_at !== null)
    .sort((a, b) => {
      const at = a.pinned_at ?? "";
      const bt = b.pinned_at ?? "";
      return at < bt ? 1 : at > bt ? -1 : 0;
    });
}

/**
 * #716: pins as a stack. One row shows the newest pin and how many more there
 * are, and opens the full list on demand; each conversation remembers whether
 * it was left open. A single pin is just that pin, one tap from the message.
 */
export function PinnedStack({
  conversationId,
  messages,
  onJump,
}: {
  conversationId: string;
  messages: Message[];
  onJump: (messageId: string) => void;
}) {
  const t = useT();
  const storageKey = `jt-pins-open:${conversationId}`;
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try {
      setOpen(localStorage.getItem(storageKey) === "1");
    } catch {
      // Remembering is a convenience; without storage it starts collapsed.
    }
  }, [storageKey]);
  if (messages.length === 0) return null;

  const [newest, ...older] = messages;
  const toggle = () =>
    setOpen((wasOpen) => {
      try {
        localStorage.setItem(storageKey, wasOpen ? "0" : "1");
      } catch {
        // As above.
      }
      return !wasOpen;
    });

  return (
    <section
      aria-label={t("thread.pinnedMessagesAria")}
      className="overflow-hidden rounded-app-card border border-app-line bg-app-paper"
    >
      {older.length === 0 ? (
        <button
          type="button"
          onClick={() => onJump(newest.id)}
          aria-label={t("thread.jumpToPinnedAria", { snippet: pinnedSnippet(newest) })}
          className="tap-target flex w-full items-center gap-2 px-3 py-2 text-left transition-colors duration-150 ease-out hover:bg-app-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <Pin className="size-3 shrink-0 text-app-muted-2" strokeWidth={2} aria-hidden />
          <span className="min-w-0 flex-1 truncate text-[13px] text-app-ink">
            {pinnedSnippet(newest)}
          </span>
          <span className="shrink-0 text-[11px] font-medium text-app-muted">{t("thread.jump")}</span>
        </button>
      ) : (
        <>
          <button
            type="button"
            aria-expanded={open}
            onClick={toggle}
            className="tap-target flex w-full items-center gap-2 px-3 py-2 text-left transition-colors duration-150 ease-out hover:bg-app-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            <Pin className="size-3 shrink-0 text-app-muted-2" strokeWidth={2} aria-hidden />
            <span className="min-w-0 flex-1 truncate text-[13px] text-app-ink">
              {pinnedSnippet(newest)}
            </span>
            <span
              className="shrink-0 rounded-full bg-app-line-soft px-1.5 text-[11px] font-semibold tabular-nums text-app-muted"
              aria-label={t("thread.morePinnedAria", { count: older.length })}
            >
              +{older.length}
            </span>
            <ChevronDown
              className={cn(
                "size-3.5 shrink-0 text-app-muted-2 transition-transform duration-150",
                open && "rotate-180",
              )}
              strokeWidth={1.75}
              aria-hidden
            />
          </button>
          {open && (
            <ul className="max-h-40 overflow-y-auto border-t border-app-line-soft pb-1">
              {messages.map((message) => (
                <li key={message.id}>
                  <button
                    type="button"
                    onClick={() => onJump(message.id)}
                    aria-label={t("thread.jumpToPinnedAria", { snippet: pinnedSnippet(message) })}
                    className="tap-target flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors duration-150 ease-out hover:bg-app-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  >
                    <span className="min-w-0 flex-1 truncate text-[13px] text-app-ink">
                      {pinnedSnippet(message)}
                    </span>
                    <span className="shrink-0 text-[11px] font-medium text-app-muted">
                      {t("thread.jump")}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
