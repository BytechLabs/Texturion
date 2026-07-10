import { cn } from "@/lib/utils";

/**
 * The static "ConvergedField still" (P5-SPEC v2 §"Reduced-motion / pre-boot
 * static fallback", amendment 14): a composed still that IS the live CONFLUENCE
 * field's rest state. It is what SSR ships, what no-JS keeps, and what the
 * reduced-motion / save-data / low-memory paths keep.
 *
 * Amendment 14 makes the live field a FULL-BLEED centerpiece, so the still is
 * full-bleed too: a wide river of curl-noise streamlines sweeps in from the
 * left and upper edge and converges into the node at the inbox card's left
 * edge on the right. The final few strokes warm cobalt -> green (one earned
 * confluence) and a single green settle dot + ring marks the resolve. The
 * viewBox is wide (1200x600) and covers the hero via preserveAspectRatio
 * "slice"; a soft edge feather matches the live canvas mask. H1/body legibility
 * is provided by the hero's copy scrim, never by erasing the art.
 *
 * Transparent background only (the page's Signal White ground shows through and
 * is never repainted). Decorative: aria-hidden, no tab stops. Palette is
 * v4-locked: cobalt #2740DE in motion, green #0B7A50 at the resolve, no Flare.
 */

/** The dock node: where the live field resolves, at the inbox card's left
 *  edge. preserveAspectRatio="slice" on a tall hero scales the 1200x600 box
 *  by height and crops the sides, pushing x right on screen: ~700 here lands
 *  at the card's left edge on common desktop hero sizes (852 landed BEHIND
 *  the card, so the still read as spokes vanishing into it). */
const NODE = { x: 700, y: 300 };
const VW = 1200;
const VH = 600;

/** Tiny deterministic PRNG so SSR and client render identical path data. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

interface Stream {
  d: string;
  /** Pre-rounded to fixed decimals so SSR and client serialize identically
   *  (Math.pow can differ in the last ULP across V8 builds). */
  weight: string;
  opacity: string;
  green: boolean;
}

/** Build the frozen streamlines once (module scope): a wide field of cobalt
 *  paths curving rightward toward the node, the final few warmed to green. */
function buildStreams(): Stream[] {
  const rnd = mulberry32(0x0b7a5011);
  const total = 42;
  const streams: Stream[] = [];
  for (let i = 0; i < total; i += 1) {
    const fromTop = rnd() < 0.26;
    let sx: number;
    let sy: number;
    if (fromTop) {
      sx = 40 + rnd() * (NODE.x - 140);
      sy = -12;
    } else {
      sx = -12 + rnd() * 60;
      sy = 20 + rnd() * (VH - 40);
    }

    // Depth: thin/faint far, crisper near (matches the live z parallax).
    const z = Math.pow(rnd(), 1.5);
    const weight = 1.0 + 1.6 * z;

    // Two control points sweep the curve rightward toward the node with a
    // pronounced vertical wander (the laminar curl look), converging near
    // NODE.y. The wander is wide so the still reads as silk, not spokes.
    const c1x = sx + (NODE.x - sx) * (0.32 + 0.1 * rnd());
    const c1y = sy + (NODE.y - sy) * 0.2 + (rnd() - 0.5) * 320;
    const c2x = sx + (NODE.x - sx) * (0.74 + 0.1 * rnd());
    const c2y = NODE.y + (rnd() - 0.5) * 170;

    // Ends fan slightly around the node (soft rosette); the greens land on it.
    const green = i >= total - 6;
    const ex = green ? NODE.x : NODE.x - 8 - rnd() * 34;
    const ey = green ? NODE.y : NODE.y + (rnd() - 0.5) * 44;

    streams.push({
      d: `M${sx.toFixed(1)} ${sy.toFixed(1)} C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${ex.toFixed(1)} ${ey.toFixed(1)}`,
      weight: weight.toFixed(2),
      // Sized to READ against Signal White without turning into wire: the
      // original 0.05-0.10 cobalt was invisible at arm's length (#84's "not
      // just a static hero"); 0.10-0.20 reads as quiet silk.
      opacity: (green ? 0.22 + 0.12 * z : 0.1 + 0.1 * z).toFixed(3),
      green,
    });
  }
  return streams;
}

const STREAMS = buildStreams();

export function ArrivalStatic({ className }: { className?: string }) {
  return (
    <svg
      viewBox={`0 0 ${VW} ${VH}`}
      className={cn("h-full w-full", className)}
      aria-hidden="true"
      focusable="false"
      preserveAspectRatio="xMidYMid slice"
    >
      <defs>
        {/* Soft edge feather: matches the live canvas mask so the crossfade is
            seamless and no streamline hard-clips at the hero's edges. */}
        <linearGradient id="fr-still-fade-x" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="white" stopOpacity="0" />
          <stop offset="0.06" stopColor="white" stopOpacity="1" />
          <stop offset="0.95" stopColor="white" stopOpacity="1" />
          <stop offset="1" stopColor="white" stopOpacity="0" />
        </linearGradient>
        <mask id="fr-still-mask">
          <rect x="0" y="0" width={VW} height={VH} fill="url(#fr-still-fade-x)" />
        </mask>
      </defs>

      <g mask="url(#fr-still-mask)" fill="none" strokeLinecap="round">
        {STREAMS.map((s, i) => (
          <path
            key={i}
            d={s.d}
            stroke={s.green ? "var(--fr-green)" : "var(--fr-cobalt)"}
            strokeOpacity={s.opacity}
            strokeWidth={s.weight}
          />
        ))}

        {/* The one earned resolve, frozen: settle ring + dot at the node. */}
        <circle
          cx={NODE.x}
          cy={NODE.y}
          r="10"
          fill="none"
          stroke="var(--fr-green)"
          strokeOpacity="0.5"
          strokeWidth="1.5"
        />
        <circle cx={NODE.x} cy={NODE.y} r="2.6" fill="var(--fr-green)" />
      </g>
    </svg>
  );
}
