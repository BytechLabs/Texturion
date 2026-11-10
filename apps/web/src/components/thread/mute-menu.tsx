"use client";

import { Bell, BellOff, BellPlus } from "lucide-react";
import { toast } from "sonner";

import {
  DropdownMenuItem,
  DropdownMenuHint,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import { useT } from "@/i18n/provider";
import type { MessageKey } from "@/i18n/provider";
import {
  useFollowConversation,
  useMuteConversation,
  useUnmuteConversation,
} from "@/lib/api/conversations";
import { ApiError } from "@/lib/api/error";
import type { MuteDuration } from "@/lib/api/types";

const DURATIONS: { id: MuteDuration; label: MessageKey }[] = [
  { id: "1h", label: "thread.mute1h" },
  { id: "8h", label: "thread.mute8h" },
  { id: "1w", label: "thread.mute1w" },
  { id: "forever", label: "thread.muteForever" },
];

/**
 * #694: mute and follow, in the thread's overflow menu beside Block.
 *
 * Both are the member's own: muting never silences a teammate. Mute is a
 * submenu of durations, and turns into a single "Unmute" item while it applies.
 */
export function MuteFollowMenuItems({
  conversationId,
  muted,
  followed,
}: {
  conversationId: string;
  muted: boolean;
  followed: boolean;
}) {
  const t = useT();
  const mute = useMuteConversation();
  const unmute = useUnmuteConversation();
  const follow = useFollowConversation();
  const fail = (error: unknown, fallback: string) =>
    toast.error(error instanceof ApiError ? error.message : fallback);

  return (
    <>
      {muted ? (
        <DropdownMenuItem
          onSelect={() =>
            unmute.mutate(
              { conversationId },
              {
                onSuccess: () => toast.success(t("thread.unmutedToast")),
                onError: (e) => fail(e, t("thread.unmuteFailed")),
              },
            )
          }
        >
          <Bell className="size-4" strokeWidth={1.75} />
          {t("thread.unmute")}
        </DropdownMenuItem>
      ) : (
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <BellOff className="size-4" strokeWidth={1.75} />
            {t("thread.muteMenu")}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuHint>{t("thread.muteHint")}</DropdownMenuHint>
            {DURATIONS.map((duration) => (
              <DropdownMenuItem
                key={duration.id}
                onSelect={() =>
                  mute.mutate(
                    { conversationId, duration: duration.id },
                    {
                      onSuccess: () => toast.success(t("thread.mutedToast")),
                      onError: (e) => fail(e, t("thread.muteFailed")),
                    },
                  )
                }
              >
                {t(duration.label)}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      )}
      <DropdownMenuItem
        onSelect={() =>
          follow.mutate(
            { conversationId, follow: !followed },
            {
              onSuccess: () =>
                toast.success(
                  t(followed ? "thread.unfollowedToast" : "thread.followedToast"),
                ),
              onError: (e) => fail(e, t("thread.followFailed")),
            },
          )
        }
      >
        <BellPlus className="size-4" strokeWidth={1.75} />
        {t(followed ? "thread.unfollow" : "thread.follow")}
      </DropdownMenuItem>
    </>
  );
}
