"use client";

import { FileUp, ScanSearch, ShieldAlert } from "lucide-react";
import { useMemo, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useT, type MessageKey, type Translate } from "@/i18n/provider";
import { useImportContacts } from "@/lib/api/contacts";
import { csvDownloadBlob } from "@/lib/api/contacts-export";
import { ApiError } from "@/lib/api/error";
import {
  answerColumn,
  answerRemaining,
  buildPreview,
  csvRows,
  decideColumns,
  importColumns,
  IMPORT_FIELDS,
  SAMPLE_VALUE_LIMIT,
  skippedRowsCsv,
  summarizePreview,
  type ColumnAnswer,
  type CsvRow,
  type ImportColumn,
  type ImportField,
} from "@/lib/contacts/csv-import";
import type { ImportResult } from "@/lib/api/types";
import {
  CONTACT_IMPORT_IGNORE,
  CONTACT_IMPORT_MAX_BYTES,
  CONTACT_IMPORT_MAX_ROWS,
  CONTACT_IMPORT_SHOW_FEWER_VALUES_KEY,
  contactImportHiddenValuesLabel,
  contactImportShowAllValuesLabel,
  contactImportValueCeilingNote,
  readContactFlag,
  FLAG_TRUE_SPELLINGS,
  FLAG_FALSE_SPELLINGS,
  unreadableFlagValues,
} from "@loonext/shared";

import { ImportConsentCheck } from "./import-consent-check";
import { ImportConsentRefused } from "./import-consent-refused";
import { decideWizardDismissal } from "./import-wizard-dismissal";

/**
 * What each answer is called on screen. Ordered as the select lists them:
 * every field this import can fill, and then the dismissal.
 *
 * The dismissal is LAST on purpose. It is the answer that drops a column, and
 * an answer at the top of a list is the answer people take — putting it there
 * would be this product nudging somebody toward the one choice that can end in
 * a text to a person who asked not to get one.
 */
const ANSWER_LABEL_KEYS: Record<ImportField | "ignore", MessageKey> = {
  phone: "contacts.answerPhone",
  name: "contacts.answerName",
  first_name: "contacts.answerFirstName",
  last_name: "contacts.answerLastName",
  address: "contacts.answerAddress",
  notes: "contacts.answerNotes",
  opted_out: "contacts.answerOptedOut",
  ignore: "contacts.answerIgnore",
};

/** The empty option's value. Not a valid answer, so it cannot be posted. */
const UNANSWERED = "";

const PREVIEW_ROW_LIMIT = 50;

/**
 * The bounds this screen promises, straight off the server's own constants.
 * The wizard used to carry its own `2000` and `2 MB` under a comment calling
 * them a mirror, which is how a client comes to accept a file the server then
 * refuses — and the person only finds out after the upload.
 */
const MAX_SIZE_LABEL = `${CONTACT_IMPORT_MAX_BYTES / (1024 * 1024)} MB`;

/**
 * The spellings this screen tells people to write in a do-not-text column —
 * proposed here, but printed only if the reader that will actually read them
 * agrees.
 *
 * Not a list typed out beside `readContactFlag`. The note under the mapping
 * step promised "true, yes, y, or 1" for months after the shared reader learned
 * `x` — the mark a hand-kept spreadsheet puts against the rows to block — so the
 * screen was under-promising a rule about who gets texted, and somebody editing
 * their file to satisfy it would have rewritten a column that already worked.
 * Filtering through the reader means the two cannot say different things: a
 * spelling it stops accepting stops being printed, in the same commit.
 */
/*
 * FILTERING THE LIST WAS NOT ENOUGH, and the comment above says why without
 * noticing: a filter can only narrow the list it is handed. It cannot add a
 * spelling the reader learned, which is the direction that had already gone
 * wrong twice — `t` and `f` are accepted by `readContactFlag` and were named
 * nowhere on this screen.
 *
 * So the reader now hands over its own spellings rather than vetting ours.
 */

/**
 * How a column is named back to the person. A header the file left blank has no
 * name to quote, so it gets its position — which is also how the API names it
 * in a refusal, so the two screens cannot describe the same column differently.
 */
function columnLabel(
  column: { header: string; index: number },
  t: Translate,
): string {
  return column.header === ""
    ? t("contacts.columnNoHeader", { number: column.index + 1 })
    : t("contacts.columnQuoted", { header: column.header });
}

