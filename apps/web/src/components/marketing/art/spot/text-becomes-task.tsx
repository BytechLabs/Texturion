/**
 * TextBecomesTask — "your text is a task" (VISUALS §1B example, DESIGN.md D14 the
 * done-mark). A customer message bubble on the left transforms into a checked-off,
 * struck-through handled item on the right, joined by a petrol arrow.
 *
 * Grammar: 1.75 stroke, 10px radius, petrol accent + stone. Themeable,
 * decorative-by-default. Used on the features/done-mark beats.
 */

import { ArtRoot } from "../art-root";
import { RADIUS, ink, type ArtProps } from "../grammar";

export function TextBecomesTask({ className, title }: ArtProps) {
  return (
    <ArtRoot viewBox="0 0 240 140" className={className} title={title}>
      {/* left: an inbound message bubble (white card, stone edge) */}
      <g>
        <rect
          x={16}
          y={40}
          width={78}
          height={54}
          rx={RADIUS}
          fill={ink.surface}
          stroke={ink.line}
        />
        <path d="M28 92 L28 104 L42 92 Z" fill={ink.surface} stroke={ink.line} />
        <line x1={28} y1={58} x2={82} y2={58} stroke={ink.line} />
        <line x1={28} y1={70} x2={72} y2={70} stroke={ink.line} strokeOpacity={0.6} />
        <line x1={28} y1={82} x2={60} y2={82} stroke={ink.line} strokeOpacity={0.6} />
      </g>

      {/* petrol transform arrow */}
      <g stroke={ink.petrol}>
        <line x1={104} y1={67} x2={134} y2={67} />
        <path d="M128 60 L136 67 L128 74" fill="none" />
      </g>

      {/* right: the handled task — a petrol-checked, struck-through item */}
      <g>
        <rect
          x={146}
          y={40}
          width={78}
          height={54}
          rx={RADIUS}
          fill={ink.petrolSoft}
          stroke={ink.petrol}
        />
        {/* petrol check chip */}
        <circle cx={166} cy={58} r={8} fill={ink.petrol} />
        <path d="M162 58 L165 61 L171 55" stroke={ink.surface} strokeWidth={2} />
        {/* struck-through message lines (the D14 done-mark) */}
        <line x1={180} y1={58} x2={214} y2={58} stroke={ink.petrol} />
        <line x1={158} y1={72} x2={214} y2={72} stroke={ink.line} strokeOpacity={0.55} />
        <line x1={158} y1={72} x2={214} y2={72} stroke={ink.petrol} strokeOpacity={0.9} />
        <line x1={158} y1={84} x2={196} y2={84} stroke={ink.line} strokeOpacity={0.55} />
        <line x1={158} y1={84} x2={196} y2={84} stroke={ink.petrol} strokeOpacity={0.9} />
      </g>
    </ArtRoot>
  );
}
