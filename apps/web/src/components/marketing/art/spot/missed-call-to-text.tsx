/**
 * MissedCallToText — "customers who won't leave a voicemail will text" (COPY §H8).
 * A missed-call phone (muted, stone, with a small warning dot) gives way to a
 * live petrol text bubble landing in the shared inbox.
 *
 * Grammar: 1.75 stroke, 10px radius, petrol + stone, amber reserved for the one
 * "missed" warning dot (VISUALS §2 — amber only for honesty/attention accents).
 * Themeable, decorative-by-default. Used on the missed-text math breather.
 */

import { ArtRoot } from "../art-root";
import { RADIUS, RADIUS_SM, ink, type ArtProps } from "../grammar";

export function MissedCallToText({ className, title }: ArtProps) {
  return (
    <ArtRoot viewBox="0 0 240 160" className={className} title={title}>
      {/* left: a muted phone handset with a missed-call badge */}
      <g>
        <rect
          x={26}
          y={30}
          width={64}
          height={100}
          rx={RADIUS}
          fill={ink.fill}
          stroke={ink.line}
        />
        {/* screen */}
        <rect
          x={34}
          y={40}
          width={48}
          height={72}
          rx={RADIUS_SM}
          fill={ink.surface}
          stroke={ink.line}
          strokeOpacity={0.6}
        />
        {/* a "missed call" phone glyph, stone/muted */}
        <path
          d="M46 66 Q46 62 50 62 L54 62 Q57 62 58 66 L59 71 Q60 74 57 76 L54 78
             Q60 88 70 92 L72 89 Q74 86 77 87 L82 88 Q86 89 86 93 L86 97
             Q86 101 82 101 Q58 101 46 78 Q46 72 46 66 Z"
          fill={ink.line}
          stroke="none"
        />
        {/* amber missed-call dot (the ONE amber accent) */}
        <circle cx={80} cy={40} r={7} fill={ink.amber} />
      </g>

      {/* petrol transform arrow */}
      <g stroke={ink.petrol}>
        <line x1={100} y1={80} x2={128} y2={80} />
        <path d="M122 73 L130 80 L122 87" fill="none" />
      </g>

      {/* right: the text lands in the shared inbox — petrol bubble on a card */}
      <g>
        <rect
          x={138}
          y={34}
          width={82}
          height={92}
          rx={RADIUS}
          fill={ink.surface}
          stroke={ink.line}
        />
        {/* inbound bubble */}
        <rect x={148} y={48} width={56} height={26} rx={RADIUS_SM} fill={ink.fill} stroke={ink.line} strokeOpacity={0.6} />
        <line x1={156} y1={58} x2={196} y2={58} stroke={ink.line} />
        <line x1={156} y1={66} x2={184} y2={66} stroke={ink.line} strokeOpacity={0.6} />
        {/* outbound petrol reply — answered */}
        <rect x={158} y={84} width={54} height={22} rx={RADIUS_SM} fill={ink.petrol} />
        <line x1={166} y1={95} x2={204} y2={95} stroke={ink.surface} />
      </g>
    </ArtRoot>
  );
}
