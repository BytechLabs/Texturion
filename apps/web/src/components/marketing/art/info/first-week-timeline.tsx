/**
 * FirstWeekTimeline (infographic V2) — the honest US wait drawn as a designed
 * rail: Day 0 (live: number up, receiving works, Canada texting live) →
 * Days 1–7 (amber "carrier review" segment) → Approved (US texting on).
 * VISUALS §1C, BLUEPRINT §10.2 / §3.5, SPEC §4.1. Win-first: the rail leads with
 * everything that works on day one, then shows the bounded wait as art.
 *
 * This is the reusable SVG rail primitive (the home page also has a DOM-composed
 * version for its expressive numeral-display moment; this SVG twin is what
 * /pricing and /features/compliance consume). Every number traces to SPEC/COPY —
 * "3–7 business days" is the checkout copy in substance.
 *
 * Grammar: 1.75 stroke, petrol (live/approved) + amber (the bounded wait, the one
 * honesty accent) + stone. Themeable, labelled (real information → not decorative).
 */

import { ArtRoot } from "../art-root";
import { ink, type ArtProps } from "../grammar";

const NODE = [
  { cx: 40, label: "Day 0", sub: "You're live", tone: "petrol" as const },
  { cx: 200, label: "Days 1–7", sub: "Carrier review", tone: "amber" as const },
  { cx: 360, label: "Approved", sub: "US texting on", tone: "petrol" as const },
];

export function FirstWeekTimeline({
  className,
  title = "Your first week: live on day zero, US texting on after a roughly one-week carrier review",
}: ArtProps) {
  return (
    <ArtRoot viewBox="0 0 400 120" className={className} title={title}>
      {/* the rail: petrol → amber wait → petrol, drawn as three segments */}
      <g strokeWidth={4}>
        <line x1={40} y1={44} x2={200} y2={44} stroke={ink.petrol} />
        <line
          x1={200}
          y1={44}
          x2={360}
          y2={44}
          stroke={ink.amber}
          strokeDasharray="2 8"
        />
      </g>

      {NODE.map((n) => {
        const c = n.tone === "petrol" ? ink.petrol : ink.amber;
        const soft = n.tone === "petrol" ? ink.petrolSoft : ink.amberSoft;
        return (
          <g key={n.label}>
            <circle cx={n.cx} cy={44} r={12} fill={soft} stroke={c} strokeWidth={2.5} />
            <circle cx={n.cx} cy={44} r={4} fill={c} stroke="none" />
            <text
              x={n.cx}
              y={80}
              textAnchor="middle"
              fontSize={14}
              fontWeight={600}
              fill={ink.petrol}
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {n.label}
            </text>
            <text
              x={n.cx}
              y={98}
              textAnchor="middle"
              fontSize={11}
              fill={ink.line}
            >
              {n.sub}
            </text>
          </g>
        );
      })}

      {/* the amber wait, named honestly above its segment */}
      <text
        x={280}
        y={30}
        textAnchor="middle"
        fontSize={11}
        fontWeight={500}
        fill={ink.amber}
      >
        ~3–7 business days
      </text>
    </ArtRoot>
  );
}
