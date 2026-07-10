"use client";

/**
 * THE ARRIVAL FIELD — "CONFLUENCE" (P5-SPEC v2, home hero only, Law 3).
 *
 * Divergence-free curl-noise streamlines braid across the hero and settle
 * into the real inbox card, warming cobalt -> green ONLY where a signal
 * resolves. Each streamline is a text finding its way to one inbox; the piece
 * reads as calm gallery-quality generative art first, product metaphor second
 * (amendment 14). There is no fabricated liveness and no text on the canvas:
 * the Bricolage H1 stays the sole text node in the art path, so it remains the
 * LCP candidate and CLS stays 0.00.
 *
 * Loaded only via next/dynamic({ ssr: false }) AFTER the boot gates pass
 * (arrival-layer.tsx), so this file plus p5 are a lazy chunk that never sits
 * in the critical request chain. Palette is the exact v4 tokens: Signal Cobalt
 * #2740DE (in motion) warming to Answered Green #0B7A50 only at the resolve.
 * No Flare: this piece is about resolution, not the waiting/tension beat.
 *
 * Delta-time integration throughout (framerate-independent), deltaTime clamped
 * to 40ms, per-particle sampled comet trails redrawn each frame, visibility +
 * IntersectionObserver pause, full p5.remove() teardown.
 */

import { useEffect, useRef } from "react";

import type p5 from "p5";

import { ARRIVAL_DOCK_ATTR } from "./arrival-script";

/* v4 tokens, exact. Cobalt in the open field warming to Green at the
 * confluence is the ENTIRE palette of this sketch (Flare dropped). */
const COBALT: readonly [number, number, number] = [39, 64, 222]; // #2740DE
const GREEN: readonly [number, number, number] = [11, 122, 80]; // #0B7A50

/* Field / motion constants (P5-SPEC "ALGORITHM" + "MOTION TUNING"). */
const SCALE = 0.0016; // spatial frequency of the noise potential
const EPS = 1.0; // finite-difference step, px
const FIELD_SPEED = 0.06; // t += dt * FIELD_SPEED (slow breathing)
const R_OUTER = 260; // convergence band starts
const R_INNER = 26; // dock radius (docked -> respawn)
const TANGENTIAL = 0.5; // soft rosette settle, not a radial crash

interface Particle {
  x: number;
  y: number;
  /** Depth in [0.35, 1], biased far. Drives weight, alpha, cruise speed. */
  z: number;
  /** Warmth latch in [0, 1]: 0 cobalt open field, 1 resolved green. */
  hue: number;
  /** Age in seconds. */
  life: number;
  /** Life cap in seconds — must exceed the edge-to-dock transit. */
  maxLife: number;
  /** Transient entry-speed multiplier for "just arrived" tributaries. */
  boost: number;
  /** Sampled trail positions (oldest first), redrawn each frame as a fading
   * comet tail. Explicit history instead of a p5.Graphics accumulation
   * buffer: p5 2.x does not persist Graphics content across frames the way
   * 1.x did, which left the field as sub-perceptual dashes (#84). */
  tx: number[];
  ty: number[];
}

