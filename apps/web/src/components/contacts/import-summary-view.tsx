"use client";

import {
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useT } from "@/i18n/provider";
import type { ImportResult } from "@/lib/api/types";
import { summarizeImport } from "@/lib/contacts/import-summary";

import { ImportConsentRefused } from "./import-consent-refused";

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
  const t = useT();
  const summary = summarizeImport(result);
  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("contacts.importFinished")}</DialogTitle>
        <DialogDescription>{summary.headline}</DialogDescription>
      </DialogHeader>
      {/* Above the skipped rows on purpose. Skipped rows are a chore the person
          already half expects — bad numbers in a spreadsheet. This is the
          surprising item and the consequential one: people who are now in their
          list and must not be texted. The unexpected fact leads. */}
      <ImportConsentRefused result={result} />
      {summary.hasErrors && (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">{errorsHeading}</p>
          <ul className="max-h-56 space-y-1 overflow-y-auto rounded-md border bg-muted/30 p-3 text-xs">
            {summary.visibleErrors.map((error) => (
              <li key={`${error.row}-${error.reason}`}>{renderError(error)}</li>
            ))}
            {summary.hiddenErrorCount > 0 && (
              <li className="text-muted-foreground">
                {t("contacts.andMore", {
                  count: summary.hiddenErrorCount.toLocaleString(),
                })}
              </li>
            )}
          </ul>
        </div>
      )}
    </>
  );
}
