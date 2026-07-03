"use client";

import {
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ImportResult } from "@/lib/api/types";
import { summarizeImport } from "@/lib/contacts/import-summary";

/**
 * Shared "Import finished" summary body for the vCard and phone-picker dialogs
 * (D20 §3.2/§3.3). Renders the API's authoritative
 * { imported, updated, skipped, errors } identically for both surfaces — the
 * only difference is how each skipped row is labeled (a vCard reports "Card N",
 * the picker just states the reason), passed as `renderError`.
 */
export function ImportSummaryView({
  result,
  errorsHeading,
  renderError,
}: {
  result: ImportResult;
  /** The one-line intro above the skipped-row list. */
  errorsHeading: string;
  /** How to render a single skipped row (source-specific labeling). */
  renderError: (error: { row: number; reason: string }) => React.ReactNode;
}) {
  const summary = summarizeImport(result);
  return (
    <>
      <DialogHeader>
        <DialogTitle>Import finished</DialogTitle>
        <DialogDescription>{summary.headline}</DialogDescription>
      </DialogHeader>
      {summary.hasErrors && (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">{errorsHeading}</p>
          <ul className="max-h-56 space-y-1 overflow-y-auto rounded-md border bg-muted/30 p-3 text-xs">
            {summary.visibleErrors.map((error) => (
              <li key={`${error.row}-${error.reason}`}>{renderError(error)}</li>
            ))}
            {summary.hiddenErrorCount > 0 && (
              <li className="text-muted-foreground">
                …and {summary.hiddenErrorCount.toLocaleString()} more.
              </li>
            )}
          </ul>
        </div>
      )}
    </>
  );
}
