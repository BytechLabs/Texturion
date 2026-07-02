/**
 * FieldWorkerTruck — the "built for the truck, not the desk" idea: a service van
 * with a petrol speech-bubble on its side (the number lives on the truck, not on
 * a person's cell) and a texting notification rising from it.
 *
 * Grammar: 1.75 stroke, 10px radius, petrol + stone. Themeable, decorative-by-
 * default. Used on trade heroes and the dark-band / mobile beats.
 */

import { ArtRoot } from "../art-root";
import { RADIUS, RADIUS_SM, ink, type ArtProps } from "../grammar";

export function FieldWorkerTruck({ className, title }: ArtProps) {
  return (
    <ArtRoot viewBox="0 0 240 180" className={className} title={title}>
      {/* ground line */}
      <line x1={20} y1={150} x2={220} y2={150} stroke={ink.line} strokeOpacity={0.5} />

      {/* van body — cab + box, rounded corners in the 10px language */}
      <path
        d="M40 150 L40 96 Q40 90 46 90 L128 90 L150 66 L182 66 Q188 66 188 72 L188 150 Z"
        fill={ink.fill}
        stroke={ink.line}
      />
      {/* windshield */}
      <path
        d="M150 74 L172 74 Q176 74 176 78 L176 90 L150 90 Z"
        fill={ink.surface}
        stroke={ink.line}
      />

      {/* petrol number panel on the van side — the business owns the number */}
      <rect
        x={54}
        y={104}
        width={64}
        height={34}
        rx={RADIUS_SM}
        fill={ink.petrol}
      />
      <line x1={62} y1={116} x2={110} y2={116} stroke={ink.surface} />
      <line x1={62} y1={126} x2={98} y2={126} stroke={ink.surface} />

      {/* wheels */}
      <g fill={ink.surface} stroke={ink.line}>
        <circle cx={72} cy={150} r={13} />
        <circle cx={166} cy={150} r={13} />
      </g>
      <g fill={ink.line}>
        <circle cx={72} cy={150} r={4} />
        <circle cx={166} cy={150} r={4} />
      </g>

      {/* a text rising from the truck — a petrol bubble with a tail */}
      <g>
        <rect x={150} y={24} width={54} height={34} rx={RADIUS} fill={ink.surface} stroke={ink.petrol} />
        <path d="M162 56 L162 66 L174 56 Z" fill={ink.surface} stroke={ink.petrol} />
        <line x1={160} y1={36} x2={194} y2={36} stroke={ink.petrol} />
        <line x1={160} y1={46} x2={184} y2={46} stroke={ink.petrol} strokeOpacity={0.6} />
      </g>
    </ArtRoot>
  );
}
