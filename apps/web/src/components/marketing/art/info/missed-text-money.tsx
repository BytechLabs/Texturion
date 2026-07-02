/**
 * MissedTextMoney — the missed-conversation arithmetic as a coins/bars visual
 * for the §3.7 calculator (VISUALS §1C, COPY §H8). Renders a small stack of coin
 * discs whose height tracks the computed "revenue at risk", beside the flat $29
 * JobText line — the honest comparison the calculator lands on.
 *
 * Honesty (VISUALS §6): the numbers are the USER'S inputs multiplied in the open;
 * this component only VISUALIZES whatever `monthly` the calculator passes. It
 * invents no default and asserts no industry stat.
 *
 * Grammar: 1.75 stroke, petrol + stone, amber reserved for the "at risk" stack.
 * Themeable, decorative (the real figure is announced by the calculator's
 * aria-live output; this is the picture beside it).
 */

import { ArtRoot } from "../art-root";
import { ink } from "../grammar";

export interface MissedTextMoneyProps {
  /** The computed monthly revenue-at-risk (USD) from the calculator. */
  monthly: number;
  className?: string;
}

export function MissedTextMoney({ monthly, className }: MissedTextMoneyProps) {
  // Coin count scales gently with the figure, capped so the motif stays tidy.
  // Purely presentational — the exact dollar value is the calculator's job.
  const coins = Math.max(1, Math.min(7, Math.round(monthly / 250) || 1));
  const stackTop = 132 - coins * 14;

  return (
    <ArtRoot viewBox="0 0 240 160" className={className}>
      {/* baseline */}
      <line x1={20} y1={144} x2={220} y2={144} stroke={ink.line} strokeOpacity={0.5} />

      {/* LEFT: the "at risk" coin stack (amber — money walking away) */}
      <g>
        {Array.from({ length: coins }).map((_, i) => {
          const cy = 130 - i * 14;
          return (
            <g key={i}>
              <ellipse cx={72} cy={cy} rx={34} ry={9} fill={ink.amberSoft} stroke={ink.amber} />
              <line x1={62} y1={cy} x2={82} y2={cy} stroke={ink.amber} strokeOpacity={0.7} />
            </g>
          );
        })}
        <text
          x={72}
          y={stackTop - 8}
          textAnchor="middle"
          fontSize={13}
          fontWeight={600}
          fill={ink.amber}
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          at risk
        </text>
      </g>

      {/* RIGHT: JobText — one short, flat petrol coin: $29 */}
      <g>
        <ellipse cx={168} cy={130} rx={34} ry={9} fill={ink.petrolSoft} stroke={ink.petrol} />
        <rect x={134} y={112} width={68} height={18} fill={ink.petrolSoft} />
        <ellipse cx={168} cy={112} rx={34} ry={9} fill={ink.petrolSoft} stroke={ink.petrol} />
        <text
          x={168}
          y={104}
          textAnchor="middle"
          fontSize={16}
          fontWeight={600}
          fill={ink.petrol}
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          $29
        </text>
        <text
          x={168}
          y={150}
          textAnchor="middle"
          fontSize={11}
          fill={ink.line}
        >
          JobText, flat
        </text>
      </g>

      {/* small divider between the two stacks */}
      <line
        x1={120}
        y1={40}
        x2={120}
        y2={140}
        stroke={ink.line}
        strokeOpacity={0.3}
        strokeDasharray="3 5"
      />
    </ArtRoot>
  );
}
