/**
 * CanadaMotif — the Canada-first position, tasteful not flag-waving (VISUALS §2:
 * "tasteful, not flag-waving"). A geometric maple leaf built in the petrol
 * accent, paired with a small speech bubble — "text customers the same day".
 *
 * Grammar: 1.75 stroke, 10px radius, petrol + stone. Themeable, decorative-by-
 * default. Used on the home Canada beat and /canada.
 */

import { ArtRoot } from "../art-root";
import { RADIUS_SM, ink, type ArtProps } from "../grammar";

export function CanadaMotif({ className, title }: ArtProps) {
  return (
    <ArtRoot viewBox="0 0 240 180" className={className} title={title}>
      {/* soft petrol tint disc behind the leaf, for depth */}
      <circle cx={112} cy={92} r={64} fill={ink.petrolSoft} />

      {/*
        A simplified, geometric 11-point maple leaf in petrol. Kept as one filled
        path so it reads as a confident mark, not a botanical drawing. Centered
        near (112, 92).
      */}
      <path
        d="M112 34
           L118 58 L134 50 L129 70 L154 66 L143 82 L160 90 L143 98 L154 114 L129 110
           L134 130 L118 122 L114 150 L110 122 L94 130 L99 110 L74 114 L85 98 L68 90
           L85 82 L74 66 L99 70 L94 50 L110 58 Z"
        fill={ink.petrol}
      />

      {/* a small "day one" speech bubble, upper-right, in surface + petrol edge */}
      <g>
        <rect
          x={168}
          y={40}
          width={48}
          height={32}
          rx={RADIUS_SM}
          fill={ink.surface}
          stroke={ink.petrol}
        />
        <path d="M178 70 L178 80 L190 70 Z" fill={ink.surface} stroke={ink.petrol} />
        <line x1={176} y1={51} x2={208} y2={51} stroke={ink.petrol} />
        <line x1={176} y1={61} x2={200} y2={61} stroke={ink.petrol} strokeOpacity={0.6} />
      </g>
    </ArtRoot>
  );
}
