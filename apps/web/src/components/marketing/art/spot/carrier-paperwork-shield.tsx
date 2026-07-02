/**
 * CarrierPaperworkShield — "we handle the carrier paperwork". A petrol shield
 * with a check, over a small stack of registration forms — the compliance work
 * absorbed by the product (CONVERSION §3: reframe complexity as done-for-you).
 *
 * Grammar: 1.75 stroke, 10px radius, petrol + stone. Themeable, decorative-by-
 * default. Used on the compliance section and /features/compliance.
 */

import { ArtRoot } from "../art-root";
import { RADIUS_SM, ink, type ArtProps } from "../grammar";

export function CarrierPaperworkShield({ className, title }: ArtProps) {
  return (
    <ArtRoot viewBox="0 0 240 180" className={className} title={title}>
      {/* stacked forms behind the shield — the paperwork being handled */}
      <g>
        <rect
          x={62}
          y={58}
          width={74}
          height={96}
          rx={RADIUS_SM}
          fill={ink.surface}
          stroke={ink.line}
          transform="rotate(-8 99 106)"
        />
        <rect
          x={70}
          y={54}
          width={74}
          height={96}
          rx={RADIUS_SM}
          fill={ink.fill}
          stroke={ink.line}
          transform="rotate(-2 107 102)"
        />
        {/* top form with ruled lines */}
        <g transform="rotate(3 116 100)">
          <rect
            x={80}
            y={50}
            width={74}
            height={96}
            rx={RADIUS_SM}
            fill={ink.surface}
            stroke={ink.line}
          />
          <line x1={90} y1={68} x2={144} y2={68} stroke={ink.line} strokeOpacity={0.6} />
          <line x1={90} y1={82} x2={136} y2={82} stroke={ink.line} strokeOpacity={0.6} />
          <line x1={90} y1={96} x2={144} y2={96} stroke={ink.line} strokeOpacity={0.6} />
          <line x1={90} y1={110} x2={124} y2={110} stroke={ink.line} strokeOpacity={0.6} />
        </g>
      </g>

      {/* the petrol shield with a check — the product takes it on */}
      <g>
        <path
          d="M158 44 L196 56 L196 96 Q196 120 158 138 Q120 120 120 96 L120 56 Z"
          fill={ink.petrol}
        />
        {/* soft inner ring for depth */}
        <path
          d="M158 56 L186 65 L186 94 Q186 111 158 125 Q130 111 130 94 L130 65 Z"
          fill={ink.petrol}
          stroke={ink.surface}
          strokeOpacity={0.25}
        />
        {/* check */}
        <path
          d="M144 90 L154 100 L174 78"
          stroke={ink.surface}
          strokeWidth={2.5}
        />
      </g>
    </ArtRoot>
  );
}
