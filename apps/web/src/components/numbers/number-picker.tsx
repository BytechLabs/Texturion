"use client";

import { Check, Loader2, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { areaCodeHint, searchAreaCodes } from "@/app/onboarding/area-codes";
import { useAvailableNumbers } from "@/lib/api/numbers";
import { formatPhone } from "@/lib/format/phone";
import { cn } from "@/lib/utils";

type Country = "US" | "CA";
type DigitMatch = "anywhere" | "start" | "end";

/**
 * A NumberPicker pick is either a full E.164 (order that exact number) or a
 * 3-digit area code (masked/CA — assign a number in it). Callers use this to
 * build the right create/remediate payload.
 */
export function isFullNumber(value: string): boolean {
  return /^\+1\d{10}$/.test(value);
}

/**
 * Client-side digit filter over the fetched batch. Telnyx's server-side digit
 * filters (contains/starts_with/ends_with) are silently ignored on this
 * endpoint, so we filter the numbers we already have — instant, honest, and
 * "Refresh"/"nearby" pull a different batch when a pattern is rare.
 */
function matchesDigits(e164: string, digits: string, match: DigitMatch): boolean {
  if (!digits) return true;
  const local = e164.replace(/^\+1/, "");
  if (match === "start") return local.startsWith(digits);
  if (match === "end") return local.endsWith(digits);
  return local.includes(digits);
}

/** The filled/empty select indicator — makes the chosen row unmistakable. */
function SelectDot({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
        on
          ? "border-primary bg-primary text-primary-foreground"
          : "border-muted-foreground/40",
      )}
    >
      {on ? <Check className="size-3" strokeWidth={3} /> : null}
    </span>
  );
}

/**
 * Shared choose-your-number picker. Area code and digits are FILTERS, not a
 * gate (#86): the picker shows a live, refreshable Telnyx list of available
 * numbers immediately, and an area code (optional) narrows it. Two outcomes via
 * onSelect(value):
 *  - a full E.164 (US, and any revealed number) — order that exact number;
 *  - a 3-digit area code — when Telnyx MASKS the digits (Canadian inventory
 *    reads "+14375------"), no individual number is orderable, so the user
 *    picks the AREA CODE and we assign the number at order time. Because CA
 *    numbers are always masked, a Canadian pick needs an area code; a US pick
 *    can browse the whole country and filter by digits.
 * The caller interprets the value (E.164 vs area code) and owns the write.
 */
