"use client";

import { Truck } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import {
  ON_MY_WAY_COPY,
  ON_MY_WAY_PRESETS,
  onMyWayPresetLabel,
  onMyWayText,
} from "@loonext/shared";

import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/provider";
import { ApiError } from "@/lib/api/error";
import { useSendMessage } from "@/lib/api/messages";
import { useTasks } from "@/lib/api/tasks";
import { flattenPages } from "@/lib/api/pagination";

/**
 * #520 — "on my way, about 20 minutes", sent while walking to the van.
 *
 * Design notes, and the principles behind them:
 *
 * - **Absent unless there is a job today.** The composer already carries
 *   attach, saved replies, dictation, send-later and send. A sixth control
 *   that is usually meaningless is furniture, and furniture is what makes
 *   somebody stop reading a toolbar. *Applying: Zen of Clarity, and Prioritize
 *   Intent — the affordance appears when the intent is plausible.*
 *
 * - **One tap, then one choice, then it is gone.** The whole feature is a
 *   shortcut past picker → pick → send. A confirm step would put back exactly
 *   what it removes. *Applying: the Excitement principle sparingly — the speed
 *   IS the feature.*
 *
 * - **The choice says it sends.** Somebody expecting a picker and getting a
 *   sent message has texted a customer by accident, which is the one
 *   irreversible thing here. So the prompt is a question and the note under it
 *   says what answering does. *Applying: Ethical Friction, at the only edge
 *   that has any.*
 *
 * - **It writes NOTHING to the job.** See `on-my-way.ts` for why: this is
 *   evidence of what somebody SAID, not of where the van is, and a status fed
 *   by a text goes stale the moment the tech is diverted and says so in words.
 *
 * The send goes through `useSendMessage` — the same path as every other
 * outbound, so the opt-out gate, quiet hours and number access all apply. Fast
 * is not a reason for an exemption.
 */
export function OnMyWay({ conversationId }: { conversationId: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const send = useSendMessage(conversationId);

  // Today in the DEVICE's zone. The person tapping this is standing somewhere,
  // and "is there a job today" means their today — not the workspace's, which
  // could be a different date for a crew working across a boundary.
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  const tasks = useTasks({
    conversation_id: conversationId,
    status: "open",
    due_after: start.toISOString(),
    due_before: end.toISOString(),
  });
  const hasJobToday = flattenPages(tasks.data).length > 0;

  // Not a disabled button: a control that is present and inert still costs a
  // reader the moment it takes to work out why it does nothing.
  if (!hasJobToday) return null;

  async function sendEta(minutes: number) {
    setOpen(false);
    try {
      await send.mutateAsync({ body: onMyWayText(minutes) });
    } catch (cause) {
      // The server's words. A refusal here is usually a RULE — they opted out,
      // it is outside quiet hours — and "couldn't send" would read as the
      // button being broken rather than as the rule working.
      toast.error(
        cause instanceof ApiError ? cause.message : t("thread.sendFailed"),
      );
    }
  }

  if (!open) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={send.isPending}
        onClick={() => setOpen(true)}
        className="gap-1.5"
      >
        <Truck className="size-3.5" strokeWidth={1.75} aria-hidden />
        {t(ON_MY_WAY_COPY.action)}
      </Button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[13px] text-app-muted">{t(ON_MY_WAY_COPY.prompt)}</span>
      {ON_MY_WAY_PRESETS.map((minutes) => (
        <Button
          key={minutes}
          type="button"
          size="sm"
          variant="outline"
          disabled={send.isPending}
          onClick={() => void sendEta(minutes)}
        >
          {onMyWayPresetLabel(minutes)}
        </Button>
      ))}
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={() => setOpen(false)}
      >
        {t("common.cancel")}
      </Button>
      <p className="w-full text-[12px] text-app-muted-2">
        {t(ON_MY_WAY_COPY.gated_note)}
      </p>
    </div>
  );
}
