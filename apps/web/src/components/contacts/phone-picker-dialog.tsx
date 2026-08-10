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
import { useT } from "@/i18n/provider";
import { useImportContacts } from "@/lib/api/contacts";
import { ApiError } from "@/lib/api/error";
import type { ImportResult } from "@/lib/api/types";
import {
  getContactsManager,
  mapPickedContacts,
  pickedContactsToCsv,
  PICKER_PROPERTIES,
} from "@/lib/contacts/contacts-picker";

import { ImportConsentCheck } from "./import-consent-check";
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
  const t = useT();
  const importContacts = useImportContacts();
  const [pickError, setPickError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [picking, setPicking] = useState(false);
  // Asked before the picker opens, and it has to be: the browser only allows
  // `select()` inside the tap gesture, so there is no moment between choosing
  // the contacts and importing them in which to ask. Being in someone's phone
  // is not consent to be texted by their business, which is exactly why this
  // door needs the question as much as the file ones do.
  const [consentAttested, setConsentAttested] = useState(false);

  function reset() {
    setPickError(null);
    setResult(null);
    setPicking(false);
    setConsentAttested(false);
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
      setPickError(t("contacts.pickerUnavailable"));
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
      setPickError(t("contacts.pickerNoNumbers"));
      return;
    }

    // #248 round 3: the declaration comes back WITH the file, from the function
    // that wrote the header — this door has no file to show anybody and no
    // header a person chose, so the only honest declaration is the one written
    // by whatever decided the columns.
    const { csv, columns } = pickedContactsToCsv(rows);
    const file = new File([csv], "phone-contacts.csv", { type: "text/csv" });
    importContacts.mutate(
      { file, consentAttested, columns },
      {
        onSuccess: (summary) => setResult(summary),
        onError: (cause) =>
          setPickError(
            cause instanceof ApiError
              ? cause.message
              : t("contacts.importFailed"),
          ),
      },
    );
  }

  const busy = picking || importContacts.isPending;

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[85svh] overflow-y-auto sm:max-w-lg">
        {result ? (
          <>
            <ImportSummaryView
              result={result}
              errorsHeading={t("contacts.pickerErrorsHeading")}
              renderError={(error) => error.reason}
            />
            <DialogFooter>
              <Button variant="outline" onClick={reset}>
                {t("contacts.pickMore")}
              </Button>
              <Button onClick={() => close(false)}>{t("contacts.done")}</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{t("contacts.pickerTitle")}</DialogTitle>
              <DialogDescription>
                {/* "Nothing is texted" used to close this paragraph; the
                    attestation below now says it, louder and next to the
                    button it qualifies, and saying it twice on one screen
                    makes both copies easier to skip. */}
                {t("contacts.pickerBlurb")}
              </DialogDescription>
            </DialogHeader>
            <ImportConsentCheck
              source="picked"
              checked={consentAttested}
              disabled={busy}
              onCheckedChange={setConsentAttested}
            />
            <div className="flex flex-col items-center gap-4 py-4">
              <Smartphone
                className="size-8 text-muted-foreground"
                strokeWidth={1.5}
                aria-hidden
              />
              <Button
                onClick={() => void pick()}
                disabled={busy || !consentAttested}
              >
                {t(
                  picking
                    ? "contacts.pickerOpening"
                    : importContacts.isPending
                      ? "contacts.importing"
                      : "contacts.chooseContacts",
                )}
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
