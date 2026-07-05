import { Reveal } from "@/components/marketing/ui/reveal";
import { Section } from "@/components/marketing/ui/section";

/**
 * S6 — The approval clock ("Quiet daylight" v3 §6 S6). The honesty constraint
 * promoted to a trust feature: one low, wide light band ruled top and bottom
 * with hairlines (rgba(11,43,38,0.08), never amber), mostly negative space
 * (distinct silhouette from S5's tall cards).
 *
 * The day-tick status board is a hybrid: the ruler, lanes, ticks and nodes are
 * ONE inline SVG (crisp 1-1.5px strokes, rounded caps; the amber node here is
 * data — "US · pending" — never decoration), while every label is real HTML in
 * Martian Mono positioned under the SVG (SVG <text> renders mono unreliably
 * cross-platform). The SVG is aria-hidden; the HTML labels read in narrative
 * order (sign up -> Canada live -> US pending -> US approved -> the day
 * ticks), so AT hears the story without the drawing.
 *
 * Motion: one-shot only. The ruler and lanes draw once via stroke-dashoffset,
 * nodes and labels fade in — all double-gated behind the board's <Reveal>
 * flipping data-revealed (JS-set) AND prefers-reduced-motion. The
 * attribute-less server default is the finished board: pre-drawn, nodes
 * seated. Server component, zero JS.
 */

/* ---- Geometry -------------------------------------------------------------- *
 * Days 0..7 across the board: x in % of the board width (2% padding each
 * side), y in px inside the fixed-height wrapper (h-52 = 208px; an SVG with
 * no viewBox uses CSS px, so SVG y and HTML label tops share one ruler). */
const DAY_X = Array.from({ length: 8 }, (_, day) => `${(2 + (day * 96) / 7).toFixed(3)}%`);

const Y = {
  canadaLabel: 22,
  canadaLane: 48,
  usLabel: 74,
  usLane: 100,
  approvedLabel: 112,
  ruler: 152,
  tickEnd: 158,
  tickLabel: 164,
  signupLabel: 186,
} as const;

/** Inline stagger: --nxc-d feeds animation-delay in the nxc- rules. */
const at = (ms: number, more?: React.CSSProperties): React.CSSProperties =>
  ({ "--nxc-d": `${ms}ms`, ...more }) as React.CSSProperties;

/* ---- Section CSS (one inert style block, prefix "nxc-") -------------------- */
const CLOCK_CSS = `
/* Both rules below exist ONLY once the board's <Reveal> has flipped
   data-revealed (JS-set) and motion is tolerated; otherwise the server-
   rendered resolved board stands untouched. Opacity / stroke-dashoffset
   only, one shot, the house ease. */
@media (prefers-reduced-motion: no-preference) {
  [data-revealed="true"] .nxc-draw {
    /* pathLength=100 on the lines normalizes their real length, so one
       dasharray fits every segment regardless of rendered width. */
    stroke-dasharray: 100;
    animation: nxc-draw 450ms cubic-bezier(0.2, 0.8, 0.2, 1) var(--nxc-d, 0ms) both;
  }
  [data-revealed="true"] .nxc-fade {
    animation: nxc-fade 300ms ease-out var(--nxc-d, 0ms) both;
  }
  @keyframes nxc-draw {
    from {
      stroke-dashoffset: 100;
    }
    to {
      stroke-dashoffset: 0;
    }
  }
  @keyframes nxc-fade {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
}
`;

/* ---- The board -------------------------------------------------------------- */

const MONO_LABEL = "font-mono-mkt absolute text-[0.6875rem] leading-[1.2] tracking-[0.02em]";

