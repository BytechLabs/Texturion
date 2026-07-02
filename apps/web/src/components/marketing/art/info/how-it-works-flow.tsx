/**
 * HowItWorksFlow (infographic V1) — the three-step onboarding diagram:
 * 1) Pick your number  2) Invite the crew  3) Text customers (COPY §H5).
 * VISUALS §1C, BLUEPRINT §10.2 / §3.5. Three numbered petrol circles joined by a
 * dashed petrol connector (1.75 stroke), each with a small glyph and label.
 *
 * Responsive intent: the SVG lays the three steps horizontally; on narrow screens
 * the consumer renders it in a container that stacks (the accompanying DOM version
 * handles the vertical mobile stack — this SVG is the horizontal designed rail for
 * the section and OG use).
 *
 * Grammar: 1.75 stroke, petrol accent + stone. Themeable, labelled (real steps).
 */

import { ArtRoot } from "../art-root";
import { RADIUS_SM, ink, type ArtProps } from "../grammar";

const STEPS = [
  { n: 1, label: "Pick your number" },
  { n: 2, label: "Invite the crew" },
  { n: 3, label: "Text customers" },
];

const CX = [70, 210, 350];

/** A tiny glyph per step, drawn inside its numbered circle's companion tile. */
function StepGlyph({ step, x }: { step: number; x: number }) {
  const y = 96;
  if (step === 1) {
    // a phone-number tile
    return (
      <g>
        <rect x={x - 20} y={y - 14} width={40} height={28} rx={RADIUS_SM} fill={ink.petrolSoft} stroke={ink.petrol} />
        <line x1={x - 12} y1={y - 4} x2={x + 12} y2={y - 4} stroke={ink.petrol} />
        <line x1={x - 12} y1={y + 5} x2={x + 6} y2={y + 5} stroke={ink.petrol} strokeOpacity={0.6} />
      </g>
    );
  }
  if (step === 2) {
    // three crew dots joined by a link
    return (
      <g>
        <circle cx={x - 14} cy={y} r={6} fill={ink.petrolSoft} stroke={ink.petrol} />
        <circle cx={x} cy={y} r={6} fill={ink.petrolSoft} stroke={ink.petrol} />
        <circle cx={x + 14} cy={y} r={6} fill={ink.petrolSoft} stroke={ink.petrol} />
        <line x1={x - 8} y1={y} x2={x + 8} y2={y} stroke={ink.petrol} strokeOpacity={0.5} />
      </g>
    );
  }
  // step 3: an outbound bubble
  return (
    <g>
      <rect x={x - 20} y={y - 14} width={40} height={26} rx={RADIUS_SM} fill={ink.petrol} />
      <path d={`M${x - 12} ${y + 12} L${x - 12} ${y + 20} L${x - 2} ${y + 12} Z`} fill={ink.petrol} />
      <line x1={x - 12} y1={y - 4} x2={x + 12} y2={y - 4} stroke={ink.surface} />
    </g>
  );
}

export function HowItWorksFlow({
  className,
  title = "How it works in three steps: pick your number, invite the crew, text customers",
}: ArtProps) {
  return (
    <ArtRoot viewBox="0 0 420 150" className={className} title={title}>
      {/* dashed petrol connector between the numbered circles */}
      <g stroke={ink.petrol} strokeOpacity={0.5} strokeDasharray="2 7">
        <line x1={CX[0] + 22} y1={40} x2={CX[1] - 22} y2={40} />
        <line x1={CX[1] + 22} y1={40} x2={CX[2] - 22} y2={40} />
      </g>

      {STEPS.map((s, i) => (
        <g key={s.n}>
          {/* numbered petrol circle */}
          <circle cx={CX[i]} cy={40} r={20} fill={ink.petrol} />
          <text
            x={CX[i]}
            y={47}
            textAnchor="middle"
            fontSize={18}
            fontWeight={600}
            fill={ink.surface}
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            {s.n}
          </text>
          <StepGlyph step={s.n} x={CX[i]} />
          <text
            x={CX[i]}
            y={134}
            textAnchor="middle"
            fontSize={12}
            fontWeight={500}
            fill={ink.petrol}
          >
            {s.label}
          </text>
        </g>
      ))}
    </ArtRoot>
  );
}
