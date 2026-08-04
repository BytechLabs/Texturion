"use client";

import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api/error";
import { useUpdateConversation } from "@/lib/api/conversations";
import { activeSources, useLeadSources } from "@/lib/api/lead-sources";
import type { ConversationDetail } from "@/lib/api/types";

/**
 * #301 — "how did you hear about us?", as one tap.
 *
 * # The trap this is built around
 *
 * #301's devil's-advocate section names it exactly: asking the tech to
 * categorise every inbound is a tax on the person with the least time, and if
 * it is not one tap it will not happen — which produces a source field empty
 * 80% of the time and a MISLEADING report rather than no report.
 *
 * So this is chips, not a dropdown, and it is the whole interaction: a tech
 * who hears "my neighbour Dave gave me your number" taps Neighbour and is
 * done. *Applying: Prioritize Intent — the core action, with nothing in front
 * of it.*
 *
 * # It never asks a question it already knows the answer to
 *
 * When the line itself attributed the conversation — the truck number rang —
 * there is nothing to ask, so it states the answer quietly and offers no
 * prompt. Asking anyway would train the crew to dismiss it, and the whole
 * value of per-number attribution is that nobody has to do anything.
 *
 * # It never turns a guess into a fact
 *
 * A source set by a person reads as one, and the way back is "Don't know"
 * rather than an absence — a tech who realises they picked the wrong chip must
 * be able to say so, and clearing has to mean unknown rather than silently
 * falling back to the line's own source. *Applying: the honesty rule #301
 * states — never present an inferred source as a fact.*
 */
export function LeadSourcePicker({
  conversation,
}: {
  conversation: ConversationDetail;
}) {
  const sources = useLeadSources();
  const update = useUpdateConversation(conversation.id);
  const options = activeSources(sources.data?.data);

  // No vocabulary yet: nothing to tap, and a prompt with no answers is worse
  // than silence. The owner sets the list up in Settings → Numbers.
  if (options.length === 0) return null;

  const current = conversation.lead_source_id ?? null;
  const byLine = conversation.lead_source_origin === "number";
  const currentName =
    options.find((source) => source.id === current)?.name ??
    // Chosen before it was archived: still name it, since the conversation
    // genuinely came from there.
    (sources.data?.data ?? []).find((source) => source.id === current)?.name ??
    null;

  function choose(id: string | null) {
    update.mutate(
      { lead_source_id: id },
      {
        onError: (cause) =>
          toast.error(
            cause instanceof ApiError ? cause.message : "That could not be saved.",
          ),
      },
    );
  }

  if (byLine && currentName) {
    // Known without anybody being asked. State it, offer no prompt — and still
    // allow a correction, because a customer who rang the truck number after
    // a neighbour recommended them came from the neighbour.
    return (
      <div className="space-y-1.5">
        <p className="text-sm">
          {currentName}
          <span className="ml-1.5 text-[12px] text-app-muted-2">
            · the line they called
          </span>
        </p>
        <Chips
          options={options}
          current={current}
          disabled={update.isPending}
          onChoose={choose}
        />
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {currentName ? (
        <p className="text-sm">
          {currentName}
          <span className="ml-1.5 text-[12px] text-app-muted-2">
            · somebody said so
          </span>
        </p>
      ) : (
        <p className="text-[12px] text-app-muted-2">
          Ask them: how did you hear about us?
        </p>
      )}
      <Chips
        options={options}
        current={current}
        disabled={update.isPending}
        onChoose={choose}
      />
    </div>
  );
}

function Chips({
  options,
  current,
  disabled,
  onChoose,
}: {
  options: { id: string; name: string }[];
  current: string | null;
  disabled: boolean;
  onChoose: (id: string | null) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((source) => {
        const selected = source.id === current;
        return (
          <Button
            key={source.id}
            variant="ghost"
            size="sm"
            aria-pressed={selected}
            disabled={disabled}
            // Tapping the chosen one again clears it: the fastest way back
            // from a mistap is the control you just used.
            onClick={() => onChoose(selected ? null : source.id)}
            className={
              "h-auto rounded-full border px-2.5 py-1 text-[12px] " +
              (selected
                ? "border-primary/50 bg-accent/50"
                : "border-border-subtle")
            }
          >
            {source.name}
          </Button>
        );
      })}
      {current !== null && (
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          onClick={() => onChoose(null)}
          className="h-auto rounded-full px-2.5 py-1 text-[12px] text-muted-foreground"
        >
          Don&apos;t know
        </Button>
      )}
    </div>
  );
}
