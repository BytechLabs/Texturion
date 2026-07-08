"use client";

import { NANP_AREA_CODES } from "@loonext/shared";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api/error";
import { useProvisionNumber } from "@/lib/api/numbers";
import type { Country } from "@/lib/api/types";

const REGION_NAMES: Record<Country, string> = { US: "US", CA: "Canada" };

/** Live hint for a typed area code, from the shared NANP table. */
function areaCodeHint(code: string, country: Country): string | null {
  if (!/^\d{3}$/.test(code)) return null;
  const entry = NANP_AREA_CODES[code];
  if (!entry || !entry.geographic) {
    return `${code} isn't an assigned ${REGION_NAMES[country]} area code.`;
  }
  if (entry.country !== country) {
    return `${code} is a ${REGION_NAMES[entry.country]} area code. Your account texts from ${REGION_NAMES[country]} numbers.`;
  }
  return `(${code}): ${entry.region}, ${REGION_NAMES[entry.country]}`;
}

/**
 * Pro's second number (SPEC §7 POST /v1/numbers/provision): owner/admin, area
 * code picked against the shared NANP table with a live hint.
 */
export function ProvisionNumberDialog({ country }: { country: Country }) {
  const provision = useProvisionNumber();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  const hint = areaCodeHint(code, country);
  const entry = /^\d{3}$/.test(code) ? NANP_AREA_CODES[code] : undefined;
  const valid = Boolean(entry?.geographic && entry.country === country);

  function reset(next: boolean) {
    if (!next) {
      setCode("");
      setError(null);
    }
    setOpen(next);
  }

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogTrigger asChild>
        <Button variant="outline">Add a number</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a second number</DialogTitle>
          <DialogDescription>
            Pick the area code your customers know. The number is ready in
            about a minute.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="area-code">Area code</Label>
          <Input
            id="area-code"
            value={code}
            onChange={(event) => {
              setCode(event.target.value.replace(/\D/g, "").slice(0, 3));
              if (error) setError(null); // clear stale submit error on edit
            }}
            placeholder={country === "CA" ? "416" : "212"}
            inputMode="numeric"
            autoComplete="off"
            className="w-28 tabular-nums"
          />
          {hint && (
            <p
              className={
                valid
                  ? "text-sm text-muted-foreground"
                  : // amber-700 in light for the G11 4.5:1 text bar.
                    "text-sm text-amber-700 dark:text-warning"
              }
            >
              {hint}
            </p>
          )}
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => reset(false)}>
            Cancel
          </Button>
          <Button
            disabled={!valid || provision.isPending}
            onClick={() =>
              provision.mutate(code, {
                onSuccess: () => {
                  reset(false);
                  toast.success("Number on the way, usually under a minute.");
                },
                onError: (cause) =>
                  setError(
                    cause instanceof ApiError
                      ? cause.message
                      : "Couldn't start the number setup. Try again.",
                  ),
              })
            }
          >
            {provision.isPending ? "Setting up…" : "Add number"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
