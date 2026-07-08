/**
 * FIRST-WEEK TIMELINE (DESIGN-DIRECTION v4 §5.5, the Numbered Steps
 * flagship): Day 0 (green node, something got handled: you are live) →
 * Days 1 to 7 (cobalt progress track, the bounded review) → Approved (green
 * node). Carries the one YOU ARE HERE tab: ink text on a white tag with a
 * Flare border (Flare whitelist §3.4.4; Flare itself carries no text below
 * 24px, the tag's text is ink).
 *
 * The honest US carrier wait as a designed object, not fine print. Copy per
 * COPY-DECK v2 §S5 (the /pricing restage keeps the same three facts).
 * Server component, pure DOM, no em-dashes anywhere.
 */

const STEPS = [
  {
    key: "day-0",
    label: "DAY 0",
    node: "green" as const,
    title: "You're live, not waiting.",
    body: "Your number is up. Receiving texts works. Texting Canadian customers works. You can invite the crew and start today.",
    here: true,
  },
  {
    key: "days-1-7",
    label: "DAYS 1 TO 7",
    node: "cobalt" as const,
    title: "The phone companies review you.",
    body: "US carriers require every business that texts to register. We filed yours the minute you paid. Approval typically takes 3 to 7 business days, about a week.",
    here: false,
  },
  {
    key: "approved",
    label: "APPROVED",
    node: "green" as const,
    title: "US texting turns on.",
    body: "We email you the moment it's live. Nothing else for you to do.",
    here: false,
  },
];

function Node({ kind }: { kind: "green" | "cobalt" }) {
  return kind === "green" ? (
    <span
      className="flex size-6 shrink-0 items-center justify-center rounded-full bg-[color:var(--fr-green)]"
      aria-hidden
    >
      <svg viewBox="0 0 16 16" className="size-3.5" focusable="false">
        <path
          d="M3.5 8.5 6.5 11.5 12.5 4.5"
          fill="none"
          stroke="#fff"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  ) : (
    <span
      className="fr-eyebrow flex h-6 shrink-0 items-center justify-center rounded-full bg-[color:var(--fr-cobalt)] px-2 text-[10px] text-white"
      aria-hidden
    >
      1-7
    </span>
  );
}

export function FirstWeekTimeline({ className }: { className?: string }) {
  return (
    <div className={className}>
      <div className="fr-card p-6 sm:p-8">
        {/* The progress track: green dock, cobalt review segment, green dock.
            Purely decorative; the ol below carries the content. */}
        <div className="flex items-center gap-2" aria-hidden>
          <span className="size-2.5 shrink-0 rounded-full bg-[color:var(--fr-green)]" />
          <span className="h-1.5 flex-1 rounded-full bg-[color:var(--fr-frost)]">
            <span className="block h-full w-1/6 rounded-full bg-[color:var(--fr-cobalt)]" />
          </span>
          <span className="size-2.5 shrink-0 rounded-full bg-[color:var(--fr-green)]" />
        </div>

        {/* The YOU ARE HERE tab (§3.4.4): white tag, ink text, Flare border. */}
        <span className="fr-eyebrow mt-3 inline-flex items-center rounded-[6px] border-[1.5px] border-[color:var(--fr-flare)] bg-white px-2 py-1 text-[color:var(--fr-ink)]">
          You are here
        </span>

        <ol className="mt-6 grid gap-6 md:grid-cols-3 md:gap-8">
          {STEPS.map((step) => (
            <li key={step.key} className="flex flex-col">
              <div className="flex items-center gap-3">
                <Node kind={step.node} />
                <span className="fr-eyebrow text-[color:var(--fr-ink-55)]">
                  {step.label}
                </span>
              </div>
              <p className="mt-3 font-body-mkt text-[0.9375rem] font-semibold text-[color:var(--fr-ink)]">
                {step.title}
              </p>
              <p className="mt-1.5 text-[0.875rem] leading-relaxed text-[color:var(--fr-ink-70)]">
                {step.body}
              </p>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
