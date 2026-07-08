/**
 * S9 usage-meter embed (COPY-DECK v2 §S9 "Usage-meter caption (real
 * component)"). The app's Usage screen pattern as static DOM: used over
 * included, the fill bar with the 80% alert marker, and the owner-set
 * spending cap (SPEC §2: alerts at 80% and 100%, cap default 3x the
 * allowance).
 *
 * Law 2: this renders INSIDE a PanelFrame's `.app-scope` region, so every
 * token class below (bg-primary, text-foreground, bg-secondary,
 * text-muted-foreground) resolves to the app's own petrol system, never
 * marketing cobalt. The figures are the honest Starter shape: 212 of 500
 * used (42%), cap at 3x.
 */

export function UsageMeterEmbed() {
  const used = 212;
  const included = 500;
  const pct = Math.round((used / included) * 100); // 42%

  return (
    <div className="bg-background p-5 text-foreground">
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium">This billing period</span>
        <span className="text-sm tabular-nums text-muted-foreground">
          <span className="font-semibold text-foreground">{used}</span> /{" "}
          {included} texts
        </span>
      </div>

      {/* The fill bar with the 80% alert marker. */}
      <div className="relative mt-3 h-3 w-full overflow-hidden rounded-full bg-secondary">
        <div
          className="h-full rounded-full bg-primary"
          style={{ width: `${pct}%` }}
        />
        <span
          className="absolute top-0 h-full w-px bg-foreground/40"
          style={{ left: "80%" }}
          aria-hidden
        />
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] tabular-nums text-muted-foreground">
        <span>{pct}% used</span>
        <span>alert at 80%</span>
      </div>

      {/* The owner-set cap (SPEC §2 default 3x the allowance). */}
      <div className="mt-4 flex items-center justify-between rounded-lg bg-secondary px-3 py-2 text-[13px]">
        <span className="text-muted-foreground">Spending cap</span>
        <span className="font-medium tabular-nums text-foreground">
          3× included · you set it
        </span>
      </div>
    </div>
  );
}
