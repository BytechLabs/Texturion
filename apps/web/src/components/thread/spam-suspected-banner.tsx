"use client";

import { ShieldAlert } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useUpdateConversation } from "@/lib/api/conversations";
import type { Conversation } from "@/lib/api/types";

/**
 * #250 — "this looks like a robotext", said out loud rather than acted on.
 *
 * # Why a banner and not a filter
 *
 * Every genuine new customer is an unknown sender with no prior outbound,
 * because that is what a new lead IS. So a classifier that hides threads eats
 * exactly the messages that make our customers money, and a misfiled customer
 * is a lost job. The suspicion changes one thing only — we do not wake
 * somebody's phone — and this banner is the whole of its visible effect.
 *
 * # It says WHY, in the server's words
 *
 * A verdict somebody cannot check is one they learn to dismiss, so the reasons
 * travel with the flag and are rendered verbatim. They are full sentences on
 * purpose ("It carries the unsubscribe footer a bulk sender is required to
 * add"), and the threshold guarantees at least two — one signal is never
 * enough to suspect.
 *
 * *Applying: Zen of Clarity — no banner at all when there is nothing to say.
 * Meaningful Highlights & Context — the reason IS the insight, not a score.*
 */
export function SpamSuspectedBanner({
  conversation,
  canAct,
}: {
  conversation: Conversation;
  /**
   * Clearing it needs `conversations.note`, which `read_only` does not hold.
   * An observer still reads the reasons — hiding the explanation from somebody
   * who can see the thread would leave them with an unexplained quiet thread.
   */
  canAct: boolean;
}) {
  const update = useUpdateConversation(conversation.id);

  if (!conversation.spam_suspected_at) return null;

  const reasons = (conversation.spam_signals ?? []).map((signal) => signal.why);

  return (
    <div
      // A finding, not an alarm: `status` rather than `alert`, because nothing
      // is wrong and nothing needs doing. The thread is still right here.
      role="status"
      className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2 rounded-lg border border-border bg-muted/40 px-3.5 py-3"
    >
      <div className="flex min-w-0 flex-1 items-start gap-2.5">
        <ShieldAlert
          aria-hidden
          className="mt-0.5 size-4 shrink-0 text-muted-foreground"
          strokeWidth={1.75}
        />
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-medium">This looks like spam</p>
          <p className="text-[13px] text-muted-foreground">
            We didn&apos;t send a notification for it. Nothing is hidden, and
            you can reply as normal.
          </p>
          {reasons.length > 0 && (
            <ul className="space-y-0.5 text-[13px] text-muted-foreground">
              {reasons.map((why) => (
                <li key={why}>{why}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
      {canAct && (
        <Button
          variant="outline"
          size="sm"
          className="shrink-0"
          disabled={update.isPending}
          onClick={() => {
            // No undo toast: the server accepts only `false`, so nothing could
            // put the suspicion back. An undo that cannot undo is worse than
            // none.
            update.mutate(
              { spam_suspected: false },
              {
                onSuccess: () => toast.success("Thanks. We won't flag this one."),
                onError: () =>
                  toast.error("Couldn't clear that just now. Try again."),
              },
            );
          }}
        >
          Not spam
        </Button>
      )}
    </div>
  );
}
