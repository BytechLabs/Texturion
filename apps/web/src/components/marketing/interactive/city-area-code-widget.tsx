"use client";

/**
 * City → area-code widget (Track B) — §3.11 Canada beat / COPY §H11.
 *
 * Type a city (or a 3-digit code) and see the local area code, drawn from the
 * app's own verified NANP data (@jobtext/shared via city-lookup). A real
 * product visual, not a text list of chips (BLUEPRINT §3.10 finding). Keyboard-
 * accessible listbox pattern; aria-live result. <15KB island.
 *
 * Canada-forward: seeds with a Canadian example (Toronto → 416) so a Canadian
 * visitor immediately sees their own code. Reinforces "local numbers in every
 * province" without flag-waving.
 */

import { MapPin, Search } from "lucide-react";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

import { cn } from "@/lib/utils";

import { resolveQuery, type AreaCodeResult } from "./city-lookup";

export function CityAreaCodeWidget() {
  const [query, setQuery] = useState("Toronto");
  const [selected, setSelected] = useState<AreaCodeResult | null>(
    () => resolveQuery("Toronto", 1)[0] ?? null,
  );
  const [open, setOpen] = useState(false);
  // Index of the keyboard-highlighted option in the current results, or -1 for
  // "no active option" (input text is authoritative). Drives aria-activedescendant.
  const [activeIndex, setActiveIndex] = useState(-1);

  const listboxId = useId();
  const optionId = (i: number) => `${listboxId}-opt-${i}`;
  const listRef = useRef<HTMLUListElement>(null);

  const results = useMemo(() => resolveQuery(query, 6), [query]);

  // Keep the active option in view when it moves via the keyboard. Query the
  // list's children by position rather than by id so there's no dependency on
  // the id-builder closure.
  useEffect(() => {
    if (!open || activeIndex < 0) return;
    const list = listRef.current;
    list?.querySelectorAll<HTMLElement>('[role="option"]')[activeIndex]
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  const pick = (r: AreaCodeResult) => {
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
    <div className="rounded-[10px] border border-border bg-card p-5 shadow-[0_24px_64px_-32px_rgba(28,25,23,0.25)]">
      <label
        htmlFor="area-code-city"
        className="text-[14px] font-medium text-foreground"
      >
        Find your local area code
      </label>
      <div className="relative mt-2">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          strokeWidth={1.75}
          aria-hidden
        />
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
            setQuery(e.target.value);
            setOpen(true);
            // New query text ⇒ reset the keyboard highlight to "none".
            setActiveIndex(-1);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          onBlur={() => setOpen(false)}
          className="w-full rounded-md border border-input bg-background py-2 pl-9 pr-3 text-[15px] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        />
        {open && results.length > 0 && (
          <ul
            id={listboxId}
            ref={listRef}
            role="listbox"
            aria-label="Matching cities and area codes"
            className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-md border border-border bg-popover py-1 shadow-lg"
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
                    "flex cursor-pointer items-center justify-between gap-3 px-3 py-2 text-left text-[14px]",
                    active && "bg-accent",
                  )}
                >
                  <span className="truncate text-foreground">{r.city}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
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
        className="mt-4 flex items-center gap-3 rounded-lg bg-primary/5 p-4"
      >
        {selected ? (
          <>
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <MapPin className="size-5" strokeWidth={1.75} aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="text-[15px] text-foreground">
                A{" "}
                <span className="font-semibold tabular-nums text-primary">
                  ({selected.areaCode})
                </span>{" "}
                number for{" "}
                <span className="font-medium">
                  {selected.city.startsWith("Area code")
                    ? selected.regionLabel ?? selected.country
                    : selected.city}
                </span>
                {selected.regionLabel && !selected.city.startsWith("Area code") && (
                  <span className="text-muted-foreground">
                    {" "}
                    — {selected.regionLabel}
                  </span>
                )}
              </p>
              <p className="text-[12px] text-muted-foreground">
                {selected.country === "CA"
                  ? "Canadian number — texting works the same day you sign up."
                  : "US number — receiving works day one; texting turns on in about a week."}
              </p>
            </div>
          </>
        ) : (
          <p className="text-[14px] text-muted-foreground">
            No match — try a nearby city or a 3-digit area code.
          </p>
        )}
      </div>

      <p className={cn("mt-3 text-[12px] text-muted-foreground")}>
        Real numbering data — the same table the app uses to pick your number.
      </p>
    </div>
  );
}
