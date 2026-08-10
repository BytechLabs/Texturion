"use client";

import {
  ChevronDown,
  Download,
  FileText,
  Smartphone,
  Upload,
  UserPlus,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useT } from "@/i18n/provider";
import { useExportContacts } from "@/lib/api/contacts-export-hook";
import { ApiError } from "@/lib/api/error";
import { contactsPickerSupported } from "@/lib/contacts/contacts-picker";

import { ImportWizard } from "./import-wizard";
import { NewContactDialog } from "./new-contact-dialog";
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
  const t = useT();
  const router = useRouter();
  const searchParams = useSearchParams();
  // #459 ?new=<digits>: the dialer's "Add contact", which lands here rather
  // than opening a second create form inside the keypad. One create form for
  // the whole app means one set of validation rules to keep true.
  const newFromDialer = searchParams.get("new");
  const exportContacts = useExportContacts();
  const [exportError, setExportError] = useState<string | null>(null);
  const setImportSource = onImportSourceChange;

  // Feature-detect the Web Contacts Picker on the client only — server render
  // has no `navigator`, and detecting after mount avoids a hydration mismatch
  // (the phone item is simply absent until the effect runs).
  const [creating, setCreating] = useState(false);
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
            : t("contacts.exportFailed"),
        ),
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        {/* Writing down a number a customer gave you over the phone used to
            mean building a CSV for it. Any member can add one, matching both
            phone apps; import stays owner/admin. */}
        <Button variant="outline" onClick={() => setCreating(true)}>
          <UserPlus strokeWidth={1.75} aria-hidden />
          {t("contacts.newContact")}
        </Button>

        <Button
          variant="outline"
          onClick={runExport}
          disabled={exportContacts.isPending}
        >
          <Download strokeWidth={1.75} aria-hidden />
          {exportContacts.isPending
            ? t("contacts.exporting")
            : t("contacts.exportAction")}
        </Button>

        {canImport && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button>
                <Upload strokeWidth={1.75} aria-hidden />
                {t("contacts.importAction")}
                <ChevronDown strokeWidth={1.75} aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem onSelect={() => setImportSource("csv")}>
                <FileText strokeWidth={1.75} aria-hidden />
                {t("contacts.importCsv")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setImportSource("vcard")}>
                <FileText strokeWidth={1.75} aria-hidden />
                {t("contacts.importVcard")}
              </DropdownMenuItem>
              {pickerSupported && (
                <DropdownMenuItem onSelect={() => setImportSource("phone")}>
                  <Smartphone strokeWidth={1.75} aria-hidden />
                  {t("contacts.importFromPhone")}
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

      <NewContactDialog
        open={creating || newFromDialer !== null}
        onOpenChange={(next) => {
          setCreating(next);
          // #459: closing a dialer-opened dialog drops the query parameter, so
          // a later reload of /contacts does not reopen a form somebody
          // already dismissed.
          if (!next && newFromDialer !== null) router.replace("/contacts");
        }}
        prefillPhone={newFromDialer ?? ""}
      />

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
