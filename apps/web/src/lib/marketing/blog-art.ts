/**
 * BLOG PLATES (#130 follow-up): the blog's visual identity. Every post gets a
 * unique, DETERMINISTIC composition seeded from its slug: curl-noise
 * streamlines converging on a dock point, sparse field ticks on a 48px grid.
 * This is the Arrival Field's converged still (P5-SPEC "static fallback")
 * recomputed per post — a Law 3 derivative, never a second live canvas. Pure
 * geometry in here; color belongs to the renderers (the page component maps
 * roles onto --fr-* tokens, the OG route onto hex literals, because Satori
 * cannot read CSS variables).
 *
 * The dateline category picks the composition archetype (trail count, curl
 * energy, tick density) so GUIDE posts rhyme with each other and COMPLIANCE
 * posts read calmer; the slug hash picks everything else. Same slug in, same
 * art out, forever — no Date, no Math.random.
 *
 * Palette discipline lives in the SPEC SHAPE, not the renderer: trails and
 * ticks are cobalt-role only; `waiting` (the one Flare mark, §3.4.1) and
 * `docked` (Answered Green whitelist) exist ONLY on banner/og plates, one
 * each, mirroring the sanctioned ConvergedField mark. Card plates are pure
 * cobalt/ink geometry so an index of twelve never multiplies the accent
 * marks.
 */

export type BlogArtVariant = "card" | "banner" | "og";

export interface BlogArtTrail {
  /** SVG path data (M/L polyline, 1-decimal precision). */
  d: string;
  /** Prominence: one near-solid lead per plate; mids and fars recede. */
  role: "lead" | "mid" | "far";
}

export interface BlogArtSpec {
  width: number;
  height: number;
  /** Sparse 1px field ticks (P5-SPEC texture), cobalt at low alpha. */
  ticks: Array<{ x: number; y: number }>;
  trails: BlogArtTrail[];
  /** Convergence point: the inbox. Renderers draw the dock rings here. */
  dock: { x: number; y: number };
  /** The one text still waiting (Flare, §3.4.1). banner/og only. */
  waiting?: { x: number; y: number };
  /** The answered text, docked (green whitelist). banner/og only. */
  docked?: { x: number; y: number };
}

/* ----------------------------------------------------------------------- */
/* Determinism primitives                                                    */
/* ----------------------------------------------------------------------- */