function StatusBoard() {
  return (
    <div className="relative h-52">
      {/* The drawing: decorative, the HTML labels carry every fact. */}
      <svg aria-hidden="true" className="absolute inset-0 size-full overflow-visible">
        {/* Day-0 signup marker: a dotted plumb line from the lanes to the ruler. */}
        <line
          className="nxc-fade"
          style={at(300)}
          x1={DAY_X[0]}
          y1={40}
          x2={DAY_X[0]}
          y2={Y.ruler}
          stroke="var(--ink-55)"
          strokeWidth="1"
          strokeDasharray="1 4"
          strokeLinecap="round"
        />

        {/* Canada lane: live petrol from day 0, the whole week. */}
        <line
          className="nxc-draw"
          style={at(140)}
          pathLength={100}
          x1={DAY_X[0]}
          y1={Y.canadaLane}
          x2={DAY_X[7]}
          y2={Y.canadaLane}
          stroke="var(--petrol)"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        <circle
          className="nxc-fade"
          style={at(300)}
          cx={DAY_X[0]}
          cy={Y.canadaLane}
          r="4.5"
          fill="var(--petrol)"
        />

        {/* US lane: amber pending to day 3, a dashed possibility window to the
            flip (carriers approve between days 3 and 7), then petrol. */}
        <line
          className="nxc-draw"
          style={at(220)}
          pathLength={100}
          x1={DAY_X[0]}
          y1={Y.usLane}
          x2={DAY_X[3]}
          y2={Y.usLane}
          stroke="var(--porch-amber)"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        {/* Dashed segments cannot dashoffset-draw (the dash pattern IS the
            dasharray), so the window fades in instead — opacity only. */}
        <line
          className="nxc-fade"
          style={at(420)}
          x1={DAY_X[3]}
          y1={Y.usLane}
          x2={DAY_X[5]}
          y2={Y.usLane}
          stroke="var(--porch-amber)"
          strokeWidth="1.5"
          strokeDasharray="3 6"
          strokeLinecap="round"
        />
        <line
          className="nxc-draw"
          style={at(480)}
          pathLength={100}
          x1={DAY_X[5]}
          y1={Y.usLane}
          x2={DAY_X[7]}
          y2={Y.usLane}
          stroke="var(--petrol)"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        <circle
          className="nxc-fade"
          style={at(380)}
          cx={DAY_X[0]}
          cy={Y.usLane}
          r="4.5"
          fill="var(--porch-amber)"
        />
        <circle
          className="nxc-fade"
          style={at(600)}
          cx={DAY_X[5]}
          cy={Y.usLane}
          r="5"
          fill="var(--petrol)"
        />

        {/* The tick ruler: draws once on reveal, pre-drawn otherwise. */}
        <line
          className="nxc-draw"
          pathLength={100}
          x1={DAY_X[0]}
          y1={Y.ruler}
          x2={DAY_X[7]}
          y2={Y.ruler}
          stroke="var(--ink-55)"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        <g
          className="nxc-fade"
          style={at(240)}
          stroke="var(--ink-55)"
          strokeWidth="1.5"
          strokeLinecap="round"
        >
          {DAY_X.map((x) => (
            <line key={x} x1={x} y1={Y.ruler} x2={x} y2={Y.tickEnd} />
          ))}
        </g>
      </svg>

      {/* Labels, in narrative order for AT. Node labels sit 12px right of the
          day-0 plumb line so text never collides with the drawing. Petrol
          carries the live/approved states; pending stays day-ink (amber never
          carries text). */}
      <span
        className={`${MONO_LABEL} nxc-fade font-medium text-[color:var(--day-ink)]`}
        style={at(300, { left: DAY_X[0], top: Y.signupLabel })}
      >
        You sign up
      </span>
      <span
        className={`${MONO_LABEL} nxc-fade font-medium text-[color:var(--petrol)]`}
        style={at(340, { left: `calc(${DAY_X[0]} + 12px)`, top: Y.canadaLabel })}
      >
        Canada · live
      </span>
      <span
        className={`${MONO_LABEL} nxc-fade font-medium text-[color:var(--day-ink)]`}
        style={at(420, { left: `calc(${DAY_X[0]} + 12px)`, top: Y.usLabel })}
      >
        US · pending carrier approval
      </span>
      {/* The flip label centers under its day-5 node; nxc-fade is opacity-only,
          so it composes with the centering translate. */}
      <span
        className={`${MONO_LABEL} nxc-fade -translate-x-1/2 font-medium whitespace-nowrap text-[color:var(--petrol)]`}
        style={at(640, { left: DAY_X[5], top: Y.approvedLabel })}
      >
        US · approved
      </span>
      <div
        className="nxc-fade font-mono-mkt absolute inset-0 text-[0.6875rem] leading-[1.2] tracking-[0.02em] text-[color:var(--ink-55)]"
        style={at(240)}
      >
        <span className="absolute" style={{ left: DAY_X[0], top: Y.tickLabel }}>
          Day 0
        </span>
        {[1, 2, 3, 4, 5, 6, 7].map((day) => (
          <span
            key={day}
            className="absolute -translate-x-1/2"
            style={{ left: DAY_X[day], top: Y.tickLabel }}
          >
            {day}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ---- The section ------------------------------------------------------------ */

export function ApprovalClock() {
  return (
    /* A low band (py trimmed under the house rhythm), ruled top and bottom
       with hairlines — v3 §6 S6: rgba(11,43,38,0.08), NOT amber. */
    <Section
      id="approval"
      defer
      intrinsic={560}
      className="border-y border-[rgba(11,43,38,0.08)] bg-[color:var(--first-light)] py-12 text-[color:var(--day-ink)] sm:py-16"
    >
      <style dangerouslySetInnerHTML={{ __html: CLOCK_CSS }} />

      <div className="grid items-center gap-x-12 gap-y-10 lg:grid-cols-12">
        <Reveal className="lg:col-span-5">
          <h3 className="display-h3 text-balance">
            Canada texts right away. US texting turns on in about a week.
          </h3>
          {/* Canonical carrier-approval line, verbatim, at full body size and
              full ink: honesty stated as competence, never a footnote (this
              copy may never be shrunk below neighboring text). */}
          <p className="mt-4 text-base leading-relaxed text-[color:var(--ink-70)]">
            US texting takes carriers about a week to approve your number. We
            tell you now because you would find out either way. We start the
            clock the minute you sign up and show you the day.
          </p>
        </Reveal>

        {/* The board's <Reveal> is the trigger root for every nxc- rule. */}
        <Reveal className="lg:col-span-7">
          <p className="font-mono-mkt text-[0.8125rem] font-medium tracking-[0.02em]">
            Your approval clock
          </p>
          <div className="mt-5">
            <StatusBoard />
          </div>
          <p className="mt-4 text-sm leading-[1.5] text-[color:var(--ink-55)]">
            You can watch the status while you wait.
          </p>
        </Reveal>
      </div>
    </Section>
  );
}
