"use client";

import { toast } from "sonner";

import Link from "next/link";
import { roleHasCapability } from "@loonext/shared";

import { ChoiceChip } from "@/components/ui/choice-chip";
import { useT } from "@/i18n/provider";
import { ApiError } from "@/lib/api/error";
import { useUpdateConversation } from "@/lib/api/conversations";
import { activeSources, useLeadSources } from "@/lib/api/lead-sources";
import type { ConversationDetail } from "@/lib/api/types";
import { useActiveCompany } from "@/lib/company/provider";

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
  const t = useT();
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
            cause instanceof ApiError
              ? cause.message
              : t("contacts.leadSourceSaveFailed"),
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
            {t("contacts.sourceFromLine")}
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
            {t("contacts.sourceSaidSo")}
          </span>
        </p>
      ) : (
        // #726: the empty state is a value of its own, said in words, so the
        // chips below read as choices rather than as the answer.
        <p className="text-sm text-app-muted">{t("contacts.sourceNotAsked")}</p>
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
  const t = useT();
  const { role } = useActiveCompany();
  const mayAdd = roleHasCapability(role, "settings.manage");
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((source) => {
        const selected = source.id === current;
        return (
          <ChoiceChip
            key={source.id}
            chosen={selected}
            aria-pressed={selected}
            disabled={disabled}
            onClick={() => onChoose(selected ? null : source.id)}
          >
            {source.name}
          </ChoiceChip>
        );
      })}
      {current !== null && (
        <ChoiceChip chosen={false} disabled={disabled} onClick={() => onChoose(null)}>
          {t("contacts.dontKnow")}
        </ChoiceChip>
      )}
      {/* #726: one source is still a question, so whoever can add another is
          offered the way to. */}
      {mayAdd && (
        <Link
          href="/settings/numbers#lead-sources"
          className="self-center px-1 text-[12px] text-app-muted underline decoration-app-line underline-offset-2 hover:text-app-ink"
        >
          {t("contacts.addLeadSource")}
        </Link>
      )}
    </div>
  );
}