/** FNV-1a 32-bit string hash: the slug's stable identity. */
function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** mulberry32 PRNG: tiny, seedable, plenty for art. Returns [0, 1). */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Seeded lattice hash for value noise: cell (ix, iy) -> [0, 1). */
function latticeHash(ix: number, iy: number, seed: number): number {
  let h = seed ^ Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/** 2D value noise in [0, 1): bilinear lattice interpolation, smoothstepped. */
function valueNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = smoothstep(x - ix);
  const fy = smoothstep(y - iy);
  const a = latticeHash(ix, iy, seed);
  const b = latticeHash(ix + 1, iy, seed);
  const c = latticeHash(ix, iy + 1, seed);
  const d = latticeHash(ix + 1, iy + 1, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/* ----------------------------------------------------------------------- */
/* Composition archetypes (keyed by dateline category)                       */
/* ----------------------------------------------------------------------- */

interface Archetype {
  trails: number;
  /** Max curl deflection in radians: the braid energy. */
  curl: number;
  /** Noise frequency: lower = long slow bends, higher = tighter weave. */
  frequency: number;
  /** Probability a 48px grid point carries a field tick. */
  tickDensity: number;
}

/**
 * Category families: every GUIDE plate shares an energy even though each
 * slug braids differently. Unknown datelines get DEFAULT so a future
 * category never crashes art.
 */
const ARCHETYPES: Record<string, Archetype> = {
  GUIDE: { trails: 9, curl: 0.85, frequency: 1.15, tickDensity: 0.3 },
  PRICING: { trails: 7, curl: 0.5, frequency: 0.9, tickDensity: 0.55 },
  PLAYBOOK: { trails: 11, curl: 1.05, frequency: 1.35, tickDensity: 0.25 },
  TEMPLATES: { trails: 8, curl: 0.4, frequency: 0.8, tickDensity: 0.4 },
  NUMBERS: { trails: 7, curl: 0.65, frequency: 1.0, tickDensity: 0.5 },
  COMPLIANCE: { trails: 6, curl: 0.35, frequency: 0.7, tickDensity: 0.35 },
};

const DEFAULT_ARCHETYPE: Archetype = {
  trails: 8,
  curl: 0.7,
  frequency: 1.0,
  tickDensity: 0.35,
};

const VARIANT_SIZE: Record<BlogArtVariant, { width: number; height: number }> =
  {
    card: { width: 600, height: 280 },
    banner: { width: 1280, height: 400 },
    og: { width: 1200, height: 630 },
  };

/** P5-SPEC field-tick grid pitch. */
const TICK_GRID = 48;

/* ----------------------------------------------------------------------- */
/* The generator                                                             */
/* ----------------------------------------------------------------------- */

/**
 * Build the plate spec for a post. Deterministic: (slug, dateline, variant)
 * fully decide the output.
 */
export function blogArt(
  slug: string,
  dateline: string,
  variant: BlogArtVariant,
): BlogArtSpec {
  const { width, height } = VARIANT_SIZE[variant];
  const archetype = ARCHETYPES[dateline] ?? DEFAULT_ARCHETYPE;
  const seed = fnv1a(`${slug}::${variant}`);
  const rand = mulberry32(seed);
  const noiseSeed = fnv1a(slug);

  // The dock (inbox) sits in the right third. The OG plate pushes it to the
  // upper right so the title zone (left + bottom) stays clear of the braid.
  const dock =
    variant === "og"
      ? {
          x: width * (0.78 + rand() * 0.08),
          y: height * (0.24 + rand() * 0.14),
        }
      : {
          x: width * (0.72 + rand() * 0.12),
          y: height * (0.38 + rand() * 0.26),
        };

  // Streamlines: seeded starts spread down the left edge, integrated through
  // a curl-deflected pull field toward the dock. Curl fades as a trail closes
  // in, so the braid converges the way the hero field settles.
  const trails: BlogArtTrail[] = [];
  const count = archetype.trails;
  // OG plates keep trails out of the lower-left text zone by starting them in
  // the upper band only.
  const spreadTop = variant === "og" ? -0.1 : -0.15;
  const spreadBottom = variant === "og" ? 0.62 : 1.15;
  const leadIndex = Math.floor(rand() * count);
  let leadPoints: Array<{ x: number; y: number }> = [];
  const midA = (leadIndex + 1 + Math.floor(rand() * (count - 1))) % count;
  const midB = (leadIndex + 1 + Math.floor(rand() * (count - 1))) % count;

  for (let i = 0; i < count; i += 1) {
    const band = spreadTop + ((spreadBottom - spreadTop) * i) / (count - 1);
    const start = {
      x: -width * 0.04 - rand() * width * 0.03,
      y: height * band + (rand() - 0.5) * height * 0.12,
    };
    const settleRadius = 10 + i * 3 + rand() * 6;
    const step = width / 96;
    const maxSteps = 220;
    const phase = rand() * 8;

    const points: Array<{ x: number; y: number }> = [{ ...start }];
    let { x, y } = start;
    for (let s = 0; s < maxSteps; s += 1) {
      const dx = dock.x - x;
      const dy = dock.y - y;
      const distance = Math.hypot(dx, dy);
      if (distance <= settleRadius) break;
      const pull = Math.atan2(dy, dx);
      // Curl damps quadratically near the dock: arrivals are calm.
      const damp = Math.min(1, distance / (width * 0.45));
      const swirl =
        (valueNoise(
          (x / width) * 4 * archetype.frequency + phase,
          (y / height) * 4 * archetype.frequency - phase,
          noiseSeed,
        ) -
          0.5) *
        2 *
        archetype.curl *
        damp *
        damp;
      const angle = pull + swirl;
      x += Math.cos(angle) * step;
      y += Math.sin(angle) * step;
      points.push({ x, y });
    }

    const role: BlogArtTrail["role"] =
      i === leadIndex ? "lead" : i === midA || i === midB ? "mid" : "far";
    if (role === "lead") leadPoints = points;
    trails.push({ d: toPath(points), role });
  }

  // Sparse field ticks on the 48px grid, biased away from the dock so the
  // convergence stays the quiet focus.
  const ticks: Array<{ x: number; y: number }> = [];
  for (let gx = TICK_GRID; gx < width; gx += TICK_GRID) {
    for (let gy = TICK_GRID; gy < height; gy += TICK_GRID) {
      const nearDock = Math.hypot(dock.x - gx, dock.y - gy) < width * 0.14;
      // OG: keep the title zone texture-free too.
      const inOgTextZone =
        variant === "og" && gx < width * 0.62 && gy > height * 0.42;
      if (nearDock || inOgTextZone) continue;
      if (rand() < archetype.tickDensity) ticks.push({ x: gx, y: gy });
    }
  }

  const spec: BlogArtSpec = { width, height, ticks, trails, dock };

  // Banner/og carry the sanctioned mark pair, once each: the one waiting
  // (Flare at ~60% along the lead trail, §3.4.1) and the one answered
  // (green, docked). Cards stay pure cobalt so a twelve-card index never
  // stacks accent marks.
  if (variant !== "card" && leadPoints.length > 2) {
    const at = leadPoints[Math.floor(leadPoints.length * 0.6)];
    spec.waiting = { x: round1(at.x), y: round1(at.y) };
    spec.docked = { x: round1(dock.x), y: round1(dock.y) };
  }

  return spec;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Points -> "M x y L x y ..." with 1-decimal precision (compact, stable). */
function toPath(points: Array<{ x: number; y: number }>): string {
  return points
    .map(
      (p, i) => `${i === 0 ? "M" : "L"}${round1(p.x)} ${round1(p.y)}`,
    )
    .join(" ");
}
