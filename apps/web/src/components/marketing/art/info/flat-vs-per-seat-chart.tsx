/**
 * FlatVsPerSeatChart (infographic V3) — flat petrol line vs a climbing stone line
 * over 1–10 seats (VISUALS §1C, BLUEPRINT §10.2 / §3.9). The static SVG twin of
 * the crew-size slider, for no-JS and OG use: JobText's flat plan price ($29 up to
 * 3 seats, $79 to 10) against a typical per-user tool at $19/user/mo.
 *
 * Sourcing (§13.7, BLUEPRINT §6): the per-user figure is a real, dated published
 * price — $19/user/mo as of July 2026 — labelled on the chart and matching the
 * crew-size slider's PER_USER_MONTHLY so the two visuals never disagree. The flat
 * step ($29 → $79 at 4 seats) follows SPEC §2.
 *
 * Grammar: petrol (flat, the win) + stone (climbing) lines, 1.75→2.5 stroke for
 * the data lines. Themeable, labelled (real, dated data).
 */

import { ArtRoot } from "../art-root";
import { ink, type ArtProps } from "../grammar";

/** Must match crew-size-slider.tsx PER_USER_MONTHLY (July 2026 published seat price). */
const PER_USER_MONTHLY = 19;

/** JobText flat plan price by seat count (SPEC §2). */
function jobtextPrice(seats: number): number {
  return seats <= 3 ? 29 : 79;
}

// Plot area within the 400×220 viewBox.
const X0 = 44;
const X1 = 372;
const Y0 = 176; // $0 baseline
const Y1 = 28; // top
const MAX = 10 * PER_USER_MONTHLY; // $190 — the per-user line's ceiling at 10 seats

const sx = (seats: number) => X0 + ((seats - 1) / 9) * (X1 - X0);
const sy = (dollars: number) => Y0 - (dollars / MAX) * (Y0 - Y1);

function polyline(fn: (seats: number) => number): string {
  return Array.from({ length: 10 }, (_, i) => {
    const seats = i + 1;
    return `${sx(seats)},${sy(fn(seats))}`;
  }).join(" ");
}

export function FlatVsPerSeatChart({
  className,
  title = "Flat pricing versus per-user: JobText stays $29–$79 while a $19/user tool climbs with crew size",
}: ArtProps) {
  const jobtextPts = polyline(jobtextPrice);
  const perUserPts = polyline((s) => s * PER_USER_MONTHLY);

  return (
    <ArtRoot viewBox="0 0 400 220" className={className} title={title}>
      {/* axes */}
      <line x1={X0} y1={Y0} x2={X1} y2={Y0} stroke={ink.line} strokeOpacity={0.6} />
      <line x1={X0} y1={Y0} x2={X0} y2={Y1} stroke={ink.line} strokeOpacity={0.6} />

      {/* faint horizontal gridlines at $50/$100/$150 */}
      {[50, 100, 150].map((d) => (
        <g key={d}>
          <line
            x1={X0}
            y1={sy(d)}
            x2={X1}
            y2={sy(d)}
            stroke={ink.line}
            strokeOpacity={0.18}
            strokeDasharray="2 6"
          />
          <text x={X0 - 8} y={sy(d) + 4} textAnchor="end" fontSize={10} fill={ink.line} style={{ fontVariantNumeric: "tabular-nums" }}>
            ${d}
          </text>
        </g>
      ))}

      {/* per-user climbing line (stone) */}
      <polyline points={perUserPts} fill="none" stroke={ink.line} strokeWidth={2.5} />
      {/* end marker + label */}
      <circle cx={sx(10)} cy={sy(10 * PER_USER_MONTHLY)} r={4} fill={ink.line} />
      <text x={sx(10)} y={sy(10 * PER_USER_MONTHLY) - 10} textAnchor="end" fontSize={11} fontWeight={600} fill={ink.line} style={{ fontVariantNumeric: "tabular-nums" }}>
        $190
      </text>

      {/* JobText flat line (petrol, the win) */}
      <polyline points={jobtextPts} fill="none" stroke={ink.petrol} strokeWidth={2.5} />
      {/* the $29→$79 step markers */}
      <circle cx={sx(3)} cy={sy(29)} r={4} fill={ink.petrol} />
      <circle cx={sx(10)} cy={sy(79)} r={4} fill={ink.petrol} />
      <text x={sx(1) + 4} y={sy(29) - 10} fontSize={11} fontWeight={600} fill={ink.petrol} style={{ fontVariantNumeric: "tabular-nums" }}>
        $29–$79 flat
      </text>

      {/* x-axis seat labels (ends only, to stay tidy) */}
      <text x={sx(1)} y={Y0 + 16} textAnchor="middle" fontSize={10} fill={ink.line} style={{ fontVariantNumeric: "tabular-nums" }}>
        1
      </text>
      <text x={sx(10)} y={Y0 + 16} textAnchor="middle" fontSize={10} fill={ink.line} style={{ fontVariantNumeric: "tabular-nums" }}>
        10 people
      </text>

      {/* dated per-user source (§13.7) */}
      <text x={X0} y={210} fontSize={9} fill={ink.line} fillOpacity={0.8}>
        Per-user line: $19/user/mo, published seat price, July 2026.
      </text>
    </ArtRoot>
  );
}
