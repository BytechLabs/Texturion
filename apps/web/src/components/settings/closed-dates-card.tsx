"use client";

import { Plus, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { SettingsCard } from "@/components/settings/section";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api/error";
import { useUpdateCompany } from "@/lib/api/companies";
import type { CompanyView } from "@/lib/api/types";
import type { HoursException } from "@loonext/shared";

/**
 * #402 — the dates the weekly schedule cannot know about.
 *
 * Christmas Day falls on a Thursday. The schedule says Thursday 08:00–17:00,
 * so the product believed the shop was open and a homeowner with a burst pipe
 * got silence. An auto-reply matters MORE on a holiday than on an ordinary
 * evening: at 9pm on a Tuesday the customer knows why nobody replied, but on
 * Christmas Day silence is ambiguous, and they resolve that by calling
 * somebody else.
 *
 * ---------------------------------------------------------------------------
 * IT SITS UNDER BUSINESS HOURS, NOT IN A SECTION OF ITS OWN.
 *
 * These dates only mean anything as an override of the weekly schedule, and an
 * owner looking for "we're shut on Boxing Day" looks where they set their
 * hours. A separate page would be a second place to remember.
 * *Applying: Relationship Strength — a control belongs beside the thing it
 * modifies.*
 *
 * NO HOLIDAY PICKER, DELIBERATELY. Canadian statutory holidays vary by
 * province and Quebec observes St-Jean-Baptiste on 24 June; more to the point,
 * emergency plumbing and HVAC are BUSIEST when everyone else is closed, so a
 * suggested-holidays list would be wrong for a good share of this product's
 * customers and they would spend every year dismissing it.
 */

/** A row being edited. Kept as strings so a half-typed date is not a crash. */
interface DraftRow {
  from: string;
  to: string;
  note: string;
}

const EMPTY: DraftRow = { from: "", to: "", note: "" };

/** "2026-12-25" → "Fri 25 Dec 2026", or the raw value if it will not parse. */
function readableDate(iso: string): string {
  const parsed = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function rangeLabel(entry: HoursException): string {
  return entry.from === entry.to
    ? readableDate(entry.from)
    : `${readableDate(entry.from)} — ${readableDate(entry.to)}`;
}

export function ClosedDatesCard({
  company,
  canEdit,
}: {
  company: CompanyView;
  canEdit: boolean;
}) {
  const update = useUpdateCompany();
  const existing = company.business_hours_exceptions ?? [];
  const [draft, setDraft] = useState<DraftRow>(EMPTY);
  const [error, setError] = useState<string | null>(null);

  function commit(next: HoursException[], message: string) {
    setError(null);
    update.mutate(
      { business_hours_exceptions: next },
      {
        onSuccess: () => toast.success(message),
        onError: (cause) =>
          setError(
            cause instanceof ApiError
              ? cause.message
              : "Couldn't save those dates. Try again.",
          ),
      },
    );
  }

  function add() {
    const from = draft.from.trim();
    // An owner who fills in only the first box means one day. Requiring them
    // to type the same date twice would be busywork on the common case.
    const to = draft.to.trim() || from;
    if (from === "") {
      setError("Pick the date you're closed.");
      return;
    }
    if (to < from) {
      setError("The last day can't be before the first day.");
      return;
    }
    commit(
      [
        ...existing,
        {
          from,
          to,
          // Closed all day. A half-day is a rarer case and would need a second
          // pair of inputs on every row to serve it; the weekly schedule
          // already handles the shape of an ordinary short day.
          hours: null,
          ...(draft.note.trim() ? { note: draft.note.trim() } : {}),
        },
      ],
      "Closed date added.",
    );
    setDraft(EMPTY);
  }

  function remove(index: number) {
    commit(
      existing.filter((_, i) => i !== index),
      "Closed date removed.",
    );
  }

  return (
    <SettingsCard
      title="Closed dates"
      description="Holidays, a week off, a day for a funeral. On these dates your away reply goes out even if the weekly schedule says you're open — so a customer texting on Christmas morning hears something back instead of nothing."
    >
      <div className="space-y-3">
        {existing.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No closed dates yet. Your weekly hours apply every week.
          </p>
        ) : (
          <ul className="space-y-2">
            {existing.map((entry, index) => (
              <li
                key={`${entry.from}-${entry.to}-${index}`}
                className="flex items-start justify-between gap-3 border-b border-border-subtle pb-2 last:border-b-0 last:pb-0"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">{rangeLabel(entry)}</p>
                  {entry.note ? (
                    <p className="text-[13px] text-muted-foreground">
                      {entry.note}
                    </p>
                  ) : null}
                </div>
                {canEdit ? (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove ${rangeLabel(entry)}`}
                    disabled={update.isPending}
                    onClick={() => remove(index)}
                  >
                    <X className="size-4" strokeWidth={1.75} aria-hidden />
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {canEdit ? (
          <div className="flex flex-wrap items-end gap-3 pt-1">
            <div className="space-y-1">
              <Label htmlFor="closed-from" className="text-xs">
                First day
              </Label>
              <Input
                id="closed-from"
                type="date"
                className="w-40"
                value={draft.from}
                onChange={(event) =>
                  setDraft((d) => ({ ...d, from: event.target.value }))
                }
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="closed-to" className="text-xs">
                Last day
              </Label>
              <Input
                id="closed-to"
                type="date"
                className="w-40"
                // Empty means one day, which is what most of these are.
                placeholder="Same day"
                value={draft.to}
                onChange={(event) =>
                  setDraft((d) => ({ ...d, to: event.target.value }))
                }
              />
            </div>
            <div className="min-w-[12rem] flex-1 space-y-1">
              <Label htmlFor="closed-note" className="text-xs">
                What to tell customers (optional)
              </Label>
              <Input
                id="closed-note"
                maxLength={200}
                placeholder="Closed for the holiday, back Monday"
                value={draft.note}
                onChange={(event) =>
                  setDraft((d) => ({ ...d, note: event.target.value }))
                }
              />
            </div>
            <Button onClick={add} disabled={update.isPending}>
              <Plus strokeWidth={1.75} aria-hidden />
              Add
            </Button>
          </div>
        ) : null}

        {error !== null ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </SettingsCard>
  );
}
