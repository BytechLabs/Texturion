import type { MessageKey } from "@/i18n/provider";
import type { MuteDuration } from "@/lib/api/types";

/**
 * #694: how long a member can mute a thread for. The menu itself is part of the
 * conversation's action list (conversation-actions.tsx, #712); this is only the
 * list of choices it offers.
 */
export const MUTE_DURATIONS: { id: MuteDuration; label: MessageKey }[] = [
  { id: "1h", label: "thread.mute1h" },
  { id: "8h", label: "thread.mute8h" },
  { id: "1w", label: "thread.mute1w" },
  { id: "forever", label: "thread.muteForever" },
];
