/**
 * SavedRepliesPicker (trades crew), v4 "FIRST RESPONSE" Law 2: the trade
 * page's saved-replies pack, staged in the product's template picker.
 *
 * The app's real <TemplatePicker> (components/thread/template-picker.tsx) is
 * a controlled popover fed by the templates API, so it cannot render on a
 * static marketing route; this is a server-only depiction of that exact
 * surface, mid-task: "/" typed in an empty composer, the picker open above
 * it, the first template highlighted with the app's petrol-tint selection
 * fill. Structure and tokens follow the real picker's Command list (search
 * field, "Saved replies" group heading, name + body rows) and the real
 * composer card (components/thread/composer.tsx).
 *
 * It sits INSIDE a marketing <PanelFrame> whose `.app-scope` resolves every
 * app token here to the product's real values. Marketing cobalt never
 * appears in this file.
 *
 * Unlike the real picker's one-line truncated previews, the row bodies here
 * wrap in full: on a trade page the pack itself is the content ("Steal
 * these"), so the six texts must be readable, not elided.
 *
 * Pure depiction: no tab stops, no buttons.
 */

import { CornerDownLeft, Search } from "lucide-react";

import { cn } from "@/lib/utils";

export interface SavedReply {
  /** Template name, e.g. "On my way". */
  name: string;
  /** The full, copy-ready message body. */
  text: string;
}

export function SavedRepliesPicker({
  replies,
  className,
}: {
  replies: SavedReply[];
  className?: string;
}) {
  return (
    <div className={cn("font-sans bg-background p-4 text-foreground", className)}>
      {/* The picker popover, open above the composer (the app anchors it to
          the composer pill and opens it from "/"). */}
      <div className="overflow-hidden rounded-app-card border border-app-line bg-popover shadow-[var(--app-sh-float)]">
        <div className="flex items-center gap-2 border-b border-app-line px-3 py-2.5">
          <Search
            className="size-4 shrink-0 text-app-muted"
            strokeWidth={1.75}
            aria-hidden
          />
          <span className="text-[14px] text-muted-foreground">
            Search saved replies…
          </span>
        </div>
        <div className="p-1.5">
          <p className="px-2 py-1.5 text-[12px] font-medium text-muted-foreground">
            Saved replies
          </p>
          <ul className="flex flex-col gap-0.5">
            {replies.map((reply, i) => (
              <li
                key={reply.name}
                className={cn(
                  "flex flex-col gap-0.5 rounded-app-ctrl px-2 py-1.5",
                  i === 0 && "bg-accent text-accent-foreground",
                )}
              >
                <span className="text-sm font-medium text-app-ink">
                  {reply.name}
                </span>
                <span className="text-xs leading-relaxed text-muted-foreground">
                  {reply.text}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* The composer card with "/" typed: exactly how the picker opens. */}
      <div className="mt-2 flex items-end gap-1 rounded-app-card border border-app-petrol bg-app-white px-2 py-1.5 ring-[3px] ring-app-tint">
        <span className="min-h-9 flex-1 px-2 py-2 text-[15px] leading-6 text-app-ink">
          /
          <span
            className="ml-0.5 inline-block h-4 w-px bg-primary align-middle"
            aria-hidden
          />
        </span>
        <span className="mb-0.5 inline-flex h-8 items-center gap-1.5 rounded-app-ctrl bg-primary px-3 text-[13px] font-semibold">
          Send
          <CornerDownLeft className="size-3.5" strokeWidth={2} aria-hidden />
        </span>
      </div>
    </div>
  );
}