/** A rare earned resolve: a green settle dot + one expanding ring (G2). */
interface Settle {
  x: number;
  y: number;
  /** Seconds since the resolve fired (lives 300ms). */
  age: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** smoothstep that also handles reversed edges (a may be > b). */
function smoothstep(a: number, b: number, x: number): number {
  const t = clamp((x - a) / (b - a || 1e-6), 0, 1);
  return t * t * (3 - 2 * t);
}

export default function ArrivalField({
  onFirstFrame,
}: {
  /** Fired after the first p5 frame renders (the static SVG crossfades out). */
  onFirstFrame: () => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const firstFrameRef = useRef(onFirstFrame);
  firstFrameRef.current = onFirstFrame;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let instance: p5 | null = null;
    let io: IntersectionObserver | null = null;
    let onVisibility: (() => void) | null = null;
    let cancelled = false;

    import("p5").then((mod) => {
      if (cancelled || !hostRef.current) return;
      const P5 = mod.default;

      const sketch = (p: p5) => {
        const isMobile = window.innerWidth < 640;
        // The field is now full-bleed across the whole hero (amendment 14), so
        // the desktop count is raised to keep the river dense over the wider
        // canvas. Curl noise is 4 cheap noise() lookups/particle; still 60fps.
        const COUNT = isMobile ? 64 : 180;
        const FPS = isMobile ? 30 : 60;
        /** Trail samples kept per particle (one taken every 4th frame). */
        const TRAIL_N = isMobile ? 14 : 20;

        let particles: Particle[] = [];
        let settles: Settle[] = [];
        let t = 0; // field time
        let settleCooldown = 4 + Math.random() * 4; // first resolve is soon-ish
        let firedFirstFrame = false;
        let dockX = 0;
        let dockY = 0;
        let remeasureAt = 0.5; // re-measure the dock ~500ms after boot

        const measureDock = () => {
          const dockEl = document.querySelector(`[${ARRIVAL_DOCK_ATTR}]`);
          const cr = host.getBoundingClientRect();
          if (dockEl && cr.width > 0) {
            const dr = dockEl.getBoundingClientRect();
            if (isMobile) {
              // Stacked hero: the inbox card sits at the BOTTOM under other
              // white surfaces. Dock at the card's top-center so the
              // confluence gathers in the open band ABOVE it — steering into
              // the left-middle drains every stream behind the card, hidden.
              dockX = clamp(dr.left - cr.left + dr.width / 2, 24, cr.width - 12);
              dockY = clamp(dr.top - cr.top - 12, 24, cr.height - 10);
            } else {
              dockX = clamp(dr.left - cr.left + 10, 24, cr.width - 12);
              dockY = clamp(dr.top - cr.top + dr.height / 2, 24, cr.height - 10);
            }
          } else {
            dockX = p.width - 24;
            dockY = p.height * 0.5;
          }
        };

        /** (Re)seed a particle in place so the count stays constant. */
        const reseed = (q: Particle, initial: boolean) => {
          const fresh = Math.random() < 0.2; // G4 "just arrived" tributary
          const topEdge = Math.random() < 0.28; // 72% left / 28% top
          q.hue = 0;
          q.life = 0;
          // Life must EXCEED the edge-to-dock transit (~16s at cruise across a
          // 1440px hero), or steady state degenerates: respawned particles die
          // a third of the way in and the braid thins to left-edge dashes a
          // few seconds after boot (only the initial mid-field seeds ever
          // reached the confluence).
          q.maxLife = 18 + Math.random() * 10;
          q.boost = 1;

          if (initial) {
            // Populate the whole field on boot so the crossfade from the
            // static still has no empty-then-fill pop.
            q.x = Math.random() * p.width;
            q.y = Math.random() * p.height;
            q.z = 0.35 + 0.65 * Math.pow(Math.random(), 1.5);
            q.life = Math.random() * q.maxLife;
          } else if (fresh) {
            q.x = -20;
            q.y = p.height * (0.1 + 0.7 * Math.random());
            q.z = 0.72 + 0.28 * Math.random(); // pushed toward the near plane
            q.boost = 1.3;
          } else if (topEdge) {
            q.x = p.width * (0.04 + 0.5 * Math.random());
            q.y = -20;
            q.z = 0.35 + 0.65 * Math.pow(Math.random(), 1.5);
          } else {
            q.x = -20 + Math.random() * (p.width * 0.06);
            q.y = p.height * (0.04 + 0.72 * Math.random());
            q.z = 0.35 + 0.65 * Math.pow(Math.random(), 1.5);
          }
          q.tx.length = 0;
          q.ty.length = 0;
        };

        const buildParticles = () => {
          particles = [];
          for (let i = 0; i < COUNT; i += 1) {
            const q: Particle = {
              x: 0,
              y: 0,
              z: 0.6,
              hue: 0,
              life: 0,
              maxLife: 10,
              boost: 1,
              tx: [],
              ty: [],
            };
            reseed(q, true);
            particles.push(q);
          }
        };

        p.setup = () => {
          p.createCanvas(host.clientWidth, host.clientHeight);
          p.pixelDensity(isMobile ? 1 : Math.min(p.pixelDensity(), 1.5));
          p.frameRate(FPS);
          p.noiseDetail(2, 0.5);
          measureDock();
          buildParticles();
        };

        p.windowResized = () => {
          if (host.clientWidth < 1 || host.clientHeight < 1) return;
          p.resizeCanvas(host.clientWidth, host.clientHeight);
          measureDock();
        };

        p.draw = () => {
          const dt = Math.min(p.deltaTime, 40) / 1000; // seconds, clamped
          t += dt * FIELD_SPEED;

          if (remeasureAt > 0) {
            remeasureAt -= dt;
            if (remeasureAt <= 0) measureDock();
          }

          settleCooldown -= dt;

          for (const q of particles) {
            q.life += dt;
            q.boost = 1 + (q.boost - 1) * Math.max(0, 1 - dt * 2.5);

            // --- divergence-free curl of the scalar noise potential psi ---
            const n = (ax: number, ay: number) =>
              p.noise(ax * SCALE, ay * SCALE, t);
            const dpdy = (n(q.x, q.y + EPS) - n(q.x, q.y - EPS)) / (2 * EPS);
            const dpdx = (n(q.x + EPS, q.y) - n(q.x - EPS, q.y)) / (2 * EPS);
            let hx = dpdy;
            let hy = -dpdx;
            const hm = Math.hypot(hx, hy) || 1e-6;
            hx /= hm;
            hy /= hm;

            // --- convergence toward the dock node ---
            const ddx = dockX - q.x;
            const ddy = dockY - q.y;
            const d = Math.hypot(ddx, ddy) || 1e-6;
            const w = smoothstep(R_OUTER, R_INNER, d); // 0 open field -> 1 node
            const ndx = ddx / d;
            const ndy = ddy / d;
            // Perp of the node direction gives a soft rosette settle.
            const tx = -ndy * (TANGENTIAL * w);
            const ty = ndx * (TANGENTIAL * w);

            // A gentle omnipresent dockward drift under the noise (18%) keeps
            // the whole field flowing toward the inbox card, so streams keep
            // ARRIVING at the confluence at steady state instead of only when
            // a wander happens to cross the 260px band; full arrive-steer
            // still takes over inside the band.
            const pull = Math.max(w, 0.18);
            let dirX = hx * (1 - pull) + ndx * pull + tx;
            let dirY = hy * (1 - pull) + ndy * pull + ty;
            const dm = Math.hypot(dirX, dirY) || 1e-6;
            dirX /= dm;
            dirY /= dm;

            // Arrive law: cruise in the open field, ease to rest at the dock.
            // Cruise must cover the canvas within one lifetime: at the old
            // 24-40px/s a particle died ~300px in from the edge of a 1440px
            // field, so the river never formed and nothing ever reached the
            // confluence. ~75-105px/s crosses it with life to spare and reads
            // as calm, visible drift (P5-SPEC v1 tuned arrive at 120px/s).
            const maxSpeed = 105 * (0.7 + 0.3 * q.z);
            let speed = maxSpeed * (0.55 + 0.45 * (1 - w)) * q.boost;
            if (d < R_INNER) speed *= d / R_INNER;

            q.x += dirX * speed * dt;
            q.y += dirY * speed * dt;

            // Once warmed near the node it stays warm through the resolve.
            q.hue = Math.max(q.hue, w);

            // Sample the trail every 4th frame (~15 samples/s → the tail
            // spans ~1.3s of motion, a 100-140px silk comet at cruise).
            if (p.frameCount % 4 === 0) {
              q.tx.push(q.x);
              q.ty.push(q.y);
              if (q.tx.length > TRAIL_N) {
                q.tx.shift();
                q.ty.shift();
              }
            }

            // Respawn: docked, aged out, or drifted off-canvas.
            const off =
              q.x < -40 ||
              q.x > p.width + 40 ||
              q.y < -40 ||
              q.y > p.height + 40;
            if (d < R_INNER || q.life > q.maxLife || off) {
              // A docked stream is the ONLY thing that can earn a resolve, and
              // only when the sparse timer is due (green stays a rare event).
              if (d < R_INNER && settleCooldown <= 0) {
                settles.push({ x: dockX, y: dockY, age: 0 });
                settleCooldown = 6 + Math.random() * 5;
              }
              reseed(q, false);
            }
          }

          // Redraw every comet tail from its sampled history (deterministic —
          // no reliance on Graphics persistence), then the rare resolves.
          p.clear();
          p.noFill();
          for (const q of particles) {
            const n = q.tx.length;
            if (n === 0) continue;
            const cr = COBALT[0] + (GREEN[0] - COBALT[0]) * q.hue;
            const cg = COBALT[1] + (GREEN[1] - COBALT[1]) * q.hue;
            const cb = COBALT[2] + (GREEN[2] - COBALT[2]) * q.hue;
            const headAlpha = 64 + 30 * q.z + 60 * q.hue;
            const headWeight = (1.1 + 1.7 * q.z) * (1 + 0.4 * q.hue);
            for (let i = 0; i < n; i += 1) {
              const x2 = i === n - 1 ? q.x : q.tx[i + 1];
              const y2 = i === n - 1 ? q.y : q.ty[i + 1];
              // Ease alpha/weight from tail to head so the stream tapers off
              // instead of cutting.
              const f = (i + 1) / n;
              p.stroke(cr, cg, cb, headAlpha * f * f);
              p.strokeWeight(headWeight * (0.45 + 0.55 * f));
              p.line(q.tx[i], q.ty[i], x2, y2);
            }
          }

          if (settles.length > 0) {
            for (const s of settles) s.age += dt;
            settles = settles.filter((s) => s.age < 0.3);
            for (const s of settles) {
              const st = clamp(s.age / 0.3, 0, 1);
              p.noFill();
              p.stroke(GREEN[0], GREEN[1], GREEN[2], 127 * (1 - st));
              p.strokeWeight(1.25);
              p.circle(s.x, s.y, 8 + 20 * st); // Ø 8 -> 28
              p.noStroke();
              p.fill(GREEN[0], GREEN[1], GREEN[2], 34 * (1 - st * 0.5));
              p.circle(s.x, s.y, 2.2);
            }
          }

          if (!firedFirstFrame) {
            firedFirstFrame = true;
            firstFrameRef.current();
          }
        };
      };

      instance = new P5(sketch, host);

      // Pause when the tab hides; resume when it returns.
      onVisibility = () => {
        if (!instance) return;
        if (document.hidden) instance.noLoop();
        else instance.loop();
      };
      document.addEventListener("visibilitychange", onVisibility);

      // Pause when the hero scrolls fully off screen.
      io = new IntersectionObserver(
        (entries) => {
          if (!instance) return;
          if (entries.some((e) => e.isIntersecting)) instance.loop();
          else instance.noLoop();
        },
        { threshold: 0 },
      );
      io.observe(host);
    });

    return () => {
      cancelled = true;
      io?.disconnect();
      if (onVisibility) {
        document.removeEventListener("visibilitychange", onVisibility);
      }
      instance?.remove();
      instance = null;
    };
  }, []);

  return (
    <div
      ref={hostRef}
      className="absolute inset-0"
      aria-hidden="true"
      style={{
        pointerEvents: "none",
        // Full-bleed canvas (amendment 14): the art is the dominant surface, so
        // the mask only feathers the four edges softly (no hard trail clip
        // lines). H1/body legibility is handled by the copy scrim in hero.tsx,
        // NOT by erasing the art across the center.
        WebkitMaskImage:
          "linear-gradient(to right, transparent 0, black 6%, black 95%, transparent 100%), linear-gradient(to bottom, transparent 0, black 7%, black 93%, transparent 100%)",
        WebkitMaskComposite: "source-in",
        maskImage:
          "linear-gradient(to right, transparent 0, black 6%, black 95%, transparent 100%), linear-gradient(to bottom, transparent 0, black 7%, black 93%, transparent 100%)",
        maskComposite: "intersect",
      }}
    />
  );
}
