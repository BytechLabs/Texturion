/**
 * Live usage-meter proof (§H9). The real usage-fill bar with the cap markers, as
 * static DOM: used / included, petrol fill, an alert marker at 80%, the cap you
 * control. Matches the app's Usage screen language, so it is honest and on-brand.
 *
 * Sits on the paper panel (§3). Server component, static.
 */

export function UsageMeterProof() {
  const used = 212;
  const included = 500;
  const pct = Math.round((used / included) * 100); // 42%

  return (
    <div className="panel-card rounded-[14px] p-5">
      <div className="flex items-baseline justify-between">
        <span className="text-[14px] font-medium text-[color:var(--ink)]">
          This billing period
        </span>
        <span className="font-mono-mkt text-[14px] tabular-nums text-[color:var(--graphite)]">
          <span className="font-semibold text-[color:var(--ink)]">{used}</span> /{" "}
          {included} texts
        </span>
      </div>

      {/* The fill bar with the 80% alert marker. */}
      <div className="relative mt-3 h-3 w-full overflow-hidden rounded-full bg-[color:var(--paper)]">
        <div
          className="h-full rounded-full bg-[color:var(--petrol)]"
          style={{ width: `${pct}%` }}
        />
        <span
          className="absolute top-0 h-full w-px bg-[color:var(--marker)]"
          style={{ left: "80%" }}
          aria-hidden
        />
      </div>
      <div className="font-mono-mkt mt-1.5 flex justify-between text-[11px] tabular-nums text-[color:var(--graphite)]">
        <span>{pct}% used</span>
        <span className="text-[color:var(--deep)]">alert at 80%</span>
      </div>

      {/* Cap control hint (owner-set; SPEC §2 default 3×). */}
      <div className="mt-4 flex items-center justify-between rounded-lg bg-[color:var(--paper)] px-3 py-2 text-[13px]">
        <span className="text-[color:var(--graphite)]">Spending cap</span>
        <span className="font-mono-mkt font-medium tabular-nums text-[color:var(--ink)]">
          3× included · you set it
        </span>
      </div>

      <p className="mt-4 text-[13px] leading-relaxed text-[color:var(--ink-70)]">
        This is the real usage meter. You set the cap; we email you at 80% and
        100%. No surprise bills.
      </p>
    </div>
  );
}
