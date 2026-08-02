"use client";

import { Merge } from "lucide-react";
import { useState } from "react";

import { SettingsCard } from "@/components/settings/section";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/api/error";
import { useMergeTags, useTagUsage, type TagUsage } from "@/lib/api/tags";

/**
 * #298 — the tag list, with how much each one is actually used, and a way to
 * fold the duplicates together.
 *
 * # Why usage is the headline and not the names
 *
 * "Cleanup is impossible without being able to see the problem." A list of
 * forty tag names tells an admin nothing — every one of them looked reasonable
 * to whoever made it. A list ordered by USE makes both problems visible at
 * once: the near-duplicates sit next to each other with wildly different
 * counts, and the dead ones are all at the bottom with zero.
 *
 * *Applying: Meaningful Highlights & Context — the count IS the insight here,
 * so it is the thing the eye lands on. Zen of Clarity — one row per tag, one
 * action, and the merge picker only appears once somebody asks for it.*
 *
 * # Ethical Friction, and why merge earns it
 *
 * A merge rewrites how a workspace's history is categorised, and unlike a
 * rename it cannot be undone by typing the old name back. The dialog names the
 * direction in plain words and says what will happen to the threads, because
 * "merge A into B" is exactly the phrasing people get backwards.
 */
export function TagManagementCard({ canManage }: { canManage: boolean }) {
  const usage = useTagUsage();
  const [merging, setMerging] = useState<TagUsage | null>(null);

  if (usage.isPending) {
    return <Skeleton className="h-40 w-full rounded-lg" />;
  }
  const rows = usage.data?.data ?? [];
  if (rows.length === 0) return null;

  return (
    <>
      <SettingsCard
        title="Tags"
        description="What the crew has been tagging, and how often. The quiet ones at the bottom are usually duplicates of something above."
      >
        <ul className="divide-y divide-border">
          {rows.map((row) => (
            <li
              key={row.tag_id}
              className="flex items-center gap-3 py-2 first:pt-0 last:pb-0"
            >
              <span className="min-w-0 flex-1 truncate text-sm">{row.name}</span>
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                {row.uses === 0
                  ? "never used"
                  : `${row.uses} ${row.uses === 1 ? "thread" : "threads"}`}
              </span>
              {canManage && rows.length > 1 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 shrink-0 px-2 text-xs"
                  onClick={() => setMerging(row)}
                >
                  <Merge className="size-3.5" strokeWidth={1.75} aria-hidden />
                  Merge
                </Button>
              )}
            </li>
          ))}
        </ul>
      </SettingsCard>

      <MergeDialog
        from={merging}
        others={rows.filter((r) => r.tag_id !== merging?.tag_id)}
        onClose={() => setMerging(null)}
      />
    </>
  );
}

function MergeDialog({
  from,
  others,
  onClose,
}: {
  from: TagUsage | null;
  others: TagUsage[];
  onClose: () => void;
}) {
  const merge = useMergeTags();
  const [into, setInto] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [lastId, setLastId] = useState<string | null>(null);

  if (from !== null && from.tag_id !== lastId) {
    setLastId(from.tag_id);
    setInto("");
    setError(null);
  }

  const target = others.find((o) => o.tag_id === into) ?? null;

  return (
    <Dialog open={from !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Merge &ldquo;{from?.name}&rdquo; into another tag</DialogTitle>
          <DialogDescription>
            Every conversation tagged &ldquo;{from?.name}&rdquo; keeps its place
            under the tag you pick, and this one goes away. Nothing is untagged.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Select value={into} onValueChange={setInto}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Keep which tag?" />
            </SelectTrigger>
            <SelectContent>
              {others.map((tag) => (
                <SelectItem key={tag.tag_id} value={tag.tag_id}>
                  {tag.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {target && from && (
            // Said back in the direction people get backwards. "Merge A into B"
            // is ambiguous to almost everybody; a sentence naming what survives
            // is not.
            <p className="text-[13px] text-muted-foreground">
              {from.uses} {from.uses === 1 ? "thread" : "threads"} moves to
              &ldquo;{target.name}&rdquo;. &ldquo;{from.name}&rdquo; stops
              existing.
            </p>
          )}
          {error !== null && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={into === "" || merge.isPending}
            onClick={() => {
              if (!from) return;
              setError(null);
              merge
                .mutateAsync({ fromTagId: from.tag_id, intoTagId: into })
                .then(onClose)
                .catch((cause: unknown) => {
                  setError(
                    cause instanceof ApiError
                      ? cause.message
                      : "Could not merge those. Try again in a moment.",
                  );
                });
            }}
          >
            {merge.isPending ? "Merging…" : "Merge"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
