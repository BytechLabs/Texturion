"use client";

import { FileUp } from "lucide-react";
import Papa from "papaparse";
import { useMemo, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useImportContacts } from "@/lib/api/contacts";
import { ApiError } from "@/lib/api/error";
import {
  autoDetectMapping,
  buildImportCsv,
  buildPreview,
  IMPORT_FIELDS,
  IMPORT_MAX_BYTES,
  IMPORT_MAX_ROWS,
  skippedRowsCsv,
  summarizePreview,
  type ImportField,
  type ImportMapping,
} from "@/lib/contacts/csv-import";
import type { ImportResult } from "@/lib/api/types";

import { decideWizardDismissal } from "./import-wizard-dismissal";

const FIELD_LABELS: Record<ImportField, string> = {
  phone: "Phone (required)",
  name: "Name",
  address: "Address",
  notes: "Notes",
  opted_out: "Opted out",
};

const PREVIEW_ROW_LIMIT = 50;

type Step = "upload" | "map" | "preview" | "done";

function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

/**
 * The G6 CSV import wizard: upload → column mapping (auto-detected) →
 * client-side dry-run preview → POST /v1/contacts/import → summary with a
 * downloadable skipped-rows CSV. All rows are sent; the API's response is
 * the authoritative summary.
 */
export function ImportWizard({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const importContacts = useImportContacts();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [step, setStep] = useState<Step>("upload");
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [dataRows, setDataRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<ImportMapping>({});
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  const preview = useMemo(
    () => (step === "preview" ? buildPreview(dataRows, mapping) : []),
    [step, dataRows, mapping],
  );
  const summary = useMemo(() => summarizePreview(preview), [preview]);

  function reset() {
    setStep("upload");
    setFileName("");
    setHeaders([]);
    setDataRows([]);
    setMapping({});
    setUploadError(null);
    setImportError(null);
    setResult(null);
  }

  // While the import request is in flight, dismissal is swallowed (issue
  // #57): closing would wipe dataRows/mapping and the finished import's
  // skipped-rows report could never be rebuilt. The dialog stays open until
  // the request settles and the summary is shown.
  function close(next: boolean) {
    const decision = decideWizardDismissal(next, importContacts.isPending);
    if (!decision.propagate) return;
    if (decision.reset) reset();
    onOpenChange(next);
  }

  function handleFile(file: File) {
    setUploadError(null);
    if (file.size > IMPORT_MAX_BYTES) {
      setUploadError("That file is over 2 MB. Split it and import in parts.");
      return;
    }
    Papa.parse<string[]>(file, {
      skipEmptyLines: "greedy",
      complete: (parsed) => {
        const rows = parsed.data.filter((row) => row.length > 0);
        if (rows.length < 2) {
          setUploadError(
            "That file needs a header row and at least one contact row.",
          );
          return;
        }
        if (rows.length - 1 > IMPORT_MAX_ROWS) {
          setUploadError(
            `That's over ${IMPORT_MAX_ROWS.toLocaleString()} rows. Split the file and import in parts.`,
          );
          return;
        }
        setFileName(file.name);
        setHeaders(rows[0]);
        setDataRows(rows.slice(1));
        setMapping(autoDetectMapping(rows[0]));
        setStep("map");
      },
      error: () => {
        setUploadError("Couldn't read that file. Save it as a CSV and retry.");
      },
    });
  }

  function runImport() {
    setImportError(null);
    const csv = buildImportCsv(dataRows, mapping);
    const file = new File([csv], "contacts.csv", { type: "text/csv" });
    importContacts.mutate(file, {
      onSuccess: (summaryResult) => {
        setResult(summaryResult);
        setStep("done");
      },
      onError: (cause) =>
        setImportError(
          cause instanceof ApiError
            ? cause.message
            : "The import didn't go through. Try again.",
        ),
    });
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent
        className="max-h-[85svh] overflow-y-auto sm:max-w-2xl"
        showCloseButton={!importContacts.isPending}
        onInteractOutside={(event) => {
          if (importContacts.isPending) event.preventDefault();
        }}
        onEscapeKeyDown={(event) => {
          if (importContacts.isPending) event.preventDefault();
        }}
      >
        {step === "upload" && (
          <>
            <DialogHeader>
              <DialogTitle>Import contacts</DialogTitle>
              <DialogDescription>
                Upload a CSV with a header row. You&apos;ll match the columns
                and see exactly what happens before anything is imported.
              </DialogDescription>
            </DialogHeader>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex min-h-32 w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-8 text-sm text-muted-foreground transition-colors duration-150 ease-out hover:border-primary/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <FileUp className="size-6" strokeWidth={1.75} aria-hidden />
              Choose a CSV file
              <span className="text-xs">
                Up to {IMPORT_MAX_ROWS.toLocaleString()} rows / 2 MB
              </span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              aria-label="CSV file"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) handleFile(file);
                event.target.value = "";
              }}
            />
            {uploadError && (
              <p role="alert" className="text-sm text-destructive">
                {uploadError}
              </p>
            )}
          </>
        )}

        {step === "map" && (
          <>
            <DialogHeader>
              <DialogTitle>Match your columns</DialogTitle>
              <DialogDescription>
                {fileName} · {dataRows.length.toLocaleString()} rows. We took a
                guess; fix anything that&apos;s off.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              {IMPORT_FIELDS.map((field) => (
                <div
                  key={field}
                  className="flex items-center justify-between gap-4"
                >
                  <Label
                    htmlFor={`map-${field}`}
                    className="text-sm font-normal"
                  >
                    {FIELD_LABELS[field]}
                  </Label>
                  <Select
                    value={
                      mapping[field] === undefined
                        ? "none"
                        : String(mapping[field])
                    }
                    onValueChange={(value) =>
                      setMapping((current) => {
                        const next = { ...current };
                        if (value === "none") {
                          delete next[field];
                        } else {
                          const index = Number(value);
                          // A column feeds at most one field.
                          for (const key of IMPORT_FIELDS) {
                            if (key !== field && next[key] === index) {
                              delete next[key];
                            }
                          }
                          next[field] = index;
                        }
                        return next;
                      })
                    }
                  >
                    <SelectTrigger id={`map-${field}`} className="w-48">
                      <SelectValue placeholder="Not in my file" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Not in my file</SelectItem>
                      {headers.map((header, index) => (
                        <SelectItem key={index} value={String(index)}>
                          {header.trim() === "" ? `Column ${index + 1}` : header}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
            <p className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
              About &quot;Opted out&quot;: rows with true, yes, y, or 1 in that
              column are blocked from texting the moment they&apos;re imported.
              Use it for customers who already asked not to be texted.
              Anything else leaves texting on.
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={reset}>
                Back
              </Button>
              <Button
                disabled={mapping.phone === undefined}
                onClick={() => setStep("preview")}
              >
                Preview import
              </Button>
            </DialogFooter>
            {mapping.phone === undefined && (
              <p className="text-xs text-muted-foreground">
                Pick the phone column to continue. It&apos;s the one field
                every contact needs.
              </p>
            )}
          </>
        )}

        {step === "preview" && (
          <>
            <DialogHeader>
              <DialogTitle>Check before importing</DialogTitle>
              <DialogDescription>
                {summary.ready.toLocaleString()} will import
                {summary.optedOut > 0 &&
                  ` (${summary.optedOut.toLocaleString()} marked opted out)`}
                {summary.skipped > 0 &&
                  ` · ${summary.skipped.toLocaleString()} will be skipped`}
                . Existing contacts with the same number are updated, not
                duplicated.
              </DialogDescription>
            </DialogHeader>
            <div className="max-h-72 overflow-y-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Phone</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Result</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.slice(0, PREVIEW_ROW_LIMIT).map((row) => (
                    <TableRow key={row.rowNumber}>
                      <TableCell className="tabular-nums">
                        {row.values.phone || "–"}
                      </TableCell>
                      <TableCell>{row.values.name || "–"}</TableCell>
                      <TableCell>
                        {row.status === "ready" ? (
                          row.optedOut ? (
                            <Badge className="border-transparent bg-warning/10 text-amber-800 dark:bg-warning/15 dark:text-warning">
                              Imports, opted out
                            </Badge>
                          ) : (
                            <Badge className="border-transparent bg-success/10 text-success">
                              Imports
                            </Badge>
                          )
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            Skipped: {row.reason}
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {preview.length > PREVIEW_ROW_LIMIT && (
                <p className="border-t px-3 py-2 text-xs text-muted-foreground">
                  Showing the first {PREVIEW_ROW_LIMIT} of{" "}
                  {preview.length.toLocaleString()} rows.
                </p>
              )}
            </div>
            {importError && (
              <p role="alert" className="text-sm text-destructive">
                {importError}
              </p>
            )}
            <DialogFooter>
              <Button
                variant="outline"
                disabled={importContacts.isPending}
                onClick={() => setStep("map")}
              >
                Back
              </Button>
              <Button
                disabled={summary.ready === 0 || importContacts.isPending}
                onClick={runImport}
              >
                {importContacts.isPending
                  ? "Importing…"
                  : `Import ${summary.ready.toLocaleString()} contacts`}
              </Button>
            </DialogFooter>
            {importContacts.isPending && (
              <p role="status" className="text-xs text-muted-foreground">
                Importing your contacts. This window stays open until it
                finishes so the summary and skipped rows aren&apos;t lost.
              </p>
            )}
          </>
        )}

        {step === "done" && result && (
          <>
            <DialogHeader>
              <DialogTitle>Import finished</DialogTitle>
              <DialogDescription>
                {result.imported.toLocaleString()} new,{" "}
                {result.updated.toLocaleString()} updated,{" "}
                {result.skipped.toLocaleString()} skipped.
              </DialogDescription>
            </DialogHeader>
            {result.errors.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  Skipped rows kept their reasons. Download them, fix the
                  numbers, and import just that file again.
                </p>
                <Button
                  variant="outline"
                  onClick={() =>
                    downloadCsv(
                      "skipped-rows.csv",
                      skippedRowsCsv(
                        result.errors,
                        buildPreview(dataRows, mapping),
                      ),
                    )
                  }
                >
                  Download skipped rows
                </Button>
              </div>
            )}
            <DialogFooter>
              <Button onClick={() => close(false)}>Done</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
