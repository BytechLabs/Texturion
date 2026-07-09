"use client";

import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ApiError } from "@/lib/api/error";
import { useOnboardingUpdateCompany } from "@/lib/api/onboarding";
import { cn } from "@/lib/utils";

import { areaCodeHint, searchAreaCodes } from "../area-codes";

type Country = "US" | "CA";

/**
 * "Edit until checkout" (plan step): a compact, editable summary of the fields
 * that lock once the number is provisioned — workspace name, and the number
 * setup (country + area code + the CA US-texting choice). All save via PATCH
 * /v1/company, gated to pre-checkout on the server; a country change forces a
 * matching new area code and the wizard re-routes (e.g. switching to US now
 * owes registration). Number editing is hidden for a port-in.
 */
export function WorkspaceSummary({
  companyId,
  name,
  country,
  areaCode,
  usTexting,
  canEditNumber,
}: {
  companyId: string;
  name: string;
  country: Country;
  areaCode: string | null;
  usTexting: boolean;
  canEditNumber: boolean;
}) {
  const update = useOnboardingUpdateCompany();
  const [editing, setEditing] = useState<null | "name" | "number">(null);
  const [nameDraft, setNameDraft] = useState(name);
  const [draftCountry, setDraftCountry] = useState<Country>(country);
  const [draftAreaCode, setDraftAreaCode] = useState<string | null>(areaCode);
  const [draftUsTexting, setDraftUsTexting] = useState(usTexting);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  const areaHint = areaCode ? areaCodeHint(areaCode, country) : null;
  const results = useMemo(
    () =>
      editing === "number" && draftAreaCode === null
        ? searchAreaCodes(query, draftCountry)
        : [],
    [editing, query, draftCountry, draftAreaCode],
  );

  function fail(cause: unknown) {
    setError(
      cause instanceof ApiError
        ? cause.message
        : "Couldn't save that change. Try again in a moment.",
    );
  }

  async function saveName() {
    const next = nameDraft.trim();
    if (next.length === 0) {
      setError("Your workspace needs a name.");
      return;
    }
    if (next === name) {
      setEditing(null);
      return;
    }
    setError(null);
    try {
      await update.mutateAsync({ companyId, name: next });
      setEditing(null);
    } catch (cause) {
      fail(cause);
    }
  }

  function openNumberEditor() {
    setDraftCountry(country);
    setDraftAreaCode(areaCode);
    setDraftUsTexting(usTexting);
    setQuery("");
    setError(null);
    setEditing("number");
  }

  function pickCountry(next: Country) {
    setDraftCountry(next);
    setDraftAreaCode(null); // area codes belong to one country
    setQuery("");
  }

  async function saveNumber() {
    if (!draftAreaCode) {
      setError("Pick an area code for your number.");
      return;
    }
    setError(null);
    try {
      await update.mutateAsync({
        companyId,
        requested_area_code: draftAreaCode,
        ...(draftCountry !== country ? { country: draftCountry } : {}),
        ...(draftCountry === "CA" ? { us_texting_enabled: draftUsTexting } : {}),
      });
      setEditing(null);
    } catch (cause) {
      fail(cause);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <h2 className="text-[15px] font-medium">Your workspace</h2>
      <p className="mt-1 text-[13px] text-muted-foreground">
        You can still change these before you pay. They lock once your number is
        set up.
      </p>

      <dl className="mt-4 space-y-3">
        {/* Workspace name */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <dt className="text-[13px] text-muted-foreground">Workspace name</dt>
            {editing === "name" ? (
              <div className="mt-1 flex items-center gap-2">
                <Input
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  className="h-9"
                  aria-label="Workspace name"
                  maxLength={200}
                  autoFocus
                />
                <Button
                  size="sm"
                  onClick={() => void saveName()}
                  disabled={update.isPending}
                >
                  Save
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setEditing(null);
                    setNameDraft(name);
                    setError(null);
                  }}
                  disabled={update.isPending}
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <dd className="mt-0.5 truncate text-sm font-medium">{name}</dd>
            )}
          </div>
          {editing !== "name" ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setNameDraft(name);
                setEditing("name");
                setError(null);
              }}
            >
              Edit
            </Button>
          ) : null}
        </div>

        {/* Number setup: country + area code (+ CA US-texting). Hidden for a port. */}
        {canEditNumber ? (
          <div className="border-t border-border pt-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <dt className="text-[13px] text-muted-foreground">
                  Your business number
                </dt>
                {editing !== "number" ? (
                  <dd className="mt-0.5 text-sm font-medium">
                    {country === "US" ? "United States" : "Canada"}
                    {" · "}
                    <span className="tabular-nums">
                      {areaHint ? areaHint.label : (areaCode ?? "—")}
                    </span>
                    {country === "CA" && usTexting ? (
                      <span className="text-muted-foreground">
                        {" "}
                        · also texts US
                      </span>
                    ) : null}
                  </dd>
                ) : null}
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  editing === "number" ? setEditing(null) : openNumberEditor()
                }
                disabled={update.isPending}
              >
                {editing === "number" ? "Cancel" : "Change"}
              </Button>
            </div>

            {editing === "number" ? (
              <div className="mt-3 space-y-3">
                <fieldset>
                  <legend className="text-[13px] text-muted-foreground">
                    Country
                  </legend>
                  <RadioGroup
                    value={draftCountry}
                    onValueChange={(v) => pickCountry(v as Country)}
                    className="mt-1 grid grid-cols-2 gap-2"
                  >
                    {(
                      [
                        ["US", "United States"],
                        ["CA", "Canada"],
                      ] as const
                    ).map(([value, label]) => (
                      <Label
                        key={value}
                        className={cn(
                          "flex h-10 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm font-medium transition-colors",
                          draftCountry === value
                            ? "border-primary bg-primary/5"
                            : "border-border bg-card hover:bg-accent",
                        )}
                      >
                        <RadioGroupItem value={value} />
                        {label}
                      </Label>
                    ))}
                  </RadioGroup>
                </fieldset>

                <div>
                  <Label className="text-[13px] text-muted-foreground">
                    Area code
                  </Label>
                  {draftAreaCode ? (
                    <div className="mt-1 flex items-center justify-between rounded-lg border border-primary bg-primary/5 px-3 py-2">
                      <span className="text-sm font-medium tabular-nums">
                        {areaCodeHint(draftAreaCode, draftCountry)?.label ??
                          draftAreaCode}
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setDraftAreaCode(null);
                          setQuery("");
                        }}
                      >
                        Change
                      </Button>
                    </div>
                  ) : (
                    <div className="mt-1 space-y-2">
                      <Input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder={
                          draftCountry === "US"
                            ? "Denver or 720"
                            : "Toronto or 416"
                        }
                        className="h-9"
                        aria-label="Search area codes"
                        autoComplete="off"
                        inputMode="search"
                        autoFocus
                      />
                      {query.trim() !== "" && results.length > 0 ? (
                        <ul className="max-h-44 divide-y divide-border overflow-auto rounded-lg border border-border bg-card">
                          {results.map((hint) => (
                            <li key={hint.code}>
                              <button
                                type="button"
                                onClick={() => setDraftAreaCode(hint.code)}
                                className="flex w-full items-center justify-between px-3 py-2 text-left text-sm transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                              >
                                <span className="tabular-nums">
                                  {hint.label}
                                </span>
                                <span className="text-[13px] text-muted-foreground">
                                  {hint.region}
                                </span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : query.trim() !== "" ? (
                        <p className="text-[13px] text-muted-foreground">
                          No {draftCountry === "US" ? "US" : "Canadian"} area
                          codes match that.
                        </p>
                      ) : null}
                    </div>
                  )}
                </div>

                {draftCountry === "CA" ? (
                  <label className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={draftUsTexting}
                      onChange={(e) => setDraftUsTexting(e.target.checked)}
                    />
                    <span>
                      Also text customers with US numbers
                      <span className="mt-0.5 block text-[13px] text-muted-foreground">
                        US texting needs a one-time $29 carrier registration.
                      </span>
                    </span>
                  </label>
                ) : null}

                <Button
                  className="w-full"
                  onClick={() => void saveNumber()}
                  disabled={update.isPending || !draftAreaCode}
                >
                  {update.isPending ? "Saving…" : "Save number"}
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
      </dl>

      {error ? (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
