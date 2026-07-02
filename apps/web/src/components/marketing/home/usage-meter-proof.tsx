/**
 * Live usage-meter proof (Track B) — §3.9 (finding: show the meter). A real
 * petrol usage-fill bar with the cap markers, rendered as live DOM (the §10 S10
 * crop is gated on seed capture; DOM keeps it honest and sharp). Matches the
 * app's Usage screen language (G8): used / included, petrol fill → amber at
 * 80%, cap control, alerts at 80% and 100%. Copy from §H9 usage caption.
 *
 * Server component — static, no interactivity needed for the proof.
 */

export function UsageMeterProof() {
  const used = 212;
  const included = 500;
  const pct = Math.round((used / included) * 100); // 42%

  return (
    <div className="rounded-[10px] border border-border bg-card p-5">
      <div className="flex items-baseline justify-between">
        <span className="text-[14px] font-medium text-foreground">
          This billing period
        </span>
        <span className="text-[14px] tabular-nums text-muted-foreground">
          <span className="font-semibold text-foreground">{used}</span> /{" "}
          {included} texts
        </span>
      </div>

      {/* The fill bar with 80% and 100% alert markers. */}
      <div className="relative mt-3 h-3 w-full overflow-hidden rounded-full bg-secondary">
        <div
          className="h-full rounded-full bg-primary"
          style={{ width: `${pct}%` }}
        />
        {/* 80% alert marker */}
        <span
          className="absolute top-0 h-full w-px bg-amber-500/70"
          style={{ left: "80%" }}
          aria-hidden
        />
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] tabular-nums text-muted-foreground">
        <span>{pct}% used</span>
        <span className="text-amber-700 dark:text-warning">alert at 80%</span>
      </div>

      {/* Cap control hint (owner-set; SPEC §2 default 3×). */}
      <div className="mt-4 flex items-center justify-between rounded-lg bg-secondary/60 px-3 py-2 text-[13px]">
        <span className="text-muted-foreground">Spending cap</span>
        <span className="font-medium tabular-nums text-foreground">
          3× included · you set it
        </span>
      </div>

      <p className="mt-4 text-[13px] leading-relaxed text-muted-foreground">
        This is the real usage meter. You set the cap; we email you at 80% and
        100%. No surprise bills.
      </p>
    </div>
  );
}