export function NumberPicker({
  country,
  initialAreaCode = null,
  selected = null,
  onSelect,
}: {
  country: Country;
  initialAreaCode?: string | null;
  /** The current pick — an E.164 or a 3-digit area code — highlighted below. */
  selected?: string | null;
  onSelect: (value: string) => void;
}) {
  const [areaCode, setAreaCode] = useState<string | null>(initialAreaCode);
  const [query, setQuery] = useState("");
  const [bestEffort, setBestEffort] = useState(false);
  const [digits, setDigits] = useState("");
  const [match, setMatch] = useState<DigitMatch>("anywhere");

  // With no area code chosen, typing in the (optional) area-code field searches
  // NANP codes. An empty field means "browse all": the list below loads a broad
  // country-wide batch. Only while the user is actively typing an area-code
  // search do we hand the view over to the NANP results instead of the numbers.
  const searchingAreaCode = areaCode === null && query.trim() !== "";
  const areaResults = useMemo(
    () => (searchingAreaCode ? searchAreaCodes(query, country) : []),
    [searchingAreaCode, query, country],
  );

  // Fires immediately with a broad country search; an area code, when set,
  // narrows it (the server treats area_code as optional). The digit filter runs
  // client-side over whatever batch comes back.
  const list = useAvailableNumbers({ country, areaCode, bestEffort });

  const hint = areaCode ? areaCodeHint(areaCode, country) : null;
  const numbers = list.data?.data ?? [];
  const masked = list.data?.masked ?? false;
  const filtered = numbers.filter((n) =>
    matchesDigits(n.phone_number, digits, match),
  );

  return (
    <div className="space-y-3">
      {/* Area code: an OPTIONAL filter, not a gate. */}
      {areaCode === null ? (
        <div className="space-y-2">
          <Label htmlFor="np-area">Area code (optional)</Label>
          <Input
            id="np-area"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={
              country === "US"
                ? "Denver or 720, or leave blank to browse all"
                : "Toronto or 416"
            }
            autoComplete="off"
            inputMode="search"
          />
          {searchingAreaCode && areaResults.length > 0 ? (
            <ul className="max-h-56 divide-y divide-border overflow-auto rounded-lg border">
              {areaResults.map((item) => (
                <li key={item.code}>
                  <button
                    type="button"
                    onClick={() => {
                      setAreaCode(item.code);
                      setQuery("");
                    }}
                    className="flex w-full items-center justify-between px-3 py-2 text-left text-sm transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                  >
                    <span className="tabular-nums">{item.label}</span>
                    <span className="text-[13px] text-muted-foreground">
                      {item.region}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : searchingAreaCode ? (
            <p className="text-[13px] text-muted-foreground">
              No {country === "US" ? "US" : "Canadian"} area codes match that.
            </p>
          ) : null}
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium">
            {hint ? hint.label : `Area code ${areaCode}`}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setAreaCode(null);
              setBestEffort(false);
              setDigits("");
            }}
          >
            Change area code
          </Button>
        </div>
      )}

      {/* The numbers. Hidden only while the user is actively searching for an
          area code (they're picking a filter, not a number yet). */}
      {!searchingAreaCode && (
        <>
          {/* Optional digit filter — one clean field + a small anywhere/start/end
              selector. Filters the fetched batch instantly (client-side). Hidden
              for the masked area-code choice. */}
          {!masked ? (
            <div className="flex items-center gap-2">
              <Input
                value={digits}
                onChange={(e) =>
                  setDigits(e.target.value.replace(/\D/g, "").slice(0, 7))
                }
                placeholder="Digits you'd like (optional)"
                inputMode="numeric"
                aria-label="Filter by digits"
                className="h-9 flex-1"
              />
              <select
                value={match}
                onChange={(e) => setMatch(e.target.value as DigitMatch)}
                aria-label="Where those digits appear"
                className="h-9 shrink-0 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="anywhere">anywhere</option>
                <option value="start">at start</option>
                <option value="end">at end</option>
              </select>
            </div>
          ) : null}

          {list.isError ? (
            <p className="text-sm text-destructive">
              Couldn&apos;t load numbers. Try Refresh in a moment.
            </p>
          ) : list.isPending ? (
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Finding available numbers…
            </div>
          ) : masked && areaCode ? (
            // Canada: Telnyx doesn't reveal the exact digits before order, so the
            // pick is the AREA CODE — we assign the actual number at setup.
            <button
              type="button"
              role="radio"
              aria-checked={selected === areaCode}
              onClick={() => onSelect(areaCode)}
              className={cn(
                "flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors",
                selected === areaCode
                  ? "border-primary bg-primary/10 ring-1 ring-primary"
                  : "border-border hover:bg-accent",
              )}
            >
              <SelectDot on={selected === areaCode} />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">
                  Get a number in area code {areaCode}
                </span>
                <span className="mt-0.5 block text-[13px] text-muted-foreground">
                  Canadian numbers are assigned the moment you finish setup, so
                  the exact number isn&apos;t shown here — we&apos;ll give you a
                  local {areaCode} number (or a nearby one).
                </span>
              </span>
            </button>
          ) : masked ? (
            // Canada with no area code chosen: masked numbers can't be browsed,
            // so guide the user to pick an area code above.
            <p className="text-sm text-muted-foreground">
              Canadian numbers are assigned at setup, so pick an area code above
              and we&apos;ll give you a local number in it.
            </p>
          ) : filtered.length > 0 ? (
            <ul className="max-h-64 divide-y divide-border overflow-auto rounded-lg border">
              {filtered.map((n) => {
                const on = selected === n.phone_number;
                return (
                  <li key={n.phone_number}>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={on}
                      onClick={() => onSelect(n.phone_number)}
                      className={cn(
                        "flex w-full items-center gap-3 px-3 py-3 text-left transition-colors",
                        on ? "bg-primary/10" : "hover:bg-accent",
                      )}
                    >
                      <SelectDot on={on} />
                      <span
                        className={cn(
                          "flex-1 text-base tabular-nums",
                          on ? "font-semibold text-primary" : "font-medium",
                        )}
                      >
                        {formatPhone(n.phone_number)}
                      </span>
                      {n.region ? (
                        <span className="shrink-0 text-[13px] text-muted-foreground">
                          {n.region}
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : digits && numbers.length > 0 ? (
            <p className="text-sm text-muted-foreground">
              None of the available numbers{" "}
              {match === "start"
                ? "start with"
                : match === "end"
                  ? "end in"
                  : "contain"}{" "}
              {digits}. Try fewer digits, Refresh for a new batch, or turn on
              nearby numbers.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              {bestEffort
                ? `No numbers available near area code ${areaCode ?? ""} right now. Try a different area code.`
                : areaCode
                  ? `No numbers in area code ${areaCode} right now. Turn on nearby numbers, or try a different area code.`
                  : "No numbers available right now. Refresh for a new batch, or turn on nearby numbers."}
            </p>
          )}

          {/* The masked (CA) case is a single area-code choice — no list to widen
              or refresh, so hide those controls there. */}
          {!masked ? (
            <div className="flex items-center justify-between gap-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4"
                  checked={bestEffort}
                  onChange={(e) => setBestEffort(e.target.checked)}
                />
                Show nearby numbers
              </label>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void list.refetch()}
                disabled={list.isFetching}
              >
                <RefreshCw
                  className={cn("size-4", list.isFetching && "animate-spin")}
                  aria-hidden
                />
                Refresh
              </Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
