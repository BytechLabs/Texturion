/**
 * CoverageMapNA (infographic) — a simple, real US + Canada map with a petrol
 * coverage wash (VISUALS §1C, BLUEPRINT §3.10). Simplified geographic silhouettes
 * (Stripe-restraint, not a detailed atlas): Canada above, the US lower-48 below,
 * both filled with the petrol coverage tint, with two petrol pins marking "local
 * numbers, both countries".
 *
 * Honesty (VISUALS §6): JobText serves the US and Canada (SPEC §1 ICP), so both
 * countries are washed — no coverage claimed that the product doesn't have.
 * Alaska/Hawaii are omitted from this stylized silhouette by design (the shape is
 * a recognizable motif, not a survey map); this is a marketing illustration, not a
 * coverage guarantee for specific territories.
 *
 * Grammar: petrol wash + stone borders, 1.75 stroke. Themeable, labelled.
 */

import { ArtRoot } from "../art-root";
import { ink, type ArtProps } from "../grammar";

/** Simplified Canada silhouette (stylized, recognizable). */
const CANADA =
  "M40 78 L70 62 L86 70 L120 54 L150 66 L188 52 L232 60 L268 50 L300 62 " +
  "L332 54 L352 70 L340 88 L360 96 L344 108 L356 120 L300 116 L260 124 " +
  "L210 118 L150 126 L96 118 L58 108 L44 94 Z";

/** Simplified US lower-48 silhouette (stylized, recognizable). */
const USA =
  "M78 126 L150 130 L210 124 L262 130 L320 122 L330 138 L318 156 L300 158 " +
  "L286 178 L262 176 L250 190 L232 176 L200 172 L150 168 L110 160 L86 150 " +
  "L74 138 Z";

export function CoverageMapNA({
  className,
  title = "JobText coverage: local business numbers across the United States and Canada",
}: ArtProps) {
  return (
    <ArtRoot viewBox="0 0 400 210" className={className} title={title}>
      {/* Canada — petrol coverage wash */}
      <path d={CANADA} fill={ink.petrolSoft} stroke={ink.petrol} strokeOpacity={0.7} />
      {/* US — a slightly stronger wash to read as the two distinct countries */}
      <path d={USA} fill={ink.petrolSoft} stroke={ink.petrol} strokeOpacity={0.7} />

      {/* faint national divider (the 49th-parallel hint) */}
      <path
        d="M60 120 L110 126 L200 121 L300 122 L344 118"
        stroke={ink.surface}
        strokeOpacity={0.6}
        strokeDasharray="1 5"
      />

      {/* two petrol location pins — a number in each country */}
      {[
        { x: 150, y: 92 }, // Canada
        { x: 210, y: 148 }, // US
      ].map((p, i) => (
        <g key={i}>
          <path
            d={`M${p.x} ${p.y - 18} Q${p.x + 11} ${p.y - 18} ${p.x + 11} ${p.y - 8}
                Q${p.x + 11} ${p.y} ${p.x} ${p.y + 8}
                Q${p.x - 11} ${p.y} ${p.x - 11} ${p.y - 8}
                Q${p.x - 11} ${p.y - 18} ${p.x} ${p.y - 18} Z`}
            fill={ink.petrol}
          />
          <circle cx={p.x} cy={p.y - 9} r={4} fill={ink.surface} />
        </g>
      ))}
    </ArtRoot>
  );
}
