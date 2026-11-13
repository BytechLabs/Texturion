"use client";

import { PageHeader } from "@/components/ui/page-header";
import { Upload } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useState } from "react";

import {
  ContactsActions,
  type ImportSource,
  NewContactAction,
} from "@/components/contacts/contacts-actions";
import {
  ContactsTable,
  contactsViewFromSearch,
} from "@/components/contacts/contacts-table";
import { Button } from "@/components/ui/button";
import { DuplicateContactsCard } from "@/components/contacts/duplicate-contacts-card";
import { useT } from "@/i18n/provider";
import { useActiveCompany } from "@/lib/company/provider";

/**
 * /contacts (G6): searchable table + the import/export toolbar (D20). Export is
 * any member (read-only); import (CSV · vCard · Pick from phone) is owner/admin.
 * The search and the tag live in the URL, so export mirrors the current view;
 * the page owns the open import dialog so the empty state can open the CSV
 * wizard too.
 */
export default function ContactsPage() {
  const t = useT();
  const { role } = useActiveCompany();
  const canImport = role === "owner" || role === "admin";
  const [importSource, setImportSource] = useState<ImportSource>(null);
  const { query, tagId } = contactsViewFromSearch(useSearchParams());

  // The empty-state action stays a single obvious "Import CSV" — the fuller
  // import menu lives in the toolbar (owner/admin only).
  const emptyImportButton = canImport ? (
    <Button variant="outline" onClick={() => setImportSource("csv")}>
      <Upload strokeWidth={1.75} aria-hidden />
      {t("appShell.contactsImportCsv")}
    </Button>
  ) : null;

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 px-4 py-8 md:px-6">
      <PageHeader
        title={t("appShell.contactsTitle")}
        secondary={
          <ContactsActions
            canImport={canImport}
            query={query}
            tagId={tagId}
            importSource={importSource}
            onImportSourceChange={setImportSource}
          />
        }
        primary={<NewContactAction />}
      />
      {/* #246: above the table, and only when there is something to act on.
          Somebody who does not know they have duplicates will not navigate to
          a page about them — being shown is the whole mechanism. */}
      <DuplicateContactsCard canMerge={canImport} />
      <ContactsTable emptyAction={emptyImportButton} />
    </div>
  );
}
