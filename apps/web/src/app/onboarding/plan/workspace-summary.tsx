"use client";

import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api/error";
import { useOnboardingUpdateCompany } from "@/lib/api/onboarding";

import { areaCodeHint, searchAreaCodes } from "../area-codes";

/**
 * "Edit until checkout" (plan step): a compact, editable summary of the two
 * fields that lock once the number is provisioned — the workspace name and the
 * pending number's area code. Both save via PATCH /v1/company (the area code is
 * validated against the company's country and gated to pre-checkout on the
 * server). Rendered only on the pre-payment plan step, so editing is always
 * safe here. Area-code editing is hidden for a port-in (the ported number sets
 * its own area code).
 */
export function WorkspaceSummary({
  companyId,
  name,
  country,
  areaCode,
  canEditAreaCode,
}: {
  companyId: string;
  name: string;
  country: "US" | "CA";
  areaCode: string | null;
  canEditAreaCode: boolean;
}) {
  const update = useOnboardingUpdateCompany();
  const [editing, setEditing] = useState<null | "name" | "area">(null);
  const [nameDraft, setNameDraft] = useState(name);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  const areaHint = areaCode ? areaCodeHint(areaCode, country) : null;
  const results = useMemo(
    () => (editing === "area" ? searchAreaCodes(query, country) : []),
    [editing, query, country],
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

  async function saveAreaCode(code: string) {
    setError(null);
    try {
      await update.mutateAsync({ companyId, requested_area_code: code });
      setEditing(null);
      setQuery("");
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

        {/* Number area code (hidden for a port-in) */}
        {canEditAreaCode ? (
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <dt className="text-[13px] text-muted-foreground">
                Number area code
              </dt>
              {editing === "area" ? (
                <div className="mt-1 space-y-2">
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={
                      country === "US" ? "Denver or 720" : "Toronto or 416"
                    }
                    className="h-9"
                    aria-label="Search area codes"
                    autoComplete="off"
                    inputMode="search"
                    autoFocus
                  />
                  {query.trim() !== "" && results.length > 0 ? (
                    <ul className="max-h-48 divide-y divide-border overflow-auto rounded-lg border border-border bg-card">
                      {results.map((hint) => (
                        <li key={hint.code}>
                          <button
                            type="button"
                            onClick={() => void saveAreaCode(hint.code)}
                            disabled={update.isPending}
                            className="flex w-full items-center justify-between px-3 py-2 text-left text-sm transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none disabled:opacity-60"
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
                      No {country === "US" ? "US" : "Canadian"} area codes match
                      that.
                    </p>
                  ) : null}
                </div>
              ) : (
                <dd className="mt-0.5 text-sm font-medium tabular-nums">
                  {areaHint ? areaHint.label : (areaCode ?? "—")}
                </dd>
              )}
            </div>
            {editing !== "area" ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setQuery("");
                  setEditing("area");
                  setError(null);
                }}
              >
                Change
              </Button>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setEditing(null);
                  setQuery("");
                  setError(null);
                }}
                disabled={update.isPending}
              >
                Cancel
              </Button>
            )}
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
