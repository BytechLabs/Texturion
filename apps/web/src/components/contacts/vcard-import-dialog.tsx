"use client";

import { FileUp } from "lucide-react";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useImportVCard, VCARD_MAX_BYTES } from "@/lib/api/contacts-vcard";
import { ApiError } from "@/lib/api/error";
import type { ImportResult } from "@/lib/api/types";

import { ImportSummaryView } from "./import-summary-view";

/**
 * vCard (.vcf) import dialog (D20 §3.2). A single picker → POST
 * /v1/contacts/import-vcard → the shared { imported, updated, skipped, errors }
 * summary. The server is the authoritative parser (vCard 3.0 + 4.0, E.164
 * normalization, dedupe), so this UI stays thin: pick a file, show what
 * happened. Owner/admin only — the parent gates rendering on role.
 */
export function VCardImportDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const importVCard = useImportVCard();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [fileName, setFileName] = useState("");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  function reset() {
    setFileName("");
    setUploadError(null);
    setResult(null);
    importVCard.reset();
  }

  function close(next: boolean) {
    if (!next) reset();
    onOpenChange(next);
  }

  function handleFile(file: File) {
    setUploadError(null);
    setResult(null);
    if (file.size > VCARD_MAX_BYTES) {
      setUploadError("That file is over 5 MB. Export a smaller batch and retry.");
      return;
    }
    setFileName(file.name);
    importVCard.mutate(file, {
      onSuccess: (summary) => setResult(summary),
      onError: (cause) =>
        setUploadError(
          cause instanceof ApiError
            ? cause.message
            : "The import didn't go through. Try again.",
        ),
    });
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[85svh] overflow-y-auto sm:max-w-lg">
        {result ? (
          <>
            <ImportSummaryView
              result={result}
              errorsHeading="These rows couldn't be imported:"
              renderError={(error) => (
                <>
                  <span className="tabular-nums text-muted-foreground">
                    Card {error.row}:
                  </span>{" "}
                  {error.reason}
                </>
              )}
            />
            <DialogFooter>
              <Button variant="outline" onClick={reset}>
                Import another
              </Button>
              <Button onClick={() => close(false)}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Import from a vCard</DialogTitle>
              <DialogDescription>
                Upload a .vcf file exported from your phone, Google Contacts, or
                Apple Contacts. We&apos;ll add each contact with a valid US or
                Canada number. Existing numbers are updated, not duplicated.
              </DialogDescription>
            </DialogHeader>
            <button
              type="button"
              disabled={importVCard.isPending}
              onClick={() => fileInputRef.current?.click()}
              className="flex min-h-32 w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-8 text-sm text-muted-foreground transition-colors duration-150 ease-out hover:border-primary/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-60"
            >
              <FileUp className="size-6" strokeWidth={1.75} aria-hidden />
              {importVCard.isPending
                ? `Importing ${fileName}…`
                : "Choose a .vcf file"}
              <span className="text-xs">Up to 5 MB</span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".vcf,text/vcard,text/x-vcard"
              className="sr-only"
              aria-label="vCard file"
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
      </DialogContent>
    </Dialog>
  );
}
