"use client";

import { Upload } from "lucide-react";
import { useState } from "react";

import { ContactsTable } from "@/components/contacts/contacts-table";
import { ImportWizard } from "@/components/contacts/import-wizard";
import { Button } from "@/components/ui/button";
import { useActiveCompany } from "@/lib/company/provider";

/** /contacts (G6): searchable table + the CSV import wizard (owner/admin). */
export default function ContactsPage() {
  const { role } = useActiveCompany();
  const [importing, setImporting] = useState(false);
  const canImport = role === "owner" || role === "admin";

  const importButton = canImport ? (
    <Button variant="outline" onClick={() => setImporting(true)}>
      <Upload strokeWidth={1.75} aria-hidden />
      Import CSV
    </Button>
  ) : null;

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4 px-4 py-6 md:px-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-semibold tracking-tight">Contacts</h1>
        {importButton}
      </div>
      <ContactsTable emptyAction={importButton} />
      {canImport && (
        <ImportWizard open={importing} onOpenChange={setImporting} />
      )}
    </div>
  );
}
