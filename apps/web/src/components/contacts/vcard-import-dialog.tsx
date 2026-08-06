"use client";

import { FileUp, ScanSearch } from "lucide-react";
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
import { NativeSelect } from "@/components/ui/native-select";
import { useImportVCard } from "@/lib/api/contacts-vcard";
import { ApiError } from "@/lib/api/error";
import type { ImportResult } from "@/lib/api/types";
import {
  answerProperty,
  ignoreRemainingProperties,
  propertyDeclarations,
  readVCardProperties,
  type VCardProperty,
} from "@/lib/contacts/vcard-properties";
import {
  CONTACT_IMPORT_IGNORE,
  VCARD_IMPORT_MAX_BYTES,
  type VCardPropertyAction,
} from "@loonext/shared";

import { ImportConsentCheck } from "./import-consent-check";
import { ImportSummaryView } from "./import-summary-view";

/** The server's own ceiling, printed rather than a second copy of it. */
const MAX_SIZE_LABEL = `${VCARD_IMPORT_MAX_BYTES / (1024 * 1024)} MB`;

/** The two answers a vCard property can have. See the shared docblock for why. */
const PROPERTY_LABELS: Record<VCardPropertyAction, string> = {
  ignore: "Skip it",
  opted_out: "Never text these cards",
};

/** The empty option's value. Not a valid answer, so it cannot be posted. */
const UNANSWERED = "";

