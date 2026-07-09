"use client";

import { ChevronDown, Pin } from "lucide-react";
import { useState } from "react";

import type { Message } from "@/lib/api/types";
import { cn } from "@/lib/utils";

/**
 * #3 pinned-messages banner: a calm strip above the thread scroll listing the
 * pinned messages so a crew member finds the address / quote / gate code
 * without scrolling. Derived from the LOADED thread pages (a pin on a not-yet-
 * loaded older page appears once its page scrolls in; a conversation-wide pinned
 * query is a later increment). Clicking a row jumps to the source message.
 */

/** The one-line label a pinned row shows: the trimmed body, else a media note. */
export function pinnedSnippet(
  message: Pick<Message, "body" | "attachments">,
): string {
  const body = message.body.trim();
  if (body !== "") return body;
  return (message.attachments?.length ?? 0) > 0 ? "Photo" : "Attachment";
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

export function PinnedBanner({
  messages,
  onJump,
}: {
  messages: Message[];
  onJump: (messageId: string) => void;
}) {
  if (messages.length === 0) return null;
  return (
    <section
      aria-label="Pinned messages"
      className="overflow-hidden rounded-app-card border border-app-line bg-app-white"
    >
      <h3 className="flex items-center gap-1.5 px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-app-muted-2">
        <Pin className="size-3" strokeWidth={2} aria-hidden />
        Pinned{messages.length > 1 ? ` · ${messages.length}` : ""}
      </h3>
      <ul className="max-h-32 overflow-y-auto pb-1">
        {messages.map((message) => (
          <li key={message.id}>
            <button
              type="button"
              onClick={() => onJump(message.id)}
              aria-label={`Jump to pinned message: ${pinnedSnippet(message)}`}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors duration-150 ease-out hover:bg-app-stone-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50"
            >
              <span className="min-w-0 flex-1 truncate text-[13px] text-app-ink">
                {pinnedSnippet(message)}
              </span>
              <span className="shrink-0 text-[11px] font-medium text-app-muted">
                Jump
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * #76: the mobile variant of the pinned banner — collapsed by default to a
 * single tappable "Pinned · N" line so it costs ~one row instead of the full
 * 60-128px card, then expands the same jump list on tap. Isolated from
 * {@link PinnedBanner} (the desktop card) so desktop stays byte-identical; the
 * two are swapped by responsive wrappers in message-list.tsx.
 */
export function MobilePinnedDisclosure({
  messages,
  onJump,
}: {
  messages: Message[];
  onJump: (messageId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  if (messages.length === 0) return null;
  return (
    <section
      aria-label="Pinned messages"
      className="overflow-hidden rounded-app-card border border-app-line bg-app-white"
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="tap-target flex w-full items-center gap-1.5 px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50"
      >
        <Pin className="size-3" strokeWidth={2} aria-hidden />
        <span className="text-[11px] font-semibold uppercase tracking-wide text-app-muted-2">
          Pinned{messages.length > 1 ? ` · ${messages.length}` : ""}
        </span>
        <ChevronDown
          className={cn(
            "ml-auto size-3.5 text-app-muted-2 transition-transform duration-150",
            open && "rotate-180",
          )}
          strokeWidth={1.75}
          aria-hidden
        />
      </button>
      {open && (
        <ul className="max-h-40 overflow-y-auto pb-1">
          {messages.map((message) => (
            <li key={message.id}>
              <button
                type="button"
                onClick={() => onJump(message.id)}
                aria-label={`Jump to pinned message: ${pinnedSnippet(message)}`}
                className="tap-target flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors duration-150 ease-out hover:bg-app-stone-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50"
              >
                <span className="min-w-0 flex-1 truncate text-[13px] text-app-ink">
                  {pinnedSnippet(message)}
                </span>
                <span className="shrink-0 text-[11px] font-medium text-app-muted">
                  Jump
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
