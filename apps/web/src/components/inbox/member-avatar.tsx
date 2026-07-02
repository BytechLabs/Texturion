"use client";

import { useMemo } from "react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useMembers } from "@/lib/api/team";
import { cn } from "@/lib/utils";

/** "Sam Rivera" → "SR"; single word → first two letters. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

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
        {initials(name)}
      </AvatarFallback>
    </Avatar>
  );
}