/**
 * vCard (.vcf) import dialog (D20 §3.2). Pick a file → answer for anything on
 * the cards we don't read → POST /v1/contacts/import-vcard → the shared
 * { imported, updated, skipped, errors } summary. The server is the
 * authoritative parser (vCard 3.0 + 4.0, E.164 normalization, dedupe), so the
 * cards themselves are not re-implemented here. Owner/admin only — the parent
 * gates rendering on role.
 *
 * #248 round 3 added the middle step, because this door had no gate of any
 * kind. `CATEGORIES:DNC` and a `NOTE` reading "DO NOT CONTACT - asked us to
 * stop" are the only two places the format lets a card say do-not-text, they
 * are what Apple and Google actually export, and both were dropped without a
 * word while the file's consent attestation was written over the top.
 *
 * READ HERE, NOT LEARNED FROM THE REFUSAL. The server names the properties it
 * is missing, so the shortest path to a 200 would be: post, read the names out
 * of the 422, post them back — two round trips and no human, which is what
 * round two actually shipped. This dialog has the file in its hands, so it
 * reads it, asks, and posts a complete declaration the first time.
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
  // Asked BEFORE the picker, unlike the CSV wizard, because a .vcf has no
  // preview of rows to ask over. Cleared by reset(), so "Import another" asks
  // again about the next file.
  const [consentAttested, setConsentAttested] = useState(false);
  // The chosen file, held while its properties are being answered for. The
  // bytes posted are the bytes chosen: the declaration describes the file the
  // server will parse, or it describes nothing.
  const [pending, setPending] = useState<{ file: File; cards: number } | null>(
    null,
  );
  const [properties, setProperties] = useState<VCardProperty[]>([]);

  function reset() {
    setFileName("");
    setUploadError(null);
    setResult(null);
    setConsentAttested(false);
    setPending(null);
    setProperties([]);
    importVCard.reset();
  }

  function close(next: boolean) {
    if (!next) reset();
    onOpenChange(next);
  }

  function send(file: File, declared: ReturnType<typeof propertyDeclarations>) {
    if (declared === null) return;
    importVCard.mutate(
      { file, consentAttested, properties: declared },
      {
        onSuccess: (summary) => setResult(summary),
        onError: (cause) =>
          setUploadError(
            cause instanceof ApiError
              ? cause.message
              : "The import didn't go through. Try again.",
          ),
      },
    );
  }

  async function handleFile(file: File) {
    setUploadError(null);
    setResult(null);
    if (file.size > VCARD_IMPORT_MAX_BYTES) {
      setUploadError(
        `That file is over ${MAX_SIZE_LABEL}. Export a smaller batch and retry.`,
      );
      return;
    }
    setFileName(file.name);
    const read = readVCardProperties(await file.text());
    setPending({ file, cards: read.cards });
    setProperties(read.properties);
    // A file carrying nothing we don't already read has nothing to ask about,
    // and a question with no content is the kind of gate people learn to click
    // through. The declaration is still complete: an empty list of unread
    // properties is completely answered.
    if (read.properties.length === 0) send(file, []);
  }

  const declarations = propertyDeclarations(properties);
  const unanswered = properties.filter((row) => row.answer === null);
  // Progressive disclosure: only a file that actually carries a parameter needs
  // the sentence explaining what `TEL;TYPE` is, and the rule is otherwise one
  // more piece of format trivia between somebody and their contacts. It is a
  // common file rather than a rare one, though, which is why it gets a sentence
  // instead of leaving the person to work out why we are asking about a
  // semicolon.
  const hasParameter = properties.some((row) => row.property.includes(";"));
  const reviewing =
    result === null && pending !== null && properties.length > 0;

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
        ) : reviewing && pending ? (
          <>
            <DialogHeader>
              <DialogTitle>What&apos;s on these cards?</DialogTitle>
              <DialogDescription>
                {fileName} · {pending.cards.toLocaleString()} cards.{" "}
                {properties.length === 1
                  ? "One thing on them isn't a name or a number."
                  : `${properties.length} things on them aren't names or numbers.`}{" "}
                A card can carry a note saying somebody asked you to stop, so we
                won&apos;t guess what these are.
              </DialogDescription>
            </DialogHeader>
            {hasParameter && (
              <p className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                A name with a semicolon in it, like TEL;TYPE, is a label written
                on a line rather than a line of its own. Phones write notes in
                those too, so they get the same question.
              </p>
            )}
            <ul className="space-y-2">
              {properties.map((row) => {
                const id = `vcard-property-${row.property}`;
                return (
                  <li
                    key={row.property}
                    className="rounded-md border bg-background/60 px-3 py-2.5"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                      <div className="min-w-0 flex-1 basis-48 space-y-1">
                        <p className="font-mono text-sm leading-snug font-medium">
                          {row.property}
                        </p>
                        <p className="text-xs leading-snug text-muted-foreground">
                          {/* The values, loudest thing in the row after the
                              name. A person who cannot see "DNC" cannot skip
                              it knowingly, and then the click is theatre. */}
                          {row.samples.length === 0 ? (
                            `On ${row.cards.toLocaleString()} cards, with nothing in it.`
                          ) : (
                            <>
                              On {row.cards.toLocaleString()} of{" "}
                              {pending.cards.toLocaleString()} cards. Says{" "}
                              <span className="font-medium break-words text-foreground">
                                {row.samples
                                  .map((value) => `“${value}”`)
                                  .join(", ")}
                              </span>
                              {row.more && ", and more"}.
                            </>
                          )}
                        </p>
                      </div>
                      <div className="w-full sm:w-52">
                        <NativeSelect
                          id={id}
                          aria-label={`What is ${row.property}?`}
                          value={row.answer ?? UNANSWERED}
                          onChange={(event) =>
                            setProperties((current) =>
                              answerProperty(
                                current,
                                row.property,
                                event.target.value === UNANSWERED
                                  ? null
                                  : (event.target
                                      .value as VCardPropertyAction),
                              ),
                            )
                          }
                        >
                          {row.answer === null && (
                            <option value={UNANSWERED}>
                              Choose what this is
                            </option>
                          )}
                          <option value={CONTACT_IMPORT_IGNORE}>
                            {PROPERTY_LABELS.ignore}
                          </option>
                          <option value="opted_out">
                            {PROPERTY_LABELS.opted_out}
                          </option>
                        </NativeSelect>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
            {unanswered.length > 0 && (
              <div className="flex items-start gap-3 rounded-lg border border-warning/40 bg-warning/5 px-4 py-3">
                <ScanSearch
                  className="mt-0.5 size-5 shrink-0 text-warning"
                  strokeWidth={1.75}
                  aria-hidden
                />
                <div className="min-w-0 flex-1 space-y-2">
                  <p className="text-sm leading-snug text-muted-foreground">
                    {unanswered.length === 1
                      ? "One of these still needs an answer."
                      : `${unanswered.length} of these still need an answer.`}{" "}
                    Skipping something that says do not text means this import
                    texts somebody who asked you to stop.
                  </p>
                  {/* Under the list, as on the CSV wizard, and for the same
                      reason: this is only an informed click while every
                      property and its values are on screen. `ignore` only —
                      blocking every card in the file is a thing to do on
                      purpose, one property at a time. */}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setProperties((current) =>
                        ignoreRemainingProperties(current),
                      )
                    }
                  >
                    {unanswered.length === 1
                      ? "It doesn't say who can be texted"
                      : "None of these say who can be texted"}
                  </Button>
                </div>
              </div>
            )}
            {uploadError && (
              <p role="alert" className="text-sm text-destructive">
                {uploadError}
              </p>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={reset}>
                Back
              </Button>
              <Button
                disabled={declarations === null || importVCard.isPending}
                onClick={() => send(pending.file, declarations)}
              >
                {importVCard.isPending
                  ? "Importing…"
                  : `Import ${pending.cards.toLocaleString()} cards`}
              </Button>
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
            <ImportConsentCheck
              source="file"
              checked={consentAttested}
              disabled={importVCard.isPending}
              onCheckedChange={setConsentAttested}
            />
            {/* Disabled until attested. A file with nothing unread imports the
                moment it is chosen, so the question has to be answered before
                the picker opens or it cannot be answered at all. */}
            <button
              type="button"
              disabled={!consentAttested || importVCard.isPending}
              onClick={() => fileInputRef.current?.click()}
              className="flex min-h-32 w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-8 text-sm text-muted-foreground transition-colors duration-150 ease-out hover:border-primary/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-60"
            >
              <FileUp className="size-6" strokeWidth={1.75} aria-hidden />
              {importVCard.isPending
                ? `Importing ${fileName}…`
                : "Choose a .vcf file"}
              <span className="text-xs">Up to {MAX_SIZE_LABEL}</span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".vcf,text/vcard,text/x-vcard"
              className="sr-only"
              aria-label="vCard file"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void handleFile(file);
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
