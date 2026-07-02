/**
 * OneNumberManyPeople — the core JobText idea in one motif: a single business
 * number (a petrol speech-bubble tile, the app's own mark) feeding a shared
 * inbox that the whole crew can see. Three stone person-nodes connect to the one
 * petrol number.
 *
 * Grammar: 1.75 stroke, 10px radius, petrol accent + stone line/fill (grammar.ts).
 * Themeable, decorative-by-default. Used on the problem/positioning sections and
 * the /features/shared-inbox hero support.
 */

import { ArtRoot } from "../art-root";
import { RADIUS, RADIUS_SM, ink, type ArtProps } from "../grammar";

export function OneNumberManyPeople({ className, title }: ArtProps) {
  return (
    <ArtRoot viewBox="0 0 240 180" className={className} title={title}>
      {/* Connectors from the one number to the three crew nodes (drawn first,
          so nodes sit on top). Gentle curves, petrol at low alpha. */}
      <g stroke={ink.petrol} strokeOpacity={0.4}>
        <path d="M120 74 C 120 110, 70 118, 54 138" />
        <path d="M120 74 C 120 118, 120 122, 120 140" />
        <path d="M120 74 C 120 110, 170 118, 186 138" />
      </g>

      {/* The one business number — a petrol speech-bubble tile (the app mark). */}
      <g>
        <rect
          x={92}
          y={22}
          width={56}
          height={48}
          rx={RADIUS}
          fill={ink.petrol}
        />
        {/* bubble tail */}
        <path d="M108 68 L108 80 L120 68 Z" fill={ink.petrol} />
        {/* two message lines inside, in the surface color (reads as white ink) */}
        <line x1={104} y1={40} x2={136} y2={40} stroke={ink.surface} />
        <line x1={104} y1={52} x2={126} y2={52} stroke={ink.surface} />
      </g>

      {/* Three crew nodes — a shared inbox each person can see. Two front, one
          behind slightly, to read as a team, not a row. */}
      {[
        { x: 54, y: 138 },
        { x: 120, y: 140 },
        { x: 186, y: 138 },
      ].map((p, i) => (
        <g key={i}>
          {/* device/card the person holds — a mini shared-inbox surface */}
          <rect
            x={p.x - 16}
            y={p.y - 8}
            width={32}
            height={26}
            rx={RADIUS_SM}
            fill={ink.surface}
            stroke={ink.line}
          />
          <line
            x1={p.x - 10}
            y1={p.y}
            x2={p.x + 6}
            y2={p.y}
            stroke={ink.petrol}
          />
          <line
            x1={p.x - 10}
            y1={p.y + 8}
            x2={p.x + 2}
            y2={p.y + 8}
            stroke={ink.line}
          />
          {/* petrol presence dot — "seen by everyone" */}
          <circle cx={p.x + 12} cy={p.y - 12} r={4} fill={ink.petrol} />
        </g>
      ))}
    </ArtRoot>
  );
}
