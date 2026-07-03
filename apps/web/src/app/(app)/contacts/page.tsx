"use client";

import { Upload } from "lucide-react";
import { useCallback, useState } from "react";

import {
  ContactsActions,
  type ImportSource,
} from "@/components/contacts/contacts-actions";
import { ContactsTable } from "@/components/contacts/contacts-table";
import { Button } from "@/components/ui/button";
import { useActiveCompany } from "@/lib/company/provider";

/**
 * /contacts (G6): searchable table + the import/export toolbar (D20). Export is
 * any member (read-only); import (CSV · vCard · Pick from phone) is owner/admin.
 * The page owns the debounced search query so export mirrors the current view,
 * and the open import dialog so the empty state can open the CSV wizard too.
 */
export default function ContactsPage() {
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
      Import CSV
    </Button>
  ) : null;

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 px-4 py-8 md:px-6">
      <div className="flex items-start justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Contacts</h1>
        <ContactsActions
          canImport={canImport}
          query={query}
          importSource={importSource}
          onImportSourceChange={setImportSource}
        />
      </div>
      <ContactsTable
        emptyAction={emptyImportButton}
        onQueryChange={handleQueryChange}
      />
    </div>
  );
}
