"use client";

import { Check, FileText, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import {
  CANADIAN_LOA_TEMPLATE_URL,
  PORT_DOCUMENT_HINTS,
} from "@/components/porting/copy";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api/error";
import { useUploadPortDocuments } from "@/lib/api/porting";
import type { Country, PortRequest } from "@/lib/api/types";
import { cn } from "@/lib/utils";

/**
 * LOA + invoice upload for a port (PORTING.md §8.1 step 4 / §3.2). Two labeled
 * file fields with a one-line plain explainer each — LOA and invoice are the
 * only jargon we surface, and only as field labels (§8.2). Blocked server-side
 * until the subscription is active (post-payment, D16); the card only renders
 * this when documents are pending. Accepts PDF / PNG / JPEG under 10 MB.
 */

const ACCEPT = ".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg";
const MAX_BYTES = 10 * 1024 * 1024;

/** One labeled file slot — shared with the text-enablement documents form. */
export function FileField({
  id,
  label,
  hint,
  filename,
  uploaded,
  onFile,
  accept = ACCEPT,
}: {
  id: string;
  label: string;
  hint: string;
  filename: string | null;
  uploaded: boolean;
  onFile: (file: File | null) => void;
  /** Input accept filter; defaults to the porting PDF/PNG/JPEG set. */
  accept?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div
        className={cn(
          "flex items-center gap-3 rounded-lg border px-4 py-3",
          uploaded ? "border-success/30 bg-success/5" : "border-border bg-card",
        )}
      >
        {uploaded ? (
          <Check className="size-4 shrink-0 text-success" strokeWidth={2} aria-hidden />
        ) : (
          <FileText
            className="size-4 shrink-0 text-muted-foreground"
            strokeWidth={1.75}
            aria-hidden
          />
        )}
        <span className="min-w-0 flex-1 truncate text-sm">
          {filename ? (
            filename
          ) : uploaded ? (
            "On file"
          ) : (
            <span className="text-muted-foreground">No file chosen</span>
          )}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          // Name the field the button belongs to — a form has two otherwise
          // identical "Choose"/"Replace" buttons (LOA + bill).
          aria-label={`${filename || uploaded ? "Replace" : "Choose"} file — ${label}`}
          onClick={() => inputRef.current?.click()}
        >
          <Upload className="size-4" aria-hidden />
          {filename || uploaded ? "Replace" : "Choose"}
        </Button>
        <input
          ref={inputRef}
          id={id}
          type="file"
          accept={accept}
          className="sr-only"
          onChange={(e) => onFile(e.target.files?.[0] ?? null)}
        />
      </div>
      <p className="text-[13px] text-muted-foreground">{hint}</p>
    </div>
  );
}

export function PortDocumentsForm({
  port,
  country,
}: {
  port: PortRequest;
  country: Country;
}) {
  const upload = useUploadPortDocuments(port.id);
  const [loa, setLoa] = useState<File | null>(null);
  const [invoice, setInvoice] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  function validate(file: File | null): string | null {
    if (!file) return null;
    if (file.size === 0 || file.size > MAX_BYTES) {
      return "Each file must be a non-empty document under 10 MB.";
    }
    return null;
  }

  async function onUpload() {
    setError(null);
    if (!loa && !invoice) {
      setError("Choose your signed authorization and/or a recent bill to upload.");
      return;
    }
    const sizeError = validate(loa) ?? validate(invoice);
    if (sizeError) {
      setError(sizeError);
      return;
    }
    try {
      await upload.mutateAsync({
        ...(loa ? { loa } : {}),
        ...(invoice ? { invoice } : {}),
      });
      setLoa(null);
      setInvoice(null);
      toast.success("Documents uploaded.");
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : "Couldn't upload your documents. Try again in a moment.",
      );
    }
  }

  return (
    <div className="space-y-4">
      <FileField
        id={`loa-${port.id}`}
        label="Signed authorization (LOA)"
        hint={country === "CA" ? PORT_DOCUMENT_HINTS.loaCa : PORT_DOCUMENT_HINTS.loa}
        filename={loa?.name ?? null}
        uploaded={port.has_loa && !loa}
        onFile={setLoa}
      />
      {country === "CA" ? (
        <a
          href={CANADIAN_LOA_TEMPLATE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block text-[13px] font-medium text-primary underline-offset-4 hover:underline"
        >
          Download the Canadian authorization template
        </a>
      ) : null}
      <FileField
        id={`invoice-${port.id}`}
        label="Recent bill"
        hint={PORT_DOCUMENT_HINTS.invoice}
        filename={invoice?.name ?? null}
        uploaded={port.has_invoice && !invoice}
        onFile={setInvoice}
      />

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <Button
        type="button"
        onClick={() => void onUpload()}
        disabled={upload.isPending || (!loa && !invoice)}
      >
        {upload.isPending ? "Uploading…" : "Upload documents"}
      </Button>
    </div>
  );
}
