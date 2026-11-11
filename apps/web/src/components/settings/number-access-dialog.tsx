"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { ChoiceCards } from "@/components/ui/choice-cards";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useT, type MessageKey } from "@/i18n/provider";
import { ApiError } from "@/lib/api/error";
import { useNumberAccess, useSetNumberAccess } from "@/lib/api/numbers";
import { useMembers } from "@/lib/api/team";
import type { NumberAccess } from "@/lib/api/types";

/**
 * #106 (#80): "Who can use this number" — the per-number access control in plain
 * words. Owners and admins ALWAYS keep full access (enforced server-side, no
 * self-lockout), so the presets are honest about that rather than pretending a
 * level applies to admins:
 *
 *   everyone       every teammate can text (clears the rules — the default)
 *   members_view   members read + add notes only; admins still text
 *   admins         members can't see the number at all
 *   users          only the people you pick, at a level you choose
 *
 * A level selector only appears for "Specific people" — the other presets have
 * a fixed, unambiguous meaning. Saving replaces the number's rules wholesale
 * (PUT), mirroring the API. A saved rule that named a since-deactivated member
 * is dropped on save (the API rejects inactive ids), so the dialog never
 * deadlocks on a stale seat.
 */
type Mode = "everyone" | "members_view" | "admins" | "users";

const PRESETS: { value: Mode; label: MessageKey; hint: MessageKey }[] = [
  {
    value: "everyone",
    label: "settingsMore.numberAccessEveryone",
    hint: "settingsMore.numberAccessEveryoneHint",
  },
  {
    value: "members_view",
    label: "settingsMore.numberAccessMembersView",
    hint: "settingsMore.numberAccessMembersViewHint",
  },
  {
    value: "admins",
    label: "settingsMore.numberAccessAdmins",
    hint: "settingsMore.numberAccessAdminsHint",
  },
  {
    value: "users",
    label: "settingsMore.numberAccessUsers",
    hint: "settingsMore.numberAccessUsersHint",
  },
];

export function NumberAccessDialog({
  numberId,
  numberLabel,
  open,
  onOpenChange,
}: {
  numberId: string;
  numberLabel: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const access = useNumberAccess(numberId, open);
  const save = useSetNumberAccess(numberId);
  const members = useMembers();

  const [mode, setMode] = useState<Mode>("everyone");
  const [level, setLevel] = useState<"text" | "note">("text");
  const [userIds, setUserIds] = useState<Set<string>>(new Set());

  // Seed the form from the server shape whenever the dialog (re)opens.
  useEffect(() => {
    if (!open || !access.data) return;
    const data = access.data;
    if (data.access === "everyone") {
      setMode("everyone");
    } else if (data.access === "role") {
      setMode(data.role === "admin" ? "admins" : "members_view");
    } else {
      setMode("users");
      setLevel(data.level);
      setUserIds(new Set(data.user_ids));
    }
  }, [open, access.data]);

  const activeMembers = useMemo(
    () =>
      (members.data?.data ?? []).filter(
        (member) => member.deactivated_at === null,
      ),
    [members.data],
  );

  function submit() {
    let body: NumberAccess;
    if (mode === "everyone") {
      body = { access: "everyone" };
    } else if (mode === "members_view") {
      body = { access: "role", role: "member", level: "note" };
    } else if (mode === "admins") {
      // Admins always have full access; the level is moot — send 'text'.
      body = { access: "role", role: "admin", level: "text" };
    } else {
      // Only ACTIVE members can hold a rule (the API 422s inactive ids), so a
      // stale selection can never wedge the save.
      const activeIds = new Set(activeMembers.map((m) => m.user_id));
      const picked = [...userIds].filter((id) => activeIds.has(id));
      if (picked.length === 0) {
        toast.error(t("settingsMore.numberAccessPickSomeone"));
        return;
      }
      body = { access: "users", user_ids: picked, level };
    }
    save.mutate(body, {
      onSuccess: () => {
        onOpenChange(false);
        toast.success(t("settingsMore.numberAccessSaved"));
      },
      onError: (cause) =>
        toast.error(
          cause instanceof ApiError
            ? cause.message
            : t("settingsMore.saveFailed"),
        ),
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {t("settingsMore.numberAccessTitle", { number: numberLabel })}
          </DialogTitle>
          <DialogDescription>
            {t("settingsMore.numberAccessDescription")}
          </DialogDescription>
        </DialogHeader>

        <ChoiceCards
          ariaLabel={t("settingsMore.numberAccessGroupAria")}
          value={mode}
          onChange={setMode}
          options={PRESETS.map(({ value, label, hint }) => ({
            value,
            label: t(label),
            description: t(hint),
          }))}
        />

        {mode === "users" && (
          <div className="space-y-3 rounded-lg border p-3">
            <div className="space-y-2">
              {activeMembers.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t("settingsMore.numberAccessNoTeammates")}
                </p>
              ) : (
                activeMembers.map((member) => (
                  <label
                    key={member.user_id}
                    className="flex cursor-pointer items-center gap-2 text-sm"
                  >
                    <Checkbox
                      checked={userIds.has(member.user_id)}
                      onCheckedChange={(checked) => {
                        setUserIds((current) => {
                          const next = new Set(current);
                          if (checked === true) next.add(member.user_id);
                          else next.delete(member.user_id);
                          return next;
                        });
                      }}
                    />
                    {member.display_name || t("settingsMore.teammate")}
                  </label>
                ))
              )}
            </div>

            {/* Level applies only to the people picked above — admins are
                unaffected (always full use). */}
            <div className="border-t pt-3">
              <SegmentedControl
                fill
                ariaLabel={t("settingsMore.numberAccessLevelAria")}
                value={level}
                onChange={setLevel}
                options={[
                  { value: "text", label: t("settingsMore.numberAccessCanText") },
                  { value: "note", label: t("settingsMore.numberAccessNoteOnly") },
                ]}
              />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={save.isPending}
          >
            {t("common.cancel")}
          </Button>
          <Button onClick={submit} disabled={save.isPending || access.isPending}>
            {save.isPending ? t("common.saving") : t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
