/**
 * <CityAreaCodeWidgetStatic>, the area-code widget seeded to its default
 * (Toronto, 416), as pure server DOM in the v4 voice. The no-JS /
 * pre-hydration frame so the Canada beat shows a real local-number result
 * before (and without) the interactive island, and so the NANP lookup data
 * (@loonext/shared table + the city index) stays OUT of the initial bundle
 * until the widget nears the viewport. <LazyIsland> swaps in the typable
 * combobox on viewport approach.
 *
 * The seeded result mirrors the interactive widget's initial state (Toronto,
 * area code 416, Ontario, Canada), green day-one tick included, so the swap
 * is seamless.
 */

export function CityAreaCodeWidgetStatic() {
  return (
    <div className="fr-card p-5">
      <p className="text-[0.875rem] font-semibold text-[color:var(--fr-ink)]">
        Find your local area code
      </p>
      {/* Inert input; the interactive island replaces it with a real combobox. */}
      <div className="mt-2 w-full rounded-[10px] border border-[color:var(--fr-frost)] bg-white px-3 py-2 text-[0.9375rem] text-[color:var(--fr-ink)]">
        Toronto
      </div>

      <div className="mt-4 rounded-[10px] bg-[color:var(--fr-frost)] p-4">
        <div className="min-w-0">
          <p className="text-[0.9375rem] text-[color:var(--fr-ink)]">
            A{" "}
            <span className="fr-mono-data text-[color:var(--fr-ink)]">
              (416)
            </span>{" "}
            number for <span className="font-medium">Toronto</span>
            <span className="text-[color:var(--fr-ink-70)]">, Ontario</span>.
          </p>
          <p className="mt-1 flex items-center gap-1.5 text-[0.75rem] text-[color:var(--fr-ink-70)]">
            <svg
              viewBox="0 0 16 16"
              className="size-3.5 shrink-0"
              aria-hidden="true"
              focusable="false"
            >
              <path
                d="M3 8.5 6.5 12 13 4.5"
                fill="none"
                stroke="var(--fr-green)"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Canadian number, texting works the same day you sign up.
          </p>
        </div>
      </div>

      <a
        href="/signup"
        className="mt-4 inline-flex items-center gap-1 text-[0.9375rem] font-semibold text-[color:var(--fr-cobalt)] underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--fr-cobalt)]"
      >
        Get your (416) number →
      </a>

      <p className="mt-3 text-[0.75rem] text-[color:var(--fr-ink-55)]">
        Local numbers are available across the US and Canada, in the area code
        you choose.
      </p>
    </div>
  );
}
