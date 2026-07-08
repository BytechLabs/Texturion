/**
 * <CityAreaCodeWidgetStatic>, the area-code widget seeded to the SSR default
 * (Austin, 512), as pure server DOM in the v4 voice. The no-JS /
 * pre-hydration frame so the picker shows a real local-number result before
 * (and without) the interactive island, and so the NANP lookup data
 * (@loonext/shared table + the city index) stays OUT of the initial bundle
 * until the widget nears the viewport. <LazyIsland> swaps in the typable
 * combobox on viewport approach.
 *
 * Seeded to the US example to mirror the interactive widget's SSR-default
 * initial state (country default "us" -> Austin, area code 512, Texas). The
 * interactive island then adopts the visitor's country after hydration, so a
 * returning Canadian swaps to the Toronto seed one frame later; the static
 * frame itself carries no Canadian day-one copy, so a US visitor never reads
 * it pre-hydration.
 */

export function CityAreaCodeWidgetStatic() {
  return (
    <div className="fr-card p-5">
      <p className="text-[0.875rem] font-semibold text-[color:var(--fr-ink)]">
        Find your local area code
      </p>
      {/* Inert input; the interactive island replaces it with a real combobox. */}
      <div className="mt-2 w-full rounded-[10px] border border-[color:var(--fr-frost)] bg-white px-3 py-2 text-[0.9375rem] text-[color:var(--fr-ink)]">
        Austin
      </div>

      <div className="mt-4 rounded-[10px] bg-[color:var(--fr-frost)] p-4">
        <div className="min-w-0">
          <p className="text-[0.9375rem] text-[color:var(--fr-ink)]">
            A{" "}
            <span className="fr-mono-data text-[color:var(--fr-ink)]">
              (512)
            </span>{" "}
            number for <span className="font-medium">Austin</span>
            <span className="text-[color:var(--fr-ink-70)]">, Texas</span>.
          </p>
          <p className="mt-1 text-[0.75rem] text-[color:var(--fr-ink-70)]">
            US number, receiving works day one; texting turns on in about a
            week.
          </p>
        </div>
      </div>

      <a
        href="/signup"
        className="mt-4 inline-flex items-center gap-1 text-[0.9375rem] font-semibold text-[color:var(--fr-cobalt)] underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--fr-cobalt)]"
      >
        Get your (512) number →
      </a>

      <p className="mt-3 text-[0.75rem] text-[color:var(--fr-ink-55)]">
        Local numbers are available across the US and Canada, in the area code
        you choose.
      </p>
    </div>
  );
}
