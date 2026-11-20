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

export function ImportDetailsReport({ result }: { result: ImportResult }) {
  const t = useT();
  const kept = result.kept ?? 0;
  const warnings = result.detail_warnings ?? [];
  const visibleWarnings = warnings.slice(0, 50);
  return (
    <>
      {kept > 0 && <p className="text-sm">{t("contacts.importKept", { count: kept.toLocaleString(t.locale) })}</p>}
      {warnings.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">{t("contacts.importDetailWarnings")}</p>
          <ul className="max-h-44 space-y-1 overflow-y-auto text-sm">
            {visibleWarnings.map(({ row, reason }) => (
              <li key={`${row}-${reason}`}>{row}. {reason}</li>
            ))}
            {warnings.length > visibleWarnings.length && (
              <li>{t("contacts.andMore", { count: (warnings.length - visibleWarnings.length).toLocaleString(t.locale) })}</li>
            )}
          </ul>
        </div>
      )}
    </>
  );
}

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
  const summary = summarizeImport(result, undefined, t.locale);
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
      <ImportDetailsReport result={result} />
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
                  count: summary.hiddenErrorCount.toLocaleString(t.locale),
                })}
              </li>
            )}
          </ul>
        </div>
      )}
    </>
  );
}
