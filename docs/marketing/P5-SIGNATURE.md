# P5-SPEC v1 — THE ARRIVAL FIELD (implementation-ready)

## What it is
The site's single algorithmic signature, on the home hero only. Each particle IS a customer text: it spawns at an off-canvas "personal phone" moment, wanders under noise (unanswered, Flare), resolves into an arrive-steered path (in motion, Cobalt trail), and docks into the REAL inbox component, which prepends an actual conversation row (handled, app tokens). Chaos becomes a queue; the queue empties into the real product, not an abstraction of it.

## Files and loading
- `apps/web/src/components/marketing/hero/arrival-field.tsx` (client component, p5 instance mode) loaded via `next/dynamic(..., { ssr: false })`.
- `apps/web/src/components/marketing/hero/arrival-static.tsx` (server component): the static converged inline SVG. This is what SSR ships, what no-JS keeps, what reduced-motion keeps, and what the final CTA band and subpage header marks reuse at small scale.
- p5 (~80KB gz) is its own lazy chunk, requested only on `/`, only after gating passes.

## Boot gating (in order; any failure means the static SVG stays)
```
if (matchMedia('(prefers-reduced-motion: reduce)').matches) stop
if (navigator.connection?.saveData) stop
if (navigator.deviceMemory !== undefined && navigator.deviceMemory < 4) stop
onLCP(() => requestIdleCallback(() => {
  io = new IntersectionObserver(boot, { rootMargin: '200px' })  // hero container
}))
```
The hero H1 text node must remain the LCP. The canvas mounts into a pre-sized, absolutely positioned layer (`inset:0` of the hero grid's right column zone, `pointer-events:none`), so CLS from this feature is 0.00. The static SVG crossfades out (200ms) only after the first p5 frame has rendered.

## Canvas sizing
- Desktop (≥1024px): the layer spans the hero's right 5/12 plus the gutter, height 560px fixed, canvas = container box.
- Tablet (640 to 1023px): layer spans full width behind a stacked hero, height 320px band between H1 block and the inbox card.
- Mobile (<640px): a 200px band directly above the inbox card, REDUCED live field (see budgets); if any gate fails, the static SVG at the same 200px height.
- `pixelDensity(min(devicePixelRatio, 1.5))` desktop, `pixelDensity(1)` mobile. `frameRate(30)`. Delta-time integration throughout (`v += a * dt`, dt in seconds), so speed is framerate independent.

## Parameters
| Param | Desktop | Mobile |
|---|---|---|
| Max live (undocked) particles | 5 | 3 |
| Spawn interval | 2500 to 4000ms, staggered | 3500 to 5000ms |
| Particle | rounded-rect bubble 22×14px, 5px radius | 16×10px |
| Timestamp label | Spline Sans Mono 11px, `#10173B` at 60%, right of bubble | none |
| Noise field | `noise(x*0.004, y*0.004, t)`; t += 0.0015/frame; heading = noiseVal * TWO_PI * 2 | same |
| Wander duration | 2.2 to 3.2s per particle | 1.6 to 2.2s |
| Steering blend | `steer = lerp(noiseForce, arriveForce, smoothstep(0.25, 0.75, progressX))` where progressX = normalized x-distance toward the dock | same |
| Arrive | Reynolds arrive, decel radius 140px, maxSpeed 120px/s, maxForce 220px/s² | radius 90px |
| Dock | final 24px on cubic-out over 320ms; fill crossfade Flare `#FF4A1F` → Green `#0B7A50` over 400ms; one 300ms ring pulse (stroke Green, expanding 8→28px, alpha 0.5→0) | same |
| Trails | ≤60 segments total, drawn to an OFFSCREEN accumulation buffer (`createGraphics`), stroke Cobalt `#2740DE` at 12% alpha, buffer faded by 2% per second so resolved paths visibly build up, then slowly breathe | trails off |
| Field texture | sparse 1px cobalt ticks at 6% alpha on a 48px grid, drawn once to the buffer | off |

Colors are exactly the v4 tokens: Flare `#FF4A1F` (waiting), Cobalt `#2740DE` (in motion), Green `#0B7A50` (answered). Nothing else. Stale drift: after 60% of wander time, particle alpha eases to 40% (a text going stale) and recovers during convergence.

## Scripted content (factual, loops seamlessly)
Timestamps drawn in order from: `9:04 PM`, `6:48 AM`, `12:15 PM`, `5:31 PM`, `8:47 AM`. Matching inbox rows (real ConversationRow data): "Water heater leaking, error E110 · 9:04 PM", "No heat this morning, thermostat blank · 6:48 AM", "Can you add the back beds this week? · 12:15 PM", "Running 15 late, still ok? · 5:31 PM", "Is he coming today? · 8:47 AM". All fictional-but-plausible content, no invented product stats, no fake names implying customers.

## Coupling to the real DOM (the point of the piece)
On dock, the sketch dispatches `container.dispatchEvent(new CustomEvent('loonext:arrival', { detail: { scriptIndex } }))`. The hero inbox (REAL ConversationRow components rendering with the app's own tokens per Law 2: the app's unread-dot color, the app's petrol accents; marketing never recolors them) listens: prepend the matching row with its unread state, settle to read after ~4s, cap at 4 rows, fade the oldest. SSR renders the inbox in its finished state (all rows present, read) so no-JS and pre-boot visitors see a complete product, never a hole; the animation replays that state.

## Pause and teardown
- `visibilitychange` hidden → `noLoop()`; visible → `loop()`.
- IntersectionObserver: hero fully off-screen → `noLoop()`.
- Component unmount (route change) → `p5.remove()`, buffer disposed, listeners removed.

## Static fallback SVG (must be a composed still, not an absence)
Inline SVG, same geometry as the settled sketch: three cobalt streamline paths (12% alpha) converging from the upper-left toward the inbox edge; four docked bubbles queued on the approach line, green-filled with mono timestamps; ONE bubble mid-path in Flare at 60% along the middle streamline (the story in a single frame: one text still waiting). ViewBox matches the canvas box per breakpoint. Reused at 20% scale, single path, as the final-CTA backdrop and subpage header mark. There is NO second live canvas anywhere on the site: the FIRST RESPONSE concept's live final-CTA reprise is cut per the judge graft; the reprise is this static SVG.

## Acceptance tests (QA gates)
1. Lighthouse mobile on `/`: LCP element is the H1 text; CLS 0.00; p5 chunk absent from the critical request chain.
2. Reduced-motion emulation: no p5 network request; the composed SVG renders.
3. `navigator.connection.saveData = true` and `deviceMemory = 2` emulations: same as (2).
4. Tab blur: `requestAnimationFrame` activity drops to zero within 500ms.
5. Scroll past hero: loop stops.
6. 2019-class Android (or 6x CPU throttle): steady 30fps, main-thread frames < 8ms.
7. Strip test (Law 9): with the dynamic import removed, the hero is a finished composition.
8. Docked-row audit: every docked particle's row exists in the DOM as a real ConversationRow with app tokens (inspect: no `#2740DE` inside the frame).
