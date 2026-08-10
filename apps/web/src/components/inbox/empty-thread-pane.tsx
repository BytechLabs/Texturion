"use client";

import { MessagesSquare } from "lucide-react";

import { useT } from "@/i18n/provider";

/**
 * The quiet placeholder in the thread region when no conversation is open.
 *
 * A client leaf rather than markup inside the route, because #228 needs the one
 * sentence here to come from the catalogue and a page that exports `metadata`
 * cannot be a client component. Nothing else moved: the markup and every class
 * is byte-identical to what the route rendered before.
 */
export function EmptyThreadPane() {
  const t = useT();
  return (
    <div className="hidden h-full items-center justify-center md:flex">
      <div className="flex flex-col items-center gap-3 text-center">
        <MessagesSquare
          className="size-8 text-muted-foreground/50"
          strokeWidth={1.75}
          aria-hidden
        />
        <p className="text-sm text-muted-foreground">
          {t("appShell.inboxPickAThread")}
        </p>
      </div>
    </div>
  );
}
