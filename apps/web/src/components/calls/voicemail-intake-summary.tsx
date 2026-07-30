import { AiOrb } from "@/components/ui/ai-orb";
import { cn } from "@/lib/utils";
import {
  voicemailIntakeLines,
  VOICEMAIL_INTAKE_SOURCE_LABEL,
  type VoicemailIntake,
} from "@loonext/shared";

/**
 * #367 depth (1) — what the caller said, above the transcript it came from.
 *
 * ABOVE, and that is the whole layout decision. The transcript is the record;
 * this is the shortcut, and a shortcut printed after the thing it shortens is
 * not one. Somebody glancing at a row on a roof reads two labelled lines and
 * knows whether to call back — the transcript stays underneath for when those
 * two lines are not enough, which is the same relationship the player already
 * has to the transcript.
 *
 * Tight spacing to the transcript, looser to the player: strong semantic
 * relationships get less air than weak ones, and these two are the same fact
 * twice.
 *
 * Rows for present fields only, never a labelled blank. `voicemailIntakeLines`
 * enforces it for all three clients — a blank "Address:" reads as "we looked
 * and the caller gave none", which is a claim we cannot make.
 *
 * The Lou mark plus "From the voicemail" is PORTAL-UX §3.1's requirement that a
 * card name the signal that placed it. The mark says a machine did this; the
 * label says where it read it; the transcript directly below is what makes both
 * checkable rather than a black box.
 */
export function VoicemailIntakeSummary({
  intake,
  className,
}: {
  intake: VoicemailIntake | null | undefined;
  className?: string;
}) {
  const lines = voicemailIntakeLines(intake);
  if (lines.length === 0) return null;

  return (
    <span className={cn("block", className)}>
      <span className="flex items-center gap-1 text-[11px] font-medium text-app-muted-2">
        <AiOrb state="idle" size={12} />
        {VOICEMAIL_INTAKE_SOURCE_LABEL}
      </span>
      {/* A definition list in spirit, built from spans because this whole row
          renders inside an anchor — a <dl> inside an <a> is invalid, and the
          calls list is one big link per row. */}
      <span className="mt-1 block space-y-0.5">
        {lines.map((line) => (
          <span key={line.key} className="flex gap-2 text-[12.5px] leading-[1.45]">
            {/* Fixed label column so the values line up down the block: four
                ragged left edges is four things to read instead of one. */}
            <span className="w-[68px] shrink-0 text-app-muted-2">{line.label}</span>
            <span className="min-w-0 flex-1 text-app-ink">{line.value}</span>
          </span>
        ))}
      </span>
    </span>
  );
}
