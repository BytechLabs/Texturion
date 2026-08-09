"use client";

import { avatarInitials } from "@loonext/shared";
import { useMemo } from "react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useMembers } from "@/lib/api/team";
import { cn } from "@/lib/utils";

/** Map of user_id → display_name for the active company's members. */
export function useMemberNames(): Map<string, string> {
  const members = useMembers();
  return useMemo(() => {
    const map = new Map<string, string>();
    for (const member of members.data?.data ?? []) {
      map.set(
        member.user_id,
        member.display_name.trim() !== "" ? member.display_name : "Teammate",
      );
    }
    return map;
  }, [members.data]);
}

/** Assignee avatar (G4: 18px in list rows; larger in menus). */
export function MemberAvatar({
  name,
  className,
}: {
  name: string;
  className?: string;
}) {
  return (
    <Avatar className={cn("size-[18px]", className)}>
      <AvatarFallback className="bg-primary/10 text-[9px] font-medium text-primary">
        {avatarInitials(name)}
      </AvatarFallback>
    </Avatar>
  );
}
