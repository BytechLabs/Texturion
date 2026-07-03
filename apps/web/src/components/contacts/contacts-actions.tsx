"use client";

import { ChevronDown, Download, FileText, Smartphone, Upload } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useExportContacts } from "@/lib/api/contacts-export-hook";
import { ApiError } from "@/lib/api/error";
import { contactsPickerSupported } from "@/lib/contacts/contacts-picker";

import { ImportWizard } from "./import-wizard";
import { PhonePickerDialog } from "./phone-picker-dialog";
import { VCardImportDialog } from "./vcard-import-dialog";

/** Which import dialog is open (only one at a time). */
export type ImportSource = "csv" | "vcard" | "phone" | null;

/**
 * Contacts toolbar actions (D20). Two regions:
 *   • Export — any member (read-only visibility) → GET /v1/contacts/export,
 *     honoring the current search `q` ("export what I'm looking at").
 *   • Import — owner/admin only → one menu (CSV · vCard · Pick from phone). The
 *     phone item is a progressive enhancement: it appears only where the Web
 *     Contacts Picker is supported (Chrome for Android), never as a fake button.
 *
 * The open import dialog is controlled by the page so the empty-state "Import
 * CSV" button can open the same CSV wizard. The primary petrol element in this
 * region stays the Import button (the one obvious action, §5); Export is a
 * quiet outline beside it.
 */
export function ContactsActions({
  canImport,
  /** The live search query, so export mirrors what the user is looking at. */
  query,
  importSource,
  onImportSourceChange,
}: {
  canImport: boolean;
  query: string;
  importSource: ImportSource;
  onImportSourceChange: (source: ImportSource) => void;
}) {
  const exportContacts = useExportContacts();
  const [exportError, setExportError] = useState<string | null>(null);
  const setImportSource = onImportSourceChange;

  // Feature-detect the Web Contacts Picker on the client only — server render
  // has no `navigator`, and detecting after mount avoids a hydration mismatch
  // (the phone item is simply absent until the effect runs).
  const [pickerSupported, setPickerSupported] = useState(false);
  useEffect(() => {
    setPickerSupported(contactsPickerSupported());
  }, []);

  function runExport() {
    setExportError(null);
    exportContacts.mutate(query, {
      onError: (cause) =>
        setExportError(
          cause instanceof ApiError
            ? cause.message
            : "The export didn't go through. Try again.",
        ),
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          onClick={runExport}
          disabled={exportContacts.isPending}
        >
          <Download strokeWidth={1.75} aria-hidden />
          {exportContacts.isPending ? "Exporting…" : "Export"}
        </Button>

        {canImport && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button>
                <Upload strokeWidth={1.75} aria-hidden />
                Import
                <ChevronDown strokeWidth={1.75} aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem onSelect={() => setImportSource("csv")}>
                <FileText strokeWidth={1.75} aria-hidden />
                CSV file
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setImportSource("vcard")}>
                <FileText strokeWidth={1.75} aria-hidden />
                vCard file (.vcf)
              </DropdownMenuItem>
              {pickerSupported && (
                <DropdownMenuItem onSelect={() => setImportSource("phone")}>
                  <Smartphone strokeWidth={1.75} aria-hidden />
                  Pick from phone
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {exportError && (
        <p role="alert" className="text-sm text-destructive">
          {exportError}
        </p>
      )}

      {canImport && (
        <>
          <ImportWizard
            open={importSource === "csv"}
            onOpenChange={(open) => setImportSource(open ? "csv" : null)}
          />
          <VCardImportDialog
            open={importSource === "vcard"}
            onOpenChange={(open) => setImportSource(open ? "vcard" : null)}
          />
          {pickerSupported && (
            <PhonePickerDialog
              open={importSource === "phone"}
              onOpenChange={(open) => setImportSource(open ? "phone" : null)}
            />
          )}
        </>
      )}
    </div>
  );
}
