"use client";

import { avatarInitials } from "@loonext/shared";
import { useMemo } from "react";

import { InitialsAvatar } from "@/components/shell/initials-avatar";
import { useT } from "@/i18n/provider";
import { useMembers } from "@/lib/api/team";
import { cn } from "@/lib/utils";

const ASSIGNEE_TONES = [
  "app-assignee-olive",
  "app-assignee-slate",
  "app-assignee-plum",
  "app-assignee-ochre",
] as const;

function assigneeTone(memberId: string) {
  let hash = 0;
  for (let index = 0; index < memberId.length; index += 1) {
    hash = Math.imul(hash, 31) + memberId.charCodeAt(index);
  }
  return ASSIGNEE_TONES[hash & 3];
}

/**
 * Map of user_id → display_name for the active company's members.
 *
 * #228: the fallback for a member who never set a name is the one string in
 * here, and it is the reader's word rather than a constant — this map feeds
 * every assignee chip, menu and avatar in the app, so an English "Teammate"
 * left inside it would surface on a French screen in eleven places at once.
 */
export function useMemberNames(): Map<string, string> {
  const t = useT();
  const members = useMembers();
  const fallback = t("inbox.teammateFallback");
  return useMemo(() => {
    const map = new Map<string, string>();
    for (const member of members.data?.data ?? []) {
      map.set(
        member.user_id,
        member.display_name.trim() === "" ? fallback : member.display_name,
      );
    }
    return map;
  }, [members.data, fallback]);
}

/**
 * Assignee avatar (G4: 18px in list rows; larger in menus). Every caller shows
 * the name beside it or says it to screen readers, so the initials are drawn
 * and hidden rather than read out as letters.
 */
export function MemberAvatar({
  name,
  memberId,
  className,
}: {
  name: string;
  memberId?: string | null;
  className?: string;
}) {
  return (
    <InitialsAvatar
      initials={avatarInitials(name)}
      className={cn(
        "flex size-[18px] shrink-0 select-none items-center justify-center rounded-full text-[9px] font-medium",
        memberId ? assigneeTone(memberId) : "bg-primary/10 text-primary",
        className,
      )}
    />
  );
}
