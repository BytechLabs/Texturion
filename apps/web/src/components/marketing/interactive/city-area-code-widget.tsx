"use client";

/**
 * City to area-code widget, v4 "FIRST RESPONSE". Type a city (or a 3-digit
 * code) and see the local area code, drawn from the app's own verified NANP
 * data (@loonext/shared via city-lookup): the math and the data are the
 * product's, only the frame is marketing.
 *
 * Canada-forward: seeds with a Canadian example (Toronto, 416) so a Canadian
 * visitor immediately sees their own code; the Canada day-one line carries
 * the green tick (green whitelist: the Canada "day one" tick). Area codes are
 * countable truths and render mono (§3). Keyboard-accessible listbox pattern;
 * aria-live result; cobalt focus rings (§7).
 */

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

import { useCountry } from "@/components/marketing/country";
import { APP_LINKS } from "@/lib/marketing/site";
import { cn } from "@/lib/utils";

import { resolveQuery, type AreaCodeResult } from "./city-lookup";

/** The local example each country seeds with (a real metro in the NANP index):
 *  Toronto (416) for Canada, Austin (512) for the US. */
const SEED_CITY = { us: "Austin", ca: "Toronto" } as const;

function DayOneTick() {
  return (
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
  );
}

export function CityAreaCodeWidget() {
  const { country } = useCountry();
  // Seed the default frame to a local example for the visitor's country, so a
  // US visitor sees a US number (and the honest carrier-wait line) and a
  // Canadian visitor sees Toronto (and the day-one line). The per-result line
  // below still reflects whatever number the visitor chooses to look up.
  const [query, setQuery] = useState<string>(SEED_CITY[country]);
  const [selected, setSelected] = useState<AreaCodeResult | null>(
    () => resolveQuery(SEED_CITY[country], 1)[0] ?? null,
  );
  // Once the visitor types or picks, their input is authoritative; until then,
  // the widget adopts the country's seed. This also swaps a returning Canadian
  // to the Toronto seed one frame after hydration, mirroring how the provider
  // itself adopts a stored choice.
  const touched = useRef(false);
  const [open, setOpen] = useState(false);
  // Index of the keyboard-highlighted option in the current results, or -1 for
  // "no active option" (input text is authoritative). Drives aria-activedescendant.
  const [activeIndex, setActiveIndex] = useState(-1);

  const listboxId = useId();
  const optionId = (i: number) => `${listboxId}-opt-${i}`;
  const listRef = useRef<HTMLUListElement>(null);

  const results = useMemo(() => resolveQuery(query, 6), [query]);

  // Until the visitor touches the widget, follow the site-wide country: seed
  // the query and the result to that country's local example.
  useEffect(() => {
    if (touched.current) return;
    const seed = SEED_CITY[country];
    setQuery(seed);
    setSelected(resolveQuery(seed, 1)[0] ?? null);
  }, [country]);

  // Keep the active option in view when it moves via the keyboard.
  useEffect(() => {
    if (!open || activeIndex < 0) return;
    const list = listRef.current;
    list
      ?.querySelectorAll<HTMLElement>('[role="option"]')
      [activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  const pick = (r: AreaCodeResult) => {
    touched.current = true;
    setSelected(r);
    setQuery(r.city.startsWith("Area code") ? r.areaCode : r.city);
    setOpen(false);
    setActiveIndex(-1);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // Open on first Arrow press if closed and there are results to show.
    if (
      !open &&
      results.length > 0 &&
      (e.key === "ArrowDown" || e.key === "ArrowUp")
    ) {
      e.preventDefault();
      setOpen(true);
      setActiveIndex(e.key === "ArrowDown" ? 0 : results.length - 1);
      return;
    }

    if (!open || results.length === 0) {
      if (e.key === "Escape") setOpen(false);
      return;
    }

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % results.length);
        break;
      case "ArrowUp":
        e.preventDefault();
        setActiveIndex((i) => (i <= 0 ? results.length - 1 : i - 1));
        break;
      case "Home":
        e.preventDefault();
        setActiveIndex(0);
        break;
      case "End":
        e.preventDefault();
        setActiveIndex(results.length - 1);
        break;
      case "Enter": {
        const r = activeIndex >= 0 ? results[activeIndex] : results[0];
        if (r) {
          e.preventDefault();
          pick(r);
        }
        break;
      }
      case "Escape":
        e.preventDefault();
        setOpen(false);
        setActiveIndex(-1);
        break;
      default:
        break;
    }
  };

  return (
    <div className="fr-card p-5">
      <label
        htmlFor="area-code-city"
        className="text-[0.875rem] font-semibold text-[color:var(--fr-ink)]"
      >
        Find your local area code
      </label>
      <div className="relative mt-2">
        <input
          id="area-code-city"
          type="text"
          value={query}
          autoComplete="off"
          role="combobox"
          aria-expanded={open && results.length > 0}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={
            open && activeIndex >= 0 ? optionId(activeIndex) : undefined
          }
          placeholder="Type a city or area code"
          onChange={(e) => {
            touched.current = true;
            setQuery(e.target.value);
            setOpen(true);
            // New query text: reset the keyboard highlight to "none".
            setActiveIndex(-1);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          onBlur={() => setOpen(false)}
          className="w-full rounded-[10px] border border-[color:var(--fr-frost)] bg-white px-3 py-2 text-[0.9375rem] text-[color:var(--fr-ink)] placeholder:text-[color:var(--fr-ink-55)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--fr-cobalt)]"
        />
        {open && results.length > 0 && (
          <ul
            id={listboxId}
            ref={listRef}
            role="listbox"
            aria-label="Matching cities and area codes"
            className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-[10px] bg-white py-1 shadow-[var(--fr-shadow-card)]"
          >
            {results.map((r, i) => {
              const active = i === activeIndex;
              return (
                <li
                  key={`${r.city}-${r.areaCode}`}
                  id={optionId(i)}
                  role="option"
                  aria-selected={active}
                  onMouseDown={(e) => {
                    // Commit before the input's onBlur closes the list.
                    e.preventDefault();
                    pick(r);
                  }}
                  onMouseEnter={() => setActiveIndex(i)}
                  className={cn(
                    "flex cursor-pointer items-center justify-between gap-3 px-3 py-2 text-left text-[0.875rem]",
                    active && "bg-[color:var(--fr-frost)]",
                  )}
                >
                  <span className="truncate text-[color:var(--fr-ink)]">
                    {r.city}
                  </span>
                  <span className="fr-mono-data shrink-0 text-[0.75rem] text-[color:var(--fr-ink-55)]">
                    ({r.areaCode}) · {r.country}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div
        aria-live="polite"
        className="mt-4 rounded-[10px] bg-[color:var(--fr-frost)] p-4"
      >
        {selected ? (
          <div className="min-w-0">
            <p className="text-[0.9375rem] text-[color:var(--fr-ink)]">
              A{" "}
              <span className="fr-mono-data text-[color:var(--fr-ink)]">
                ({selected.areaCode})
              </span>{" "}
              number for{" "}
              <span className="font-medium">
                {selected.city.startsWith("Area code")
                  ? (selected.regionLabel ?? selected.country)
                  : selected.city}
              </span>
              {selected.regionLabel &&
                !selected.city.startsWith("Area code") && (
                  <span className="text-[color:var(--fr-ink-70)]">
                    , {selected.regionLabel}
                  </span>
                )}
              .
            </p>
            <p className="mt-1 flex items-center gap-1.5 text-[0.75rem] text-[color:var(--fr-ink-70)]">
              {selected.country === "CA" ? (
                <>
                  <DayOneTick />
                  Canadian number, texting works the same day you sign up.
                </>
              ) : (
                "US number, receiving works day one; texting turns on in about a week."
              )}
            </p>
          </div>
        ) : (
          <p className="text-[0.875rem] text-[color:var(--fr-ink-70)]">
            No match, try a nearby city or a 3-digit area code.
          </p>
        )}
      </div>

      {selected && (
        <a
          href={APP_LINKS.signup}
          className="mt-4 inline-flex items-center gap-1 text-[0.9375rem] font-semibold text-[color:var(--fr-cobalt)] underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--fr-cobalt)]"
        >
          Get your ({selected.areaCode}) number →
        </a>
      )}

      <p className="mt-3 text-[0.75rem] text-[color:var(--fr-ink-55)]">
        Local numbers are available across the US and Canada, in the area code
        you choose.
      </p>
    </div>
  );
}
