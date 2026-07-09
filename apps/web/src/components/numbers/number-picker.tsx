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

/**
 * A NumberPicker pick is either a full E.164 (order that exact number) or a
 * 3-digit area code (masked/CA — assign a number in it). Callers use this to
 * build the right create/remediate payload.
 */
export function isFullNumber(value: string): boolean {
  return /^\+1\d{10}$/.test(value);
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
 * Shared choose-your-number picker: pick an area code, then a specific number
 * from a REFRESHABLE live Telnyx list. Two outcomes via onSelect(value):
 *  - a full E.164 (US, and any revealed number) — order that exact number;
 *  - a 3-digit area code — when Telnyx MASKS the digits (Canadian inventory
 *    reads "+14375------"), no individual number is orderable, so the user
 *    picks the AREA CODE and we assign the number at order time.
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

  const areaResults = useMemo(
    () => (areaCode === null ? searchAreaCodes(query, country) : []),
    [areaCode, query, country],
  );

  const list = useAvailableNumbers({ country, areaCode, bestEffort });

  // Step 1: pick an area code (static NANP search — no Telnyx call yet).
  if (areaCode === null) {
    return (
      <div className="space-y-2">
        <Label htmlFor="np-area">Area code</Label>
        <Input
          id="np-area"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={country === "US" ? "Denver or 720" : "Toronto or 416"}
          autoComplete="off"
          inputMode="search"
          autoFocus
        />
        {query.trim() !== "" && areaResults.length > 0 ? (
          <ul className="max-h-56 divide-y divide-border overflow-auto rounded-lg border">
            {areaResults.map((hint) => (
              <li key={hint.code}>
                <button
                  type="button"
                  onClick={() => {
                    setAreaCode(hint.code);
                    setQuery("");
                  }}
                  className="flex w-full items-center justify-between px-3 py-2 text-left text-sm transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                >
                  <span className="tabular-nums">{hint.label}</span>
                  <span className="text-[13px] text-muted-foreground">
                    {hint.region}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : query.trim() !== "" ? (
          <p className="text-[13px] text-muted-foreground">
            No {country === "US" ? "US" : "Canadian"} area codes match that.
          </p>
        ) : null}
      </div>
    );
  }

  // Step 2: pick a number (or, when masked, the area code) for that NDC.
  const hint = areaCodeHint(areaCode, country);
  const numbers = list.data?.data ?? [];
  const masked = list.data?.masked ?? false;

  return (
    <div className="space-y-3">
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
          }}
        >
          Change area code
        </Button>
      </div>

      {list.isError ? (
        <p className="text-sm text-destructive">
          Couldn&apos;t load numbers. Try Refresh in a moment.
        </p>
      ) : list.isPending ? (
        <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Finding available numbers…
        </div>
      ) : masked ? (
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
              Canadian numbers are assigned the moment you finish setup, so the
              exact number isn&apos;t shown here — we&apos;ll give you a local{" "}
              {areaCode} number (or a nearby one).
            </span>
          </span>
        </button>
      ) : numbers.length > 0 ? (
        <ul className="max-h-64 divide-y divide-border overflow-auto rounded-lg border">
          {numbers.map((n) => {
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
      ) : (
        <p className="text-sm text-muted-foreground">
          {bestEffort
            ? `No numbers available near area code ${areaCode} right now. Try a different area code.`
            : `No numbers in area code ${areaCode} right now. Turn on nearby numbers, or try a different area code.`}
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
    </div>
  );
}
