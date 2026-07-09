"use client";

import { Loader2, RefreshCw } from "lucide-react";
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
 * Shared choose-your-number picker: pick an area code, see a REFRESHABLE live
 * list of real Telnyx numbers, optionally widen to nearby numbers, and select
 * one. Purely presentational — it calls onSelect(e164); the caller owns the
 * write (order at checkout in onboarding, remediate on the paid row in
 * settings). Mounted by BOTH surfaces so the pick UX is identical.
 */
export function NumberPicker({
  country,
  initialAreaCode = null,
  selected = null,
  onSelect,
}: {
  country: Country;
  initialAreaCode?: string | null;
  /** The currently-chosen number, highlighted in the list. */
  selected?: string | null;
  onSelect: (e164: string) => void;
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

  // Step 2: pick a real number from the live Telnyx list for that area code.
  const hint = areaCodeHint(areaCode, country);
  const numbers = list.data?.data ?? [];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">
          Numbers in {hint ? hint.label : `area code ${areaCode}`}
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
      ) : numbers.length > 0 ? (
        <ul className="max-h-64 divide-y divide-border overflow-auto rounded-lg border">
          {numbers.map((n) => (
            <li key={n.phone_number}>
              <button
                type="button"
                onClick={() => onSelect(n.phone_number)}
                aria-pressed={selected === n.phone_number}
                className={cn(
                  "flex w-full items-center justify-between px-3 py-2.5 text-left text-sm transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none",
                  selected === n.phone_number && "bg-primary/5",
                )}
              >
                <span className="font-medium tabular-nums">
                  {formatPhone(n.phone_number)}
                </span>
                {n.region ? (
                  <span className="text-[13px] text-muted-foreground">
                    {n.region}
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          {bestEffort
            ? `No numbers available near area code ${areaCode} right now. Try a different area code.`
            : `No numbers in area code ${areaCode} right now. Turn on nearby numbers, or try a different area code.`}
        </p>
      )}

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
    </div>
  );
}
