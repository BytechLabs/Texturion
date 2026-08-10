"use client";

import {
  Check,
  ChevronDown,
  Loader2,
  MailOpen,
  ShieldAlert,
  X,
} from "lucide-react";

import { MemberAvatar, useMemberNames } from "@/components/inbox/member-avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useT } from "@/i18n/provider";
import { useTags } from "@/lib/api/tags";
import {
  canEscalate,
  selectionLabel,
  type BulkSelection,
} from "@/lib/inbox/bulk-selection";

/**
 * #275 — the selection bar over the inbox list.
 *
 * Appears only when something is selected, and replaces nothing: it sits above
 * the list so the rows stay where they were, because a bar that displaces the
 * list makes the row you just ticked jump out from under the pointer.
 *
 * DESIGN NOTES, and the one that matters is the second.
 *
 * *Chunking.* Three actions are visible — Mark read, Close, Spam — and the rest
 * (assign, tag) live behind one "More" menu. The brain holds three or four
 * things; a row of seven buttons is a menu that forgot to collapse. The three
 * chosen are the ones #275's own scenarios name: back from a week off (read,
 * close) and a robotext blast (spam).
 *
 * *The count is never invented.* In filter mode the label reads "All matching
 * this filter" with no number in it, because the client does not know the number
 * — the server counts the set when it runs the action. A confident "340 selected"
 * that acts on the 25 loaded rows is the exact trap #275 names, and the honest
 * phrasing is the vague one. `selectionLabel` owns that rule.
 *
 * *The escalation is a separate, explicit step.* Ticking every visible row does
 * not silently widen the selection; it offers a link that says what it will do.
 *
 * No bulk send, and there is nothing here to add it to: the actions are a fixed
 * list, and the server rejects anything outside it.
 */
export function BulkBar({
  selection,
  loadedIds,
  hasMore,
  pending,
  onSelectLoaded,
  onSelectAllMatching,
  onClear,
  onMarkRead,
  onClose,
  onSpam,
  onAssign,
  onTag,
}: {
  selection: BulkSelection;
  loadedIds: readonly string[];
  hasMore: boolean;
  pending: boolean;
  onSelectLoaded: () => void;
  onSelectAllMatching: () => void;
  onClear: () => void;
  onMarkRead: () => void;
  onClose: () => void;
  onSpam: () => void;
  onAssign: (userId: string | null) => void;
  onTag: (tagId: string) => void;
}) {
  const t = useT();
  const memberNames = useMemberNames();
  const tags = useTags();
  const showEscalate = canEscalate(selection, loadedIds, hasMore);
  // The step BEFORE the escalation: without it, reaching "all matching" would
  // mean ticking every visible row by hand, which is the tedium this issue is
  // about. Progressive disclosure — one row, then the page, then the filter.
  const showSelectLoaded =
    selection.mode === "ids" &&
    loadedIds.length > 0 &&
    !loadedIds.every((id) => selection.ids.has(id));

  return (
    <div
      // aria-live so a screen reader hears the count change as rows are ticked —
      // the bar is the only place the size of the selection is stated.
      aria-live="polite"
      className="flex flex-wrap items-center gap-2 border-b border-app-line bg-app-hover px-3.5 py-2.5"
    >
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={t("inbox.bulkClearSelectionAria")}
        onClick={onClear}
        disabled={pending}
      >
        <X className="size-4" strokeWidth={1.75} aria-hidden />
      </Button>

      <span className="text-[13px] font-medium text-app-ink">
        {selectionLabel(selection)}
      </span>

      {showSelectLoaded && (
        <Button
          type="button"
          variant="link"
          size="sm"
          className="h-auto p-0 text-[13px]"
          onClick={onSelectLoaded}
          disabled={pending}
        >
          {t("inbox.bulkSelectAllLoaded", { count: loadedIds.length })}
        </Button>
      )}

      {showEscalate && (
        // Explicit, and it says what it will do rather than "Select all".
        <Button
          type="button"
          variant="link"
          size="sm"
          className="h-auto p-0 text-[13px]"
          onClick={onSelectAllMatching}
          disabled={pending}
        >
          {t("inbox.bulkSelectAllMatching")}
        </Button>
      )}

      <span className="grow" />

      {pending && (
        <Loader2
          className="size-4 animate-spin text-app-muted"
          aria-hidden
        />
      )}

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onMarkRead}
        disabled={pending}
      >
        <MailOpen className="size-4" strokeWidth={1.75} aria-hidden />
        {t("inbox.bulkMarkRead")}
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onClose}
        disabled={pending}
      >
        <Check className="size-4" strokeWidth={1.75} aria-hidden />
        {t("inbox.bulkClose")}
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onSpam}
        disabled={pending}
      >
        <ShieldAlert className="size-4" strokeWidth={1.75} aria-hidden />
        {t("inbox.bulkSpam")}
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" size="sm" disabled={pending}>
            {t("inbox.bulkMore")}
            <ChevronDown className="size-4" strokeWidth={1.75} aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>{t("inbox.bulkAssignTo")}</DropdownMenuLabel>
          {[...memberNames.entries()].map(([userId, name]) => (
            <DropdownMenuItem key={userId} onSelect={() => onAssign(userId)}>
              <MemberAvatar name={name} />
              {name}
            </DropdownMenuItem>
          ))}
          <DropdownMenuItem onSelect={() => onAssign(null)}>
            {t("inbox.bulkNobody")}
          </DropdownMenuItem>
          {(tags.data?.data.length ?? 0) > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>{t("inbox.bulkAddTag")}</DropdownMenuLabel>
              {tags.data?.data.map((tag) => (
                <DropdownMenuItem key={tag.id} onSelect={() => onTag(tag.id)}>
                  {tag.name}
                </DropdownMenuItem>
              ))}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
