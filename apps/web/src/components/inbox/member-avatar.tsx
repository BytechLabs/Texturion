"use client";

import { avatarInitials } from "@loonext/shared";
import { useMemo } from "react";

import { InitialsAvatar } from "@/components/shell/initials-avatar";
import { useT } from "@/i18n/provider";
import { useMembers } from "@/lib/api/team";
import { cn } from "@/lib/utils";

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
        member.display_name.trim() !== "" ? member.display_name : fallback,
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
  className,
}: {
  name: string;
  className?: string;
}) {
  return (
    <InitialsAvatar
      initials={avatarInitials(name)}
      className={cn(
        "flex size-[18px] shrink-0 select-none items-center justify-center rounded-full bg-primary/10 text-[9px] font-medium text-primary",
        className,
      )}
    />
  );
}
