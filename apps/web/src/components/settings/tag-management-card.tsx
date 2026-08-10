"use client";

import { Merge, Pencil } from "lucide-react";
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
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useT } from "@/i18n/provider";
import { useCompany, useUpdateCompany } from "@/lib/api/companies";
import { ApiError } from "@/lib/api/error";
import { useMergeTags, useTagUsage, useUpdateTag, type TagUsage } from "@/lib/api/tags";
import { Input } from "@/components/ui/input";
import { formatRelativeTime } from "@/lib/format/time";

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
  const t = useT();
  const usage = useTagUsage();
  const [merging, setMerging] = useState<TagUsage | null>(null);

  if (usage.isPending) {
    return <Skeleton className="h-40 w-full rounded-lg" />;
  }
  const rows = usage.data?.data ?? [];
  if (rows.length === 0) return null;

  return (
    <>
      {canManage && <TagLockCard />}
      <SettingsCard
        title={t("settingsMore.tagsTitle")}
        description={t("settingsMore.tagsDescription")}
      >
        <ul className="divide-y divide-border">
          {rows.map((row) => (
            <TagUsageRow
              key={row.tag_id}
              row={row}
              canManage={canManage}
              canMerge={canManage && rows.length > 1}
              onMerge={() => setMerging(row)}
            />
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

/**
 * One tag: what it is called, what it means, and how much it is used.
 *
 * # Why the description is editable from HERE and nowhere else
 *
 * A description answers "does this mean the same thing as that one?", and this
 * list is the only screen where somebody asks that question. Putting the editor
 * behind a separate tag-detail page would mean the answer is written somewhere
 * other than where it is needed.
 *
 * *Applying: Zen of Clarity — the editor is a pencil that appears on the row,
 * not a permanent field per tag; forty always-open inputs would bury the counts
 * that are the point of the list.*
 */
function TagUsageRow({
  row,
  canManage,
  canMerge,
  onMerge,
}: {
  row: TagUsage;
  canManage: boolean;
  canMerge: boolean;
  onMerge: () => void;
}) {
  const t = useT();
  const update = useUpdateTag();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(row.description ?? "");
  const [error, setError] = useState<string | null>(null);

  function save() {
    setError(null);
    update.mutate(
      { tagId: row.tag_id, patch: { description: draft.trim() || null } },
      {
        onSuccess: () => setEditing(false),
        onError: (cause) =>
          setError(
            cause instanceof ApiError
              ? cause.message
              : t("settingsMore.saveThatFailed"),
          ),
      },
    );
  }

  return (
    <li className="py-2 first:pt-0 last:pb-0">
      <div className="flex items-center gap-3">
        <span className="min-w-0 flex-1 truncate text-sm">{row.name}</span>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {row.uses === 0
            ? t("settingsMore.tagNeverUsed")
            : row.uses === 1
              ? t("settingsMore.tagUsesOne", { count: row.uses })
              : t("settingsMore.tagUsesMany", { count: row.uses })}
          {/* Last used, beside the count: a tag with forty uses and nothing
              since March is a category the crew has stopped believing in, and
              the count alone cannot say that. */}
          {row.last_used !== null &&
            t("settingsMore.tagLastUsed", {
              when: formatRelativeTime(row.last_used),
            })}
        </span>
        {canManage && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 shrink-0 px-2 text-xs"
            // A pencil is the same glyph either way, so the label carries the
            // difference: a screen reader user needs to know whether they are
            // about to write the first description or change an existing one.
            aria-label={
              row.description === null || row.description === ""
                ? t("settingsMore.tagDescribeAria", { name: row.name })
                : t("settingsMore.tagEditDescriptionAria", { name: row.name })
            }
            onClick={() => {
              setDraft(row.description ?? "");
              setEditing((open) => !open);
            }}
          >
            <Pencil className="size-3.5" strokeWidth={1.75} aria-hidden />
          </Button>
        )}
        {canMerge && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 shrink-0 px-2 text-xs"
            onClick={onMerge}
          >
            <Merge className="size-3.5" strokeWidth={1.75} aria-hidden />
            {t("settingsMore.tagMerge")}
          </Button>
        )}
      </div>

      {editing ? (
        <div className="mt-1.5 flex items-center gap-2">
          <Input
            value={draft}
            maxLength={200}
            autoFocus
            placeholder={t("settingsMore.tagDescriptionPlaceholder")}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") save();
              if (event.key === "Escape") setEditing(false);
            }}
            className="h-8 text-sm"
          />
          <Button size="sm" className="h-8" disabled={update.isPending} onClick={save}>
            {t("common.save")}
          </Button>
        </div>
      ) : (
        row.description !== null && (
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            {row.description}
          </p>
        )
      )}
      {error !== null && (
        <p role="alert" className="mt-1 text-sm text-destructive">
          {error}
        </p>
      )}
    </li>
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
  const t = useT();
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
          <DialogTitle>
            {t("settingsMore.tagMergeTitle", { name: from?.name ?? "" })}
          </DialogTitle>
          <DialogDescription>
            {t("settingsMore.tagMergeBody", { name: from?.name ?? "" })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Select value={into} onValueChange={setInto}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder={t("settingsMore.tagMergeKeepWhich")} />
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
              {from.uses === 1
                ? t("settingsMore.tagMergeOutcomeOne", {
                    count: from.uses,
                    into: target.name,
                    name: from.name,
                  })
                : t("settingsMore.tagMergeOutcomeMany", {
                    count: from.uses,
                    into: target.name,
                    name: from.name,
                  })}
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
            {t("common.cancel")}
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
                      : t("settingsMore.tagMergeFailed"),
                  );
                });
            }}
          >
            {merge.isPending
              ? t("settingsMore.tagMerging")
              : t("settingsMore.tagMerge")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * #298 acceptance 4 — restricting who may INVENT a tag. Off by default.
 *
 * # Why this exists at all, given the issue argues against taxonomies
 *
 * #298's own devil's advocate: "the temptation is to impose a taxonomy. That
 * is the wrong move for this market — a plumber's categories are not an HVAC
 * company's, and a locked-down tag list would be ignored in favour of the
 * notes field." That argument is against US imposing one. A crew that has
 * BUILT a vocabulary and wants it held still is the opposite case, and this is
 * the only thing here they cannot do without us.
 *
 * # It restricts creation, never attachment
 *
 * A tech who cannot categorise a thread does not categorise it in the notes
 * instead — they leave it uncategorised, and the workspace loses the data it
 * turned this on to protect. So every existing tag stays one tap away for
 * everybody, and the switch copy says so before the toggle is touched rather
 * than after.
 *
 * *Applying: Loss Aversion, inverted — the consequence line names what the
 * crew loses (the ability to name something new mid-job), because that is the
 * cost an admin is deciding to pay and it is invisible from this screen.*
 */
function TagLockCard() {
  const t = useT();
  const company = useCompany();
  const update = useUpdateCompany();
  const locked = company.data?.tags_locked ?? false;
  const [error, setError] = useState<string | null>(null);

  if (company.data === undefined) return null;

  return (
    <SettingsCard
      title={t("settingsMore.tagLockTitle")}
      description={t("settingsMore.tagLockDescription")}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-0.5">
          <Label htmlFor="tags-locked" className="text-sm font-medium">
            {t("settingsMore.tagLockLabel")}
          </Label>
          <p className="text-sm text-muted-foreground">
            {t("settingsMore.tagLockHint")}
          </p>
        </div>
        <Switch
          id="tags-locked"
          checked={locked}
          disabled={update.isPending}
          onCheckedChange={(next) => {
            setError(null);
            update.mutate(
              { tags_locked: next },
              {
                onError: (cause) => {
                  setError(
                    cause instanceof ApiError
                      ? cause.message
                      : t("settingsMore.saveFailed"),
                  );
                },
              },
            );
          }}
        />
      </div>
      {locked && (
        <p className="mt-3 text-[13px] text-muted-foreground">
          {t("settingsMore.tagLockedNote")}
        </p>
      )}
      {error !== null && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      )}
    </SettingsCard>
  );
}
