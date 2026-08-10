"use client";

import {
  WORK_PHASES,
  WORK_PHASE_HINT,
  WORK_PHASE_LABELS,
  type WorkPhase,
} from "@loonext/shared";

import { useT } from "@/i18n/provider";
import { cn } from "@/lib/utils";

/**
 * #294 — before or after, on the note carrying the photos.
 *
 * ## Evaluation
 *
 * A tech attaching photos to a note has one more thing to say, and it is the one
 * classification the trade actually uses: is this how it looked when I arrived, or
 * how I left it. The whole value depends on it costing nothing — a tech standing in
 * somebody's kitchen with wet hands will not open a menu.
 *
 * ## What binds it
 *
 * *Prioritize Intent* — it appears only once there are photos. A before/after choice
 * on a text-only note is noise on the most common thing anybody does in this
 * composer.
 *
 * *Smart Defaults, and the one place the rule inverts* — nothing is preselected.
 * Everywhere else a sensible default saves a decision; here it would invent one. Most
 * notes are neither, so defaulting to "Before" would mislabel the majority, and a job
 * record that is confidently wrong is worse than one that says nothing.
 *
 * *Zen of Clarity* — two chips, not a three-option dropdown with "None". Tapping the
 * selected one clears it, so there is no third control for undo.
 *
 * *Relationship Strength* — tight under the staged photos it describes, inside the
 * same width, because it is a property of those files rather than of the note's text.
 */
export function WorkPhasePicker({
  value,
  onChange,
}: {
  value: WorkPhase | null;
  onChange: (next: WorkPhase | null) => void;
}) {
  const t = useT();
  return (
    <div
      className="mx-auto flex max-w-[42rem] flex-wrap items-center gap-1.5 px-1 pb-2"
      role="group"
      aria-label={t("thread.whatPhotosShowAria")}
    >
      {WORK_PHASES.map((phase) => {
        const on = value === phase;
        return (
          <button
            key={phase}
            type="button"
            // Toggle rather than radio: `aria-pressed` is what says "tap again to
            // turn this off", which is exactly what the control does.
            aria-pressed={on}
            onClick={() => onChange(on ? null : phase)}
            className={cn(
              "rounded-full border px-2.5 py-1 text-[12.5px] transition-colors",
              on
                ? "border-transparent bg-app-ink text-app-paper"
                : "border-app-line text-muted-foreground hover:bg-app-hover",
            )}
          >
            {WORK_PHASE_LABELS[phase]}
          </button>
        );
      })}
      <span className="text-[12px] text-muted-foreground">{WORK_PHASE_HINT}</span>
    </div>
  );
}
