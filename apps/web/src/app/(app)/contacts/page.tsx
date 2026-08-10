"use client";

import { Upload } from "lucide-react";
import { useCallback, useState } from "react";

import {
  ContactsActions,
  type ImportSource,
} from "@/components/contacts/contacts-actions";
import { ContactsTable } from "@/components/contacts/contacts-table";
import { Button } from "@/components/ui/button";
import { DuplicateContactsCard } from "@/components/contacts/duplicate-contacts-card";
import { useT } from "@/i18n/provider";
import { useActiveCompany } from "@/lib/company/provider";

/**
 * /contacts (G6): searchable table + the import/export toolbar (D20). Export is
 * any member (read-only); import (CSV · vCard · Pick from phone) is owner/admin.
 * The page owns the debounced search query so export mirrors the current view,
 * and the open import dialog so the empty state can open the CSV wizard too.
 */
export default function ContactsPage() {
  const t = useT();
  const { role } = useActiveCompany();
  const canImport = role === "owner" || role === "admin";
  const [query, setQuery] = useState("");
  const [importSource, setImportSource] = useState<ImportSource>(null);
  // Stable identity so the table's effect doesn't re-fire every render.
  const handleQueryChange = useCallback((next: string) => setQuery(next), []);

  // The empty-state action stays a single obvious "Import CSV" — the fuller
  // import menu lives in the toolbar (owner/admin only).
  const emptyImportButton = canImport ? (
    <Button onClick={() => setImportSource("csv")}>
      <Upload strokeWidth={1.75} aria-hidden />
      {t("appShell.contactsImportCsv")}
    </Button>
  ) : null;

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 px-4 py-8 md:px-6">
      <div className="flex items-start justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("appShell.contactsTitle")}
        </h1>
        <ContactsActions
          canImport={canImport}
          query={query}
          importSource={importSource}
          onImportSourceChange={setImportSource}
        />
      </div>
      {/* #246: above the table, and only when there is something to act on.
          Somebody who does not know they have duplicates will not navigate to
          a page about them — being shown is the whole mechanism. */}
      <DuplicateContactsCard canMerge={canImport} />
      <ContactsTable
        emptyAction={emptyImportButton}
        onQueryChange={handleQueryChange}
      />
    </div>
  );
}
