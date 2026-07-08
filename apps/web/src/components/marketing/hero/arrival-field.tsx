"use client";

/**
 * THE ARRIVAL FIELD (P5-SPEC v1): the site's single live algorithm, home hero
 * only (Law 3). Each particle IS a customer text: it spawns off-canvas at a
 * "personal phone" moment, wanders under noise (unanswered, Flare), resolves
 * into an arrive-steered path (in motion, Cobalt trail), and docks into the
 * REAL inbox card, which prepends the matching conversation row.
 *
 * Loaded only via next/dynamic({ ssr: false }) AFTER the boot gates pass
 * (arrival-layer.tsx), so this file plus p5 are a lazy chunk that never sits
 * in the critical request chain. Colors are the exact v4 tokens: Flare
 * #FF4A1F (waiting), Cobalt #2740DE (in motion), Green #0B7A50 (answered).
 *
 * Delta-time integration throughout (v += a * dt, dt in seconds), 30fps,
 * offscreen accumulation buffer for the cobalt trails, visibility +
 * IntersectionObserver pause, full p5.remove() teardown on unmount.
 */

import { useEffect, useRef } from "react";

import type p5 from "p5";

import {
  ARRIVAL_DOCK_ATTR,
  ARRIVAL_SCRIPT,
  HERO_ARRIVAL_EVENT,
} from "./arrival-script";

/* The v4 tokens, exact (P5-SPEC "Colors are exactly the v4 tokens"). Cobalt
 * (#2740DE) is applied straight to the trail/grid buffer strokes below as its
 * RGB channels (39, 64, 222), so it needs no shared constant here. */
