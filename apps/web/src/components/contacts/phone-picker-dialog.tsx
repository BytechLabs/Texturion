"use client";

import { Smartphone } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useImportContacts } from "@/lib/api/contacts";
import { ApiError } from "@/lib/api/error";
import type { ImportResult } from "@/lib/api/types";
import {
  getContactsManager,
  mapPickedContacts,
  pickedContactsToCsv,
  PICKER_PROPERTIES,
} from "@/lib/contacts/contacts-picker";

import { ImportSummaryView } from "./import-summary-view";

/**
 * "Import from phone" — the Web Contacts Picker progressive enhancement (D20
 * §3.3). The picker runs INSIDE the tap gesture (browser requirement), maps the
 * result → the canonical import CSV → POST /v1/contacts/import (the exact CSV
 * upsert path — no new server surface), then shows the shared summary. The
 * parent renders this only when `contactsPickerSupported()` is true, so there
 * is no fake button where the API is absent (§3.3).
 */
export function PhonePickerDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const importContacts = useImportContacts();
  const [pickError, setPickError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [picking, setPicking] = useState(false);

  function reset() {
    setPickError(null);
    setResult(null);
    setPicking(false);
    importContacts.reset();
  }

  function close(next: boolean) {
    if (!next) reset();
    onOpenChange(next);
  }

  async function pick() {
    setPickError(null);
    setResult(null);
    const manager = getContactsManager();
    if (!manager) {
      // Defensive: the parent gates on support, but never trust that alone.
      setPickError("Picking from your phone isn't available on this device.");
      return;
    }
    setPicking(true);
    let picked;
    try {
      // MUST run in the tap gesture, secure top-level context (§3.3).
      picked = await manager.select([...PICKER_PROPERTIES], { multiple: true });
    } catch {
      // The user dismissed the picker, or the browser blocked it.
      setPicking(false);
      return;
    }
    setPicking(false);

    const rows = mapPickedContacts(picked);
    if (rows.length === 0) {
      // Either nothing was chosen or the chosen contacts had no phone number.
      setPickError(
        "None of the contacts you picked had a phone number to import.",
      );
      return;
    }

    const csv = pickedContactsToCsv(rows);
    const file = new File([csv], "phone-contacts.csv", { type: "text/csv" });
    importContacts.mutate(file, {
      onSuccess: (summary) => setResult(summary),
      onError: (cause) =>
        setPickError(
          cause instanceof ApiError
            ? cause.message
            : "The import didn't go through. Try again.",
        ),
    });
  }

  const busy = picking || importContacts.isPending;

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[85svh] overflow-y-auto sm:max-w-lg">
        {result ? (
          <>
            <ImportSummaryView
              result={result}
              errorsHeading="These couldn't be imported (usually a number that isn't a US or Canada mobile):"
              renderError={(error) => error.reason}
            />
            <DialogFooter>
              <Button variant="outline" onClick={reset}>
                Pick more
              </Button>
              <Button onClick={() => close(false)}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Import from your phone</DialogTitle>
              <DialogDescription>
                Choose contacts from your device. We&apos;ll import the ones with
                a valid US or Canada number — existing numbers are updated, not
                duplicated. Nothing is texted.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col items-center gap-4 py-4">
              <Smartphone
                className="size-8 text-muted-foreground"
                strokeWidth={1.5}
                aria-hidden
              />
              <Button onClick={() => void pick()} disabled={busy}>
                {picking
                  ? "Opening your contacts…"
                  : importContacts.isPending
                    ? "Importing…"
                    : "Choose contacts"}
              </Button>
            </div>
            {pickError && (
              <p role="alert" className="text-sm text-destructive">
                {pickError}
              </p>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