type Step = "upload" | "map" | "preview" | "done";

function downloadCsv(filename: string, csv: string) {
  // #587: through `csvDownloadBlob` for the byte-order mark. These are the rows
  // somebody is about to open, fix and re-upload — mojibake in the file whose
  // purpose is repair is the worst place for it.
  const blob = csvDownloadBlob(csv);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

/**
 * One column, its own values, and the question about it.
 *
 * THE VALUES ARE THE POINT, not decoration beside the control. The whole of
 * #248 round 3 rests on somebody seeing "DO NOT CALL" before dismissing the
 * column that holds it: a person who cannot see what a column says cannot
 * dismiss it knowingly, and then the click is theatre and the gate is a
 * formality. So they are rendered in `text-foreground` beside a muted lead-in
 * — the sample is the loudest thing in the row after the column's own name.
 *
 * AND THE ONES IT DOES NOT PRINT ARE REACHABLE. The row used to end at
 * ", and more", which is this defect at one remove: a person who cannot see the
 * fourth value cannot knowingly dismiss it either, and the row was the last
 * place that admitted the fourth value existed. Now the remainder is counted and
 * the count is the control that shows it — bounded by default because thirty
 * columns of full value lists is a screen nobody reads, complete on request
 * because that is the reading the whole flow claims happened.
 */
function ColumnRow({
  column,
  onAnswer,
}: {
  column: ImportColumn;
  onAnswer: (answer: ColumnAnswer) => void;
}) {
  const t = useT();
  const id = `column-${column.index}`;
  const [showAll, setShowAll] = useState(false);
  const hidden = column.total - column.samples.length;
  const listed = showAll ? column.values : column.samples;
  const cut = showAll && column.total > column.values.length;
  return (
    <li className="rounded-md border bg-background/60 px-3 py-2.5">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1 basis-48 space-y-1">
          <p className="text-sm leading-snug font-medium">
            {columnLabel(column, t)}
          </p>
          <p className="text-xs leading-snug text-muted-foreground">
            {column.total === 0 ? (
              t("contacts.columnAllBlank")
            ) : (
              <>
                {t("contacts.columnSays")}{" "}
                <span className="font-medium break-words text-foreground">
                  {listed
                    .map((value) =>
                      t("contacts.columnQuoted", { header: value }),
                    )
                    .join(", ")}
                </span>
                {!showAll && hidden > 0 && (
                  <>
                    ,{" "}
                    <button
                      type="button"
                      aria-expanded={false}
                      aria-label={contactImportShowAllValuesLabel(column.total, t)}
                      onClick={() => setShowAll(true)}
                      className="rounded underline underline-offset-2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    >
                      {contactImportHiddenValuesLabel(hidden, t)}
                    </button>
                  </>
                )}
                .
              </>
            )}
          </p>
          {cut && (
            <p className="text-xs leading-snug text-muted-foreground">
              {contactImportValueCeilingNote(
                column.values.length,
                column.total,
                t,
              )}
            </p>
          )}
          {showAll && (
            <button
              type="button"
              aria-expanded={true}
              onClick={() => setShowAll(false)}
              className="rounded text-xs underline underline-offset-2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              {t(CONTACT_IMPORT_SHOW_FEWER_VALUES_KEY)}
            </button>
          )}
        </div>
        <div className="w-full sm:w-52">
          <NativeSelect
            id={id}
            aria-label={t("contacts.columnQuestion", {
              column: columnLabel(column, t),
            })}
            value={column.answer ?? UNANSWERED}
            onChange={(event) =>
              onAnswer(
                event.target.value === UNANSWERED
                  ? null
                  : (event.target.value as ColumnAnswer),
              )
            }
          >
            {/* Present only while unanswered. Leaving it in the list after an
                answer would offer "un-answer" as a choice that looks like the
                others, and there is no such column state to post. */}
            {column.answer === null && (
              <option value={UNANSWERED}>
                {t("contacts.chooseWhatThisIs")}
              </option>
            )}
            {IMPORT_FIELDS.map((field) => (
              <option key={field} value={field}>
                {t(ANSWER_LABEL_KEYS[field])}
              </option>
            ))}
            <option value={CONTACT_IMPORT_IGNORE}>
              {t(ANSWER_LABEL_KEYS.ignore)}
            </option>
          </NativeSelect>
        </div>
      </div>
    </li>
  );
}

/**
 * The G6 CSV import wizard: upload → an answer for every column → client-side
 * dry-run preview → POST /v1/contacts/import → summary with a downloadable
 * skipped-rows CSV. All rows are sent; the API's response is the authoritative
 * summary.
 *
 * #248 round 3 rebuilt the second step. It used to ask the inverse question —
 * "which column is Phone?" — over a fixed list of seven fields, which meant
 * every column the person did not map was not merely unanswered but absent from
 * the screen. A "Do Not Call" column nothing recognised was invisible, dropped,
 * and the file's consent attestation was written over the top. It now asks
 * about the FILE: one row per column, its own values beside it, and no way
 * forward until every one has an answer.
 *
 * EVERY COLUMN IS ON SCREEN, not only the unanswered ones, and that is the fix
 * for the last way through: `Phone,Name,Notes` over a Notes column reading "DO
 * NOT CALL - asked us to stop" is answered end to end by the detector, so a
 * screen that rendered `decision.unanswered` alone showed that file nothing at
 * all and the send went out. `notes` is a perfectly sensible answer for a column
 * called Notes — no amount of improving the detector reaches this, and the only
 * thing that does is a person seeing the value.
 *
 * WHAT THIS DOES NOT GUARANTEE, said here because a comment claiming otherwise
 * would be worse than none. Two things:
 *
 *   Somebody can answer "skip this column" for all of them without reading a
 *   single value, and no screen can tell that apart from a person who looked.
 *
 *   The preview step re-states none of it: it lists rows, not columns.
 *
 * The third used to be that a column showed its first
 * {@link SAMPLE_VALUE_LIMIT} distinct values and a sentence buried at the fourth
 * sat behind ", and more" — with the file itself named as the place to read the
 * rest. "Go and open your spreadsheet" is not an answer during an import, and
 * "more" is not a quantity. The row now counts what it has not printed and that
 * count is the control that prints it.
 *
 * What is closed is the SILENT case — no column is dropped that nobody was
 * shown, no answer is supplied here for a column we did not recognise, and no
 * answer we DID supply is hidden from the person who has to live with it. Every
 * real accident so far has been in the silent case.
 */
export function ImportWizard({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const importContacts = useImportContacts();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [step, setStep] = useState<Step>("upload");
  // The file the person CHOSE, kept to be posted unchanged. The wizard used to
  // rewrite every header into our canonical spelling before uploading, which is
  // what made the server's gate unable to fire for this door at all: it only
  // ever saw column names we had invented. Posting the original means the
  // declaration describes the bytes the server parses.
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<CsvRow[]>([]);
  const [columns, setColumns] = useState<ImportColumn[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  // Asked on the preview step, where the person has just seen the actual rows
  // and counts — an attestation collected before anyone has looked at the file
  // is a click, not a statement. Reset with everything else, so a second import
  // in the same session has to be attested again rather than inheriting the
  // first one's answer about a different file.
  const [consentAttested, setConsentAttested] = useState(false);

  const decision = useMemo(() => decideColumns(columns), [columns]);
  const answered = columns.length - decision.unanswered.length;

  const preview = useMemo(
    () => (step === "preview" ? buildPreview(rows, decision.mapping) : []),
    [step, rows, decision.mapping],
  );
  const summary = useMemo(() => summarizePreview(preview), [preview]);

  /**
   * The column somebody DID declare as do-not-text has to be readable.
   *
   * The other half of the same defect, one level down: `Subscribed`/
   * `Unsubscribed` under a correctly identified header is still a silent drop —
   * every row reads as nothing, the preview promises "Imports" for all of them,
   * and the people who unsubscribed get texted.
   *
   * No answer on this screen can clear it, deliberately. We already know this
   * column decides who may be texted, because that is what somebody just said
   * it was. The only honest fixes are in the file or in the answer.
   */
  const unreadableFlag = useMemo(() => {
    const index = decision.mapping.opted_out;
    if (index === undefined) return null;
    const values = unreadableFlagValues(
      rows.map((row) => row.cells),
      index,
    );
    if (values.length === 0) return null;
    return { index, values };
  }, [rows, decision.mapping]);

  const ready =
    decision.declarations !== null &&
    decision.mapping.phone !== undefined &&
    unreadableFlag === null;

  function reset() {
    setStep("upload");
    setFile(null);
    setRows([]);
    setColumns([]);
    setUploadError(null);
    setImportError(null);
    setResult(null);
    setConsentAttested(false);
  }

  // While the import request is in flight, dismissal is swallowed (issue
  // #57): closing would wipe the rows and the finished import's skipped-rows
  // report could never be rebuilt. The dialog stays open until the request
  // settles and the summary is shown.
  function close(next: boolean) {
    const decided = decideWizardDismissal(next, importContacts.isPending);
    if (!decided.propagate) return;
    if (decided.reset) reset();
    onOpenChange(next);
  }

  async function handleFile(chosen: File) {
    setUploadError(null);
    if (chosen.size > CONTACT_IMPORT_MAX_BYTES) {
      setUploadError(t("contacts.csvTooBig", { size: MAX_SIZE_LABEL }));
      return;
    }
    // Lazy-load papaparse (~45KB) only when a CSV is actually chosen — it stays
    // out of the contacts route's initial bundle for everyone who never imports.
    const Papa = (await import("papaparse")).default;
    Papa.parse<string[]>(chosen, {
      // Blank lines are kept by the parser and dropped by `csvRows`, which is a
      // port of what the API does. Letting papaparse skip them instead would
      // renumber every row after a blank one, and the API's skip reasons are
      // keyed by the file's own line numbers — so the skipped-rows download
      // would hand back the wrong original rows.
      skipEmptyLines: false,
      complete: (parsed) => {
        const all = csvRows(parsed.data);
        if (all.length < 2) {
          setUploadError(t("contacts.csvNeedsHeader"));
          return;
        }
        const headers = all[0].cells;
        const dataRows = all.slice(1);
        if (dataRows.length > CONTACT_IMPORT_MAX_ROWS) {
          setUploadError(
            t("contacts.csvTooManyRows", {
              rows: CONTACT_IMPORT_MAX_ROWS.toLocaleString(),
            }),
          );
          return;
        }
        setFile(chosen);
        setRows(dataRows);
        setColumns(importColumns(headers, dataRows));
        setStep("map");
      },
      error: () => {
        setUploadError(t("contacts.csvUnreadable"));
      },
    });
  }

  function runImport() {
    setImportError(null);
    // Narrowing, not a gate: the button that reaches here exists only on a step
    // reachable with a complete declaration, so this cannot be false. It is
    // written as a refusal rather than a `!` because the alternative — post
    // whatever we have and let the server sort it out — is the client that
    // learns the missing columns from the refusal and echoes them back, and
    // that is round two's defect exactly.
    if (file === null || decision.declarations === null) return;
    importContacts.mutate(
      { file, consentAttested, columns: decision.declarations },
      {
        onSuccess: (summaryResult) => {
          setResult(summaryResult);
          setStep("done");
        },
        onError: (cause) =>
          setImportError(
            cause instanceof ApiError
              ? cause.message
              : t("contacts.importFailed"),
          ),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent
        className="max-h-[85svh] overflow-y-auto sm:max-w-2xl"
        showCloseButton={!importContacts.isPending}
        onInteractOutside={(event) => {
          if (importContacts.isPending) event.preventDefault();
        }}
        onEscapeKeyDown={(event) => {
          if (importContacts.isPending) event.preventDefault();
        }}
      >
        {step === "upload" && (
          <>
            <DialogHeader>
              <DialogTitle>{t("contacts.csvTitle")}</DialogTitle>
              <DialogDescription>{t("contacts.csvBlurb")}</DialogDescription>
            </DialogHeader>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex min-h-32 w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-8 text-sm text-muted-foreground transition-colors duration-150 ease-out hover:border-primary/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <FileUp className="size-6" strokeWidth={1.75} aria-hidden />
              {t("contacts.csvChooseFile")}
              <span className="text-xs">
                {t("contacts.csvUpTo", {
                  rows: CONTACT_IMPORT_MAX_ROWS.toLocaleString(),
                  size: MAX_SIZE_LABEL,
                })}
              </span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              aria-label={t("contacts.csvFileInput")}
              onChange={(event) => {
                const chosen = event.target.files?.[0];
                if (chosen) handleFile(chosen);
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

        {step === "map" && (
          <>
            <DialogHeader>
              <DialogTitle>{t("contacts.csvColumnsTitle")}</DialogTitle>
              <DialogDescription>
                {t("contacts.csvColumnsBlurb", {
                  file: file?.name ?? "",
                  rows: rows.length.toLocaleString(),
                  answered: answered.toLocaleString(),
                  columns: columns.length.toLocaleString(),
                })}
              </DialogDescription>
            </DialogHeader>

            {/* The work first, and only when there is work. A file whose header
                row we recognised end to end never sees this block at all, which
                is what keeps it from becoming the thing everybody clicks
                through. */}
            {decision.unanswered.length > 0 && (
              <div className="rounded-lg border border-warning/40 bg-warning/5 px-4 py-3">
                <div className="flex items-start gap-3">
                  {/* mt-0.5 optically centres the glyph on the heading's
                      cap-height; flush with the line box it reads as high. */}
                  <ScanSearch
                    className="mt-0.5 size-5 shrink-0 text-warning"
                    strokeWidth={1.75}
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="text-sm font-medium">
                      {decision.unanswered.length === 1
                        ? t("contacts.unrecognisedOne")
                        : t("contacts.unrecognisedMany", {
                            count: decision.unanswered.length,
                          })}
                    </p>
                    <p className="text-sm leading-snug text-muted-foreground">
                      {t("contacts.unrecognisedBlurb")}
                    </p>
                  </div>
                </div>
                <ul className="mt-3 space-y-2">
                  {decision.unanswered.map((column) => (
                    <ColumnRow
                      key={column.index}
                      column={column}
                      onAnswer={(answer) =>
                        setColumns((current) =>
                          answerColumn(current, column.index, answer),
                        )
                      }
                    />
                  ))}
                </ul>
                {/* BELOW the list, never above it. One click answering all of
                    them is fine — and is the honest shortcut for the ordinary
                    file full of invoice numbers — precisely and only because
                    every column and its values are on screen when it is
                    pressed. Moved above the list, this is the silent drop with
                    an extra step, and CL-12 fails on the document order rather
                    than on either element being absent. */}
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  onClick={() =>
                    setColumns((current) =>
                      answerRemaining(current, CONTACT_IMPORT_IGNORE),
                    )
                  }
                >
                  {t(
                    decision.unanswered.length === 1
                      ? "contacts.ignoreAllOne"
                      : "contacts.ignoreAllMany",
                  )}
                </Button>
              </div>
            )}

            {/* EVERY ANSWERED COLUMN, IN FILE ORDER, WITH ITS OWN VALUES —
                the guesses above all, and this block is the ship blocker's fix.
                `Phone,Name,Notes` over a Notes column reading "DO NOT CALL -
                asked us to stop" is answered end to end by the detector, so a
                screen that rendered only the UNANSWERED columns showed that file
                nothing at all: the mapping was posted with no interaction and a
                message went out. A guess is only a guess somebody confirmed if
                they were shown what they were confirming.

                Recognised columns therefore stay visible AND stay editable: a
                wrong guess nobody can see is the same silent drop from the other
                end, and a row that vanished on being answered would leave no way
                to take the answer back. */}
            {answered > 0 && (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  {t(
                    decision.unanswered.length > 0
                      ? "contacts.answeredSome"
                      : "contacts.answeredAll",
                  )}
                </p>
                <ul className="space-y-2">
                  {columns
                    .filter((column) => column.answer !== null)
                    .map((column) => (
                      <ColumnRow
                        key={column.index}
                        column={column}
                        onAnswer={(answer) =>
                          setColumns((current) =>
                            answerColumn(current, column.index, answer),
                          )
                        }
                      />
                    ))}
                </ul>
              </div>
            )}

            {/* Two columns, one field. Shown and never resolved for them: the
                losing half of any automatic answer is a field silently emptied,
                which is the whole defect class. The API refuses the pair by
                name for the same reason. */}
            {decision.conflicts.length > 0 && (
              <div
                role="alert"
                className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3"
              >
                <div className="flex items-start gap-3">
                  <ShieldAlert
                    className="mt-0.5 size-5 shrink-0 text-destructive"
                    strokeWidth={1.75}
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="text-sm font-medium">
                      {t("contacts.conflictTitle")}
                    </p>
                    {decision.conflicts.map((conflict) => (
                      <p
                        key={conflict.field}
                        className="text-sm leading-snug text-muted-foreground"
                      >
                        {t("contacts.conflictSetTo", {
                          columns: conflict.columns
                            .map((column) => columnLabel(column, t))
                            .join(t("contacts.joinAnd")),
                        })}{" "}
                        <span className="font-medium text-foreground">
                          {t(ANSWER_LABEL_KEYS[conflict.field])}
                        </span>
                        {t("contacts.conflictOnePerContact")}
                      </p>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Progressive disclosure: only a file that actually has split name
                columns needs the rule explaining them, and most files do not.
                The joined result is what the next step shows, so this answers
                the question before it is asked rather than after. */}
            {(decision.mapping.first_name !== undefined ||
              decision.mapping.last_name !== undefined) && (
              <p className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                {t("contacts.splitNameNote")}
              </p>
            )}

            {unreadableFlag && (
              <div
                role="alert"
                /* destructive/30 is this app's existing weight for its own
                   token, not a third pair invented here. */
                className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3"
              >
                <div className="flex items-start gap-3">
                  <ShieldAlert
                    className="mt-0.5 size-5 shrink-0 text-destructive"
                    strokeWidth={1.75}
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="text-sm font-medium">
                      {t("contacts.unreadableTitle", {
                        column: columnLabel(
                          {
                            header: columns[unreadableFlag.index]?.header ?? "",
                            index: unreadableFlag.index,
                          },
                          t,
                        ),
                      })}
                    </p>
                    <p className="text-sm leading-snug text-muted-foreground">
                      {t("contacts.unreadableLead")}{" "}
                      <span className="font-medium text-foreground">
                        {unreadableFlag.values
                          .slice(0, SAMPLE_VALUE_LIMIT)
                          .map((value) =>
                            t("contacts.columnQuoted", { header: value }),
                          )
                          .join(", ")}
                        {unreadableFlag.values.length > SAMPLE_VALUE_LIMIT &&
                          t("contacts.unreadableOverflow", {
                            count:
                              unreadableFlag.values.length - SAMPLE_VALUE_LIMIT,
                          })}
                      </span>
                      {t("contacts.unreadableTail", {
                        trueValues: FLAG_TRUE_SPELLINGS.join(", "),
                        falseValues: FLAG_FALSE_SPELLINGS.join(", "),
                      })}
                    </p>
                  </div>
                </div>
              </div>
            )}

            <p className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
              {t("contacts.doNotTextNote", {
                trueValues: FLAG_TRUE_SPELLINGS.join(", "),
                falseValues: FLAG_FALSE_SPELLINGS.join(", "),
              })}
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={reset}>
                {t("common.back")}
              </Button>
              <Button disabled={!ready} onClick={() => setStep("preview")}>
                {t("contacts.previewAction")}
              </Button>
            </DialogFooter>
            {/* One reason at a time, in the order they have to be fixed. Three
                at once reads as a wall and none of them gets acted on. */}
            {!ready && (
              <p className="text-xs text-muted-foreground">
                {t(
                  decision.unanswered.length > 0
                    ? "contacts.gateAnswerEvery"
                    : decision.conflicts.length > 0
                      ? "contacts.gateConflict"
                      : unreadableFlag !== null
                        ? "contacts.gateUnreadable"
                        : "contacts.gatePhone",
                )}
              </p>
            )}
          </>
        )}

        {step === "preview" && (
          <>
            <DialogHeader>
              <DialogTitle>{t("contacts.previewTitle")}</DialogTitle>
              <DialogDescription>
                {t("contacts.previewWillImport", {
                  count: summary.ready.toLocaleString(),
                })}
                {summary.optedOut > 0 &&
                  t("contacts.previewOptedOut", {
                    count: summary.optedOut.toLocaleString(),
                  })}
                {summary.skipped > 0 &&
                  t("contacts.previewSkipped", {
                    count: summary.skipped.toLocaleString(),
                  })}
                {t("contacts.previewDedupeNote")}
              </DialogDescription>
            </DialogHeader>
            <div className="max-h-72 overflow-y-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("contacts.fieldPhone")}</TableHead>
                    <TableHead>{t("contacts.fieldName")}</TableHead>
                    <TableHead>{t("contacts.fieldResult")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.slice(0, PREVIEW_ROW_LIMIT).map((row) => (
                    <TableRow key={row.rowNumber}>
                      <TableCell className="tabular-nums">
                        {row.values.phone || "–"}
                      </TableCell>
                      {/* The joined name, not the raw cell: this column is a
                          promise about what will be stored, and for a split
                          first/last file the raw cell is half of it. */}
                      <TableCell>{row.resolvedName || "–"}</TableCell>
                      <TableCell>
                        {row.status === "ready" ? (
                          row.optedOut ? (
                            <Badge className="border-transparent bg-warning/10 text-amber-800 dark:bg-warning/15 dark:text-warning">
                              {t("contacts.resultImportsOptedOut")}
                            </Badge>
                          ) : (
                            <Badge className="border-transparent bg-success/10 text-success">
                              {t("contacts.resultImports")}
                            </Badge>
                          )
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            {t("contacts.resultSkipped", {
                              reason: row.reason ?? "",
                            })}
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {preview.length > PREVIEW_ROW_LIMIT && (
                <p className="border-t px-3 py-2 text-xs text-muted-foreground">
                  {t("contacts.previewShowingFirst", {
                    shown: PREVIEW_ROW_LIMIT,
                    total: preview.length.toLocaleString(),
                  })}
                </p>
              )}
            </div>
            <ImportConsentCheck
              source="file"
              checked={consentAttested}
              disabled={importContacts.isPending}
              onCheckedChange={setConsentAttested}
            />
            {importError && (
              <p role="alert" className="text-sm text-destructive">
                {importError}
              </p>
            )}
            <DialogFooter>
              <Button
                variant="outline"
                disabled={importContacts.isPending}
                onClick={() => setStep("map")}
              >
                {t("common.back")}
              </Button>
              {/* The attestation gates the button rather than warning after the
                  click: the server refuses an unattested import anyway (#226),
                  and a 422 spent on a file somebody already waited to upload
                  teaches nothing the disabled state has not already said.

                  No second copy of the COLUMN gate here, and the reason is that
                  it could never fire. There is one route to this step — the
                  mapping screen's gated button — and nothing on this step can
                  un-answer a column, so `ready` is true for as long as this
                  button exists. A condition no input can make false cannot be
                  proved by breaking it, and an unprovable check reads to the
                  next person as a guarantee that something tests. The gate
                  stays where it can fire: break the answers behind `Back` and
                  the way through shuts, which IS asserted. */}
              <Button
                disabled={
                  summary.ready === 0 ||
                  !consentAttested ||
                  importContacts.isPending
                }
                onClick={runImport}
              >
                {importContacts.isPending
                  ? t("contacts.importing")
                  : t("contacts.importCount", {
                      count: summary.ready.toLocaleString(),
                    })}
              </Button>
            </DialogFooter>
            {importContacts.isPending && (
              <p role="status" className="text-xs text-muted-foreground">
                {t("contacts.importingNow")}
              </p>
            )}
          </>
        )}

        {step === "done" && result && (
          <>
            <DialogHeader>
              <DialogTitle>{t("contacts.importFinished")}</DialogTitle>
              <DialogDescription>
                {t("contacts.doneSummary", {
                  imported: result.imported.toLocaleString(),
                  updated: result.updated.toLocaleString(),
                  skipped: result.skipped.toLocaleString(),
                })}
              </DialogDescription>
            </DialogHeader>
            {/* The same block the .vcf and phone-picker summaries render, from
                the same component — this wizard has its own done step rather
                than sharing ImportSummaryView, and a second hand-written copy
                of a compliance notice is a copy that eventually only one door
                shows. Above the skipped-rows download for the same reason it
                leads there: it is the unexpected half. */}
            <ImportConsentRefused result={result} />
            {result.errors.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  {t("contacts.skippedRowsBlurb")}
                </p>
                <Button
                  variant="outline"
                  onClick={() =>
                    downloadCsv(
                      "skipped-rows.csv",
                      skippedRowsCsv(
                        result.errors,
                        buildPreview(rows, decision.mapping),
                      ),
                    )
                  }
                >
                  {t("contacts.downloadSkippedRows")}
                </Button>
              </div>
            )}
            <DialogFooter>
              <Button onClick={() => close(false)}>{t("contacts.done")}</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
