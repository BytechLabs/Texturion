"use client";

import { WORK_PHASE_LABELS, type WorkPhase } from "@loonext/shared";

import { useT } from "@/i18n/provider";
import { formatAbsoluteDateTime } from "@/lib/format/time";

/**
 * #294 — the line above one visit's photos.
 *
 * ## Evaluation
 *
 * The task drawer's file list was flat: a job with four site visits looked exactly
 * like a job with one, and nothing said which pictures were the finished work or who
 * took them. Everything needed to fix that was already in the data — each file knows
 * the note it arrived on, and a note has a time, an author and now a label.
 *
 * ## What binds it
 *
 * *Chunking* — one line per visit turns an undifferentiated list into three or four
 * groups, which is the number a person can hold. The label, the time and the name are
 * one line rather than three, because they answer one question: whose photos are
 * these and when.
 *
 * *Zen of Clarity* — the label is a quiet chip, not a coloured banner. Before and
 * after are equally ordinary; neither is a warning.
 *
 * *Meaningful Highlights* — the customer's own photos are named as theirs rather than
 * left as an unattributed group, because "who sent this" is the first thing anybody
 * asks of a photo they did not take.
 */
export function PhotoGroupHeader({
  phase,
  at,
  addedByUserId,
  fromCustomer,
  names,
}: {
  phase: WorkPhase | null;
  at: string;
  addedByUserId: string | null;
  fromCustomer: boolean;
  names?: Map<string, string>;
}) {
  const t = useT();
  const who = fromCustomer
    ? t("misc.photosFromCustomer")
    : (addedByUserId ? names?.get(addedByUserId) : null) ??
      t("misc.photosFromCrew");

  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
      {phase !== null && (
        <span className="rounded-full bg-app-hover px-2 py-0.5 text-[11.5px] font-medium text-app-ink">
          {WORK_PHASE_LABELS[phase]}
        </span>
      )}
      <span className="text-[12.5px] text-app-ink">{who}</span>
      <span className="text-[12px] text-app-muted">
        {formatAbsoluteDateTime(at)}
      </span>
    </div>
  );
}