const FLARE = { r: 255, g: 74, b: 31 }; // #FF4A1F
const GREEN = { r: 11, g: 122, b: 80 }; // #0B7A50
const INK = { r: 16, g: 23, b: 59 }; // #10173B (timestamp labels at 60%)

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Age in seconds. */
  age: number;
  /** Wander duration in seconds for this particle. */
  wander: number;
  scriptIndex: number;
  state: "live" | "docking" | "pulse";
  /** Seconds since docking started. */
  dockT: number;
  dockFromX: number;
  dockFromY: number;
  /** Spawn x (for the steering-blend progress measure). */
  x0: number;
  /** Trail segments already drawn (per-particle cap keeps totals ≤ 60). */
  segments: number;
  px: number;
  py: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function smoothstep(a: number, b: number, x: number): number {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

function cubicOut(t: number): number {
  const f = t - 1;
  return f * f * f + 1;
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
        const mobile = () => host.clientWidth > 0 && window.innerWidth < 640;

        let buffer: p5.Graphics;
        let particles: Particle[] = [];
        let noiseT = 0;
        let nextSpawnIn = 0.4; // first text lands quickly
        let scriptCursor = 0;
        let fadeAccum = 0;
        let firedFirstFrame = false;
        let dockX = 0;
        let dockY = 0;
        let monoFamily = "ui-monospace, monospace";

        const params = () =>
          mobile()
            ? {
                maxLive: 3,
                spawnMin: 3.5,
                spawnMax: 5.0,
                bubbleW: 16,
                bubbleH: 10,
                wanderMin: 1.6,
                wanderMax: 2.2,
                arriveRadius: 90,
                labels: false,
                trails: false,
              }
            : {
                maxLive: 5,
                spawnMin: 2.5,
                spawnMax: 4.0,
                bubbleW: 22,
                bubbleH: 14,
                wanderMin: 2.2,
                wanderMax: 3.2,
                arriveRadius: 140,
                labels: true,
                trails: true,
              };

        const MAX_SPEED = 120; // px/s
        const MAX_FORCE = 220; // px/s²

        const measureDock = () => {
          const dockEl = document.querySelector(`[${ARRIVAL_DOCK_ATTR}]`);
          const cr = host.getBoundingClientRect();
          if (dockEl) {
            const dr = dockEl.getBoundingClientRect();
            // Steer to the card's near (left) edge, vertically centered;
            // when the card sits below the band (mobile), this clamps to the
            // band's bottom center, the approach line toward the card.
            dockX = clamp(dr.left - cr.left + 10, 24, cr.width - 12);
            dockY = clamp(dr.top - cr.top + dr.height / 2, 24, cr.height - 10);
          } else {
            dockX = cr.width - 24;
            dockY = cr.height * 0.5;
          }
        };

        const paintGrid = () => {
          // Sparse field texture: 1px cobalt ticks at 6% alpha, 48px grid,
          // drawn once to the buffer (desktop only).
          if (!params().trails) return;
          buffer.stroke(39, 64, 222, 15); // ~6% alpha
          buffer.strokeWeight(1);
          for (let gx = 24; gx < p.width; gx += 48) {
            for (let gy = 24; gy < p.height; gy += 48) {
              buffer.line(gx - 1.5, gy, gx + 1.5, gy);
            }
          }
        };

        const rebuildBuffer = () => {
          buffer?.remove();
          buffer = p.createGraphics(p.width, p.height);
          paintGrid();
        };

        const spawn = () => {
          const prm = params();
          const idx = scriptCursor % ARRIVAL_SCRIPT.length;
          scriptCursor += 1;
          const x0 = -30;
          const y0 = p.height * (0.08 + 0.55 * Math.random());
          particles.push({
            x: x0,
            y: y0,
            vx: 30 + Math.random() * 30,
            vy: 10 * (Math.random() - 0.5),
            age: 0,
            wander:
              prm.wanderMin + Math.random() * (prm.wanderMax - prm.wanderMin),
            scriptIndex: idx,
            state: "live",
            dockT: 0,
            dockFromX: x0,
            dockFromY: y0,
            x0,
            segments: 0,
            px: x0,
            py: y0,
          });
        };

        p.setup = () => {
          p.createCanvas(host.clientWidth, host.clientHeight);
          p.pixelDensity(mobile() ? 1 : Math.min(p.pixelDensity(), 1.5));
          p.frameRate(30);
          p.noStroke();
          rebuildBuffer();
          measureDock();
          const fam = getComputedStyle(host)
            .getPropertyValue("--font-mono")
            .trim();
          if (fam) monoFamily = `${fam}, ui-monospace, monospace`;
        };

        p.windowResized = () => {
          if (host.clientWidth < 1 || host.clientHeight < 1) return;
          p.resizeCanvas(host.clientWidth, host.clientHeight);
          rebuildBuffer();
          measureDock();
        };

        p.draw = () => {
          const prm = params();
          const dt = Math.min(p.deltaTime, 100) / 1000; // seconds, clamped
          noiseT += 0.0015;
          p.clear();

          // Trails buffer: fade ~2% per second so resolved paths build up,
          // then slowly breathe.
          if (prm.trails) {
            fadeAccum += dt;
            if (fadeAccum >= 0.5) {
              fadeAccum = 0;
              buffer.noStroke();
              buffer.erase(3, 0);
              buffer.rect(0, 0, buffer.width, buffer.height);
              buffer.noErase();
            }
            p.image(buffer, 0, 0, p.width, p.height);
          }

          // Spawn (staggered).
          nextSpawnIn -= dt;
          const live = particles.filter((q) => q.state === "live").length;
          if (nextSpawnIn <= 0 && live < prm.maxLive) {
            spawn();
            nextSpawnIn =
              prm.spawnMin + Math.random() * (prm.spawnMax - prm.spawnMin);
          }

          const done: Particle[] = [];
          for (const q of particles) {
            if (q.state === "live") {
              q.age += dt;

              // Noise wander force.
              const heading =
                p.noise(q.x * 0.004, q.y * 0.004, noiseT) * p.TWO_PI * 2;
              const nfx = Math.cos(heading) * MAX_FORCE;
              const nfy = Math.sin(heading) * MAX_FORCE;

              // Reynolds arrive force toward the dock.
              const dx = dockX - q.x;
              const dy = dockY - q.y;
              const d = Math.hypot(dx, dy) || 0.0001;
              const speed =
                d < prm.arriveRadius ? (MAX_SPEED * d) / prm.arriveRadius : MAX_SPEED;
              let afx = (dx / d) * speed - q.vx;
              let afy = (dy / d) * speed - q.vy;
              const am = Math.hypot(afx, afy) || 0.0001;
              if (am > MAX_FORCE) {
                afx = (afx / am) * MAX_FORCE;
                afy = (afy / am) * MAX_FORCE;
              }

              // Steering blend: x-progress toward the dock, plus a ramp once
              // the wander window has run out (the text stops drifting).
              const progressX = clamp((q.x - q.x0) / (dockX - q.x0 || 1), 0, 1);
              const timeRamp = clamp((q.age - q.wander) / 1.2, 0, 1);
              const blend = Math.max(
                smoothstep(0.25, 0.75, progressX),
                timeRamp,
              );

              const fx = nfx + (afx - nfx) * blend;
              const fy = nfy + (afy - nfy) * blend;
              q.vx += fx * dt;
              q.vy += fy * dt;
              const vm = Math.hypot(q.vx, q.vy) || 0.0001;
              if (vm > MAX_SPEED) {
                q.vx = (q.vx / vm) * MAX_SPEED;
                q.vy = (q.vy / vm) * MAX_SPEED;
              }
              q.px = q.x;
              q.py = q.y;
              q.x += q.vx * dt;
              q.y += q.vy * dt;
              q.y = clamp(q.y, 10, p.height - 10);

              // Cobalt trail into the accumulation buffer (≤60 segments per
              // particle life keeps the total in budget).
              if (prm.trails && q.segments < 60 && q.x > 0) {
                q.segments += 1;
                buffer.stroke(39, 64, 222, 31); // cobalt at 12% alpha
                buffer.strokeWeight(1.5);
                buffer.line(q.px, q.py, q.x, q.y);
              }

              // Stale drift: past 60% of the wander window, alpha eases to
              // 40% (a text going stale) and recovers during convergence.
              const staleT = q.age / q.wander;
              const staleAlpha =
                staleT > 0.6 ? 1 - 0.6 * clamp((staleT - 0.6) / 0.4, 0, 1) : 1;
              const alpha = staleAlpha + (1 - staleAlpha) * blend;

              // Dock trigger: the final 24px runs the docking ease.
              if (d < 24) {
                q.state = "docking";
                q.dockT = 0;
                q.dockFromX = q.x;
                q.dockFromY = q.y;
              }

              drawBubble(q, FLARE, alpha, prm, blend);
            } else if (q.state === "docking") {
              q.dockT += dt;
              const t = clamp(q.dockT / 0.32, 0, 1); // 320ms cubic-out
              const e = cubicOut(t);
              q.x = q.dockFromX + (dockX - q.dockFromX) * e;
              q.y = q.dockFromY + (dockY - q.dockFromY) * e;
              // Fill crossfade Flare → Green over 400ms.
              const c = clamp(q.dockT / 0.4, 0, 1);
              const mix = {
                r: FLARE.r + (GREEN.r - FLARE.r) * c,
                g: FLARE.g + (GREEN.g - FLARE.g) * c,
                b: FLARE.b + (GREEN.b - FLARE.b) * c,
              };
              drawBubble(q, mix, 1, prm, 1);
              if (t >= 1 && c >= 1) {
                q.state = "pulse";
                q.dockT = 0;
                // The row lands in the real inbox the moment the dock settles.
                host.dispatchEvent(
                  new CustomEvent(HERO_ARRIVAL_EVENT, {
                    detail: { scriptIndex: q.scriptIndex },
                    bubbles: true,
                  }),
                );
              }
            } else {
              // One 300ms ring pulse: green stroke expanding 8→28px, α .5→0.
              q.dockT += dt;
              const t = clamp(q.dockT / 0.3, 0, 1);
              p.noFill();
              p.stroke(GREEN.r, GREEN.g, GREEN.b, 127 * (1 - t));
              p.strokeWeight(1.5);
              p.circle(q.x, q.y, 8 + 20 * t);
              p.noStroke();
              drawBubble(q, GREEN, 1 - t, prm, 1);
              if (t >= 1) done.push(q);
            }
          }
          if (done.length > 0) {
            particles = particles.filter((q) => !done.includes(q));
          }

          if (!firedFirstFrame) {
            firedFirstFrame = true;
            firstFrameRef.current();
          }
        };

        function drawBubble(
          q: Particle,
          color: { r: number; g: number; b: number },
          alpha: number,
          prm: ReturnType<typeof params>,
          blend: number,
        ) {
          p.fill(color.r, color.g, color.b, 255 * alpha);
          p.rect(
            q.x - prm.bubbleW / 2,
            q.y - prm.bubbleH / 2,
            prm.bubbleW,
            prm.bubbleH,
            5,
          );
          if (prm.labels && q.state === "live") {
            // Timestamp label: Spline Sans Mono 11px, ink at 60%, right of
            // the bubble. Raw canvas text keeps p5's text state untouched.
            const ctx = p.drawingContext as CanvasRenderingContext2D;
            ctx.save();
            ctx.font = `500 11px ${monoFamily}`;
            ctx.fillStyle = `rgba(${INK.r}, ${INK.g}, ${INK.b}, ${0.6 * alpha * (1 - 0.4 * blend)})`;
            ctx.textBaseline = "middle";
            ctx.fillText(
              ARRIVAL_SCRIPT[q.scriptIndex].time,
              q.x + prm.bubbleW / 2 + 8,
              q.y,
            );
            ctx.restore();
          }
        }
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
      style={{ pointerEvents: "none" }}
    />
  );
}
