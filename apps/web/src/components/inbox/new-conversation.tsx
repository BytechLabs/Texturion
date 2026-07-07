"use client";

import { ArrowLeft, FileText, ImagePlus, Send, X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { DropOverlay, useFileDrop } from "@/components/attachments/use-file-drop";
import {
  admitFiles,
  AttachmentChips,
  fileToBase64,
  SegmentMeterLabel,
  useAutoGrow,
  type DraftAttachment,
} from "@/components/thread/composer";
import { TemplatePicker } from "@/components/thread/template-picker";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useCompany } from "@/lib/api/companies";
import { useStartConversation, type ComposeInput } from "@/lib/api/compose";
import { useContact, useContacts } from "@/lib/api/contacts";
import { ApiError } from "@/lib/api/error";
import type { OutboundMedia } from "@/lib/api/messages";
import { flattenPages } from "@/lib/api/pagination";
import type { Contact } from "@/lib/api/types";
import { useUsage } from "@/lib/api/usage";
import { isFilePaste } from "@/lib/attachments/clipboard";
import { contactDisplayName, formatPhone } from "@/lib/format/phone";

import {
  destinationCountry,
  selectComposerBanner,
  usSendApproved,
} from "@/components/thread/composer-banner";
import { ComposerBannerCard } from "@/components/thread/composer-banners";
import {
  destinationLocalTimeLabel,
  formatNanpAsYouType,
  looksLikePhoneInput,
  normalizeNanpInput,
} from "./e164";

type Recipient =
  | { kind: "contact"; contact: Contact }
  | { kind: "number"; e164: string };

/**
 * /inbox/new — the G5 outbound-first compose flow: contact search + raw
 * number with live E.164 formatting, saved-reply template picker, image
 * attachments, segment meter, quiet-hours dialog driven by the API's
 * `quiet_hours_confirmation_required` code (409; matched structurally, never
 * by message text). Consent is attested implicitly server-side now (the visible
 * checkbox was removed).
 */
export function NewConversation() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const company = useCompany();
  const usage = useUsage();
  const start = useStartConversation();

  // --- Recipient -------------------------------------------------------------
  const [recipient, setRecipient] = useState<Recipient | null>(null);
  const [input, setInput] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const isPhone = looksLikePhoneInput(input);
  const displayInput = isPhone ? formatNanpAsYouType(input) : input;
  const contacts = useContacts(isPhone ? "" : input.trim());
  const contactRows = useMemo(() => {
    const rows = flattenPages(contacts.data).filter((c) => c.deleted_at === null);
    if (!isPhone) return rows.slice(0, 6);
    const digits = displayInput.replace(/\D/g, "");
    return rows
      .filter((c) => c.phone_e164.replace(/\D/g, "").includes(digits))
      .slice(0, 6);
  }, [contacts.data, isPhone, displayInput]);

  // ?contact={id} prefill (search results, contact pages) — resolved by the
  // PrefillContact child so the hook only mounts with a real id.
  const prefillId = searchParams.get("contact");

  const typedE164 = isPhone ? normalizeNanpInput(input) : null;

  // --- Draft -----------------------------------------------------------------
  const [body, setBody] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [quietHours, setQuietHours] = useState<{
    localTime: string | null;
  } | null>(null);
  const textareaRef = useAutoGrow(body);

  // --- Attachments (§7 outbound MMS: ≤3 photos ≤1 MB each) -------------------
  const [attachments, setAttachments] = useState<DraftAttachment[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  // Object URLs are revoked when a chip is removed or the composer unmounts —
  // a successful send navigates away (unmount), which frees the previews.
  const attachmentsRef = useRef(attachments);
  attachmentsRef.current = attachments;
  useEffect(
    () => () => {
      for (const a of attachmentsRef.current) URL.revokeObjectURL(a.previewUrl);
    },
    [],
  );

  const removeAttachment = (id: string) => {
    setAttachments((current) => {
      const found = current.find((a) => a.id === id);
      if (found) URL.revokeObjectURL(found.previewUrl);
      return current.filter((a) => a.id !== id);
    });
  };

  // D28 intake — the attach button, dropped files, and pasted images all funnel
  // through the shared admitFiles (count/type/size validation + G10 copy).
  const admitIncoming = (files: FileList) =>
    setAttachments((cur) => admitFiles(cur, files));
  const drop = useFileDrop(admitIncoming);

  // Insert a saved reply's body into the draft (one space if the draft doesn't
  // already end in one), then refocus the field. Merge tokens resolve
  // server-side at send, so the raw body is inserted as-is.
  const insertTemplate = (templateBody: string) => {
    setBody((current) => {
      const sep = current.length === 0 || current.endsWith(" ") ? "" : " ";
      return `${current}${sep}${templateBody}`;
    });
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  // --- Sending number ----------------------------------------------------------
  const activeNumbers = (company.data?.numbers ?? []).filter(
    (n) => n.status === "active" && n.number_e164 !== null,
  );
  const [numberId, setNumberId] = useState<string | null>(null);
  useEffect(() => {
    if (numberId === null && activeNumbers.length > 0) {
      setNumberId(activeNumbers[0].id);
    }
  }, [activeNumbers, numberId]);

  // --- Gates preview (the API enforces independently) --------------------------
  const destinationE164 =
    recipient?.kind === "contact"
      ? recipient.contact.phone_e164
      : recipient?.kind === "number"
        ? recipient.e164
        : typedE164;
  // Known opt-out state for a picked contact (raw numbers stay unknown until
  // the API answers recipient_opted_out).
  const [contactOptedOut, setContactOptedOut] = useState(false);
  useEffect(() => {
    if (recipient?.kind !== "contact") setContactOptedOut(false);
  }, [recipient]);
  const banner =
    company.data && destinationE164
      ? selectComposerBanner({
          contactOptedOut,
          subscriptionStatus: company.data.subscription_status,
          destinationCountry: destinationCountry(destinationE164),
          usApproved: usSendApproved(company.data),
          usage: usage.data ?? null,
        })
      : null;

  const canSend =
    !start.isPending &&
    destinationE164 !== null &&
    destinationE164 !== undefined &&
    body.trim() !== "" &&
    numberId !== null &&
    banner === null;

  const submit = async (quietConfirmed: boolean) => {
    if (!destinationE164 || numberId === null) return;
    // Read the staged photos into base64 up front. Attachments are never
    // cleared here, so they survive a quiet-hours 409 — the dialog's re-submit
    // (submit(true)) carries the same media.
    let media: OutboundMedia[] | undefined;
    try {
      if (attachments.length > 0) {
        media = await Promise.all(
          attachments.map(async (a) => ({
            content_type: a.file.type as OutboundMedia["content_type"],
            base64: await fileToBase64(a.file),
          })),
        );
      }
    } catch {
      toast.error("Couldn't read that photo. Try attaching it again.");
      return;
    }
    const inputBody: ComposeInput = {
      ...(recipient?.kind === "contact"
        ? { contact_id: recipient.contact.id }
        : { phone_e164: destinationE164 }),
      phone_number_id: numberId,
      body,
      ...(quietConfirmed ? { quiet_hours_confirmed: true } : {}),
      ...(media ? { media } : {}),
    };
    start.mutate(inputBody, {
      onSuccess: ({ conversation }) => {
        router.push(`/inbox/${conversation.id}`);
      },
      onError: (error) => {
        if (
          error instanceof ApiError &&
          error.code === "quiet_hours_confirmation_required"
        ) {
          setQuietHours({
            localTime: destinationLocalTimeLabel(destinationE164),
          });
          return;
        }
        toast.error(
          error instanceof ApiError
            ? error.message
            : "That didn't send. Check your connection and try again.",
        );
      },
    });
  };

  const selectContact = (contact: Contact) => {
    setRecipient({ kind: "contact", contact });
    setInput("");
    setSearchOpen(false);
  };

  const confirmTypedNumber = () => {
    if (typedE164) {
      setRecipient({ kind: "number", e164: typedE164 });
      setInput("");
      setSearchOpen(false);
    }
  };

  return (
    <div className="relative flex h-full min-h-0 flex-col" {...drop.handlers}>
      {/* D28: dropped photos land anywhere on the panel (validated by admitFiles). */}
      <DropOverlay active={drop.active} />
      <header className="flex items-center gap-2 border-b border-border px-2 py-2 md:px-4">
        <Button
          asChild
          variant="ghost"
          size="icon-sm"
          className="md:hidden"
          aria-label="Back to inbox"
        >
          <Link href="/inbox">
            <ArrowLeft className="size-4" strokeWidth={1.75} />
          </Link>
        </Button>
        <h1 className="flex-1 text-sm font-semibold text-foreground">
          New conversation
        </h1>
        <Button
          asChild
          variant="ghost"
          size="icon-sm"
          className="hidden md:inline-flex"
          aria-label="Close"
        >
          <Link href="/inbox">
            <X className="size-4" strokeWidth={1.75} />
          </Link>
        </Button>
      </header>

      <div className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-5 overflow-y-auto p-4 md:p-6">
        {prefillId && recipient === null && (
          <PrefillContact contactId={prefillId} onLoaded={selectContact} />
        )}
        {recipient?.kind === "contact" && (
          <ContactOptOutProbe
            contactId={recipient.contact.id}
            onChange={setContactOptedOut}
          />
        )}

        {/* Recipient */}
        <div className="space-y-1.5">
          <Label htmlFor="compose-to">To</Label>
          {recipient ? (
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-2 rounded-full bg-secondary px-3 py-1.5 text-sm">
                <span className="font-medium">
                  {recipient.kind === "contact"
                    ? contactDisplayName(recipient.contact)
                    : formatPhone(recipient.e164)}
                </span>
                {recipient.kind === "contact" && (
                  <span className="tabular-nums text-muted-foreground">
                    {formatPhone(recipient.contact.phone_e164)}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setRecipient(null)}
                  aria-label="Change recipient"
                  className="rounded-full p-0.5 hover:bg-background"
                >
                  <X className="size-3.5" strokeWidth={1.75} />
                </button>
              </span>
            </div>
          ) : (
            <div className="relative">
              <Input
                id="compose-to"
                value={displayInput}
                autoComplete="off"
                placeholder="Search contacts or type a number"
                onChange={(event) => {
                  setInput(event.target.value);
                  setSearchOpen(true);
                }}
                onFocus={() => setSearchOpen(true)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    if (typedE164) confirmTypedNumber();
                    else if (contactRows.length === 1)
                      selectContact(contactRows[0]);
                  }
                  if (event.key === "Escape") setSearchOpen(false);
                }}
                aria-label="Recipient — search contacts or type a phone number"
              />
              {searchOpen && input.trim() !== "" && (
                <div className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-md border border-border bg-popover">
                  {contactRows.map((contact) => (
                    <button
                      key={contact.id}
                      type="button"
                      onClick={() => selectContact(contact)}
                      className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors duration-150 ease-out hover:bg-secondary/60"
                    >
                      <span className="truncate font-medium">
                        {contactDisplayName(contact)}
                      </span>
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                        {formatPhone(contact.phone_e164)}
                      </span>
                    </button>
                  ))}
                  {typedE164 && (
                    <button
                      type="button"
                      onClick={confirmTypedNumber}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium text-primary transition-colors duration-150 ease-out hover:bg-secondary/60"
                    >
                      Text {formatPhone(typedE164)}
                    </button>
                  )}
                  {contactRows.length === 0 && !typedE164 && (
                    <p className="px-3 py-2 text-sm text-muted-foreground">
                      {isPhone
                        ? "Keep typing — a US or Canada number has 10 digits."
                        : contacts.isPending && input.trim().length > 0
                          ? "Searching…"
                          : "No matching contacts."}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* From number (Pro companies can hold two). */}
        {activeNumbers.length > 1 && (
          <div className="space-y-1.5">
            <Label htmlFor="compose-from">From</Label>
            <Select
              value={numberId ?? undefined}
              onValueChange={(value) => setNumberId(value)}
            >
              <SelectTrigger id="compose-from" className="w-full">
                <SelectValue placeholder="Choose a number" />
              </SelectTrigger>
              <SelectContent>
                {activeNumbers.map((number) => (
                  <SelectItem key={number.id} value={number.id}>
                    {formatPhone(number.number_e164 as string)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        {company.isPending && <Skeleton className="h-9 w-full" />}
        {company.isSuccess && activeNumbers.length === 0 && (
          <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
            Your business number is still being set up — sending unlocks the
            moment it&apos;s ready.
          </p>
        )}

        {/* Message */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="compose-body">Message</Label>
            <div className="flex items-center gap-1">
              {/* Attach up to 3 photos (§7 outbound MMS) — the shared admitFiles
                  enforces count/type/size; this is just the entry point. */}
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={attachments.length >= 3}
                aria-label="Attach a photo"
                className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-45"
              >
                <ImagePlus className="size-3.5" strokeWidth={1.75} aria-hidden />
                Photo
              </button>
              {/* Saved-reply (template) picker — same one as the in-thread
                  composer; also opens on "/" in an empty draft. */}
              <TemplatePicker
                open={pickerOpen}
                onOpenChange={setPickerOpen}
                onInsert={insertTemplate}
              >
                <button
                  type="button"
                  onClick={() => setPickerOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <FileText className="size-3.5" strokeWidth={1.75} aria-hidden />
                  Saved reply
                </button>
              </TemplatePicker>
            </div>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/gif"
            multiple
            hidden
            onChange={(event) => {
              if (event.target.files) admitIncoming(event.target.files);
              event.target.value = "";
            }}
          />
          <AttachmentChips attachments={attachments} onRemove={removeAttachment} />
          <textarea
            id="compose-body"
            ref={textareaRef}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                if (canSend) void submit(false);
              }
              // "/" in an empty draft opens the saved-reply picker (G5).
              if (event.key === "/" && body === "") {
                event.preventDefault();
                setPickerOpen(true);
              }
            }}
            onPaste={(event) => {
              // A genuine file paste (screenshot, copied image) stages the photo;
              // a rich-text/Office copy keeps its normal text paste (finding #10).
              if (!isFilePaste(event.clipboardData)) return;
              event.preventDefault();
              admitIncoming(event.clipboardData.files);
            }}
            rows={3}
            placeholder="Write your text…  (/ for a saved reply)"
            className="min-h-20 w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 text-[16px] leading-6 outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 md:text-[15px]"
          />
          <div className="flex items-center justify-between">
            <span aria-hidden />
            <SegmentMeterLabel text={body} />
          </div>
        </div>

        {banner && <ComposerBannerCard banner={banner} />}

        <div className="flex items-center justify-end gap-2">
          <Button
            onClick={() => void submit(false)}
            disabled={!canSend}
            aria-keyshortcuts="Control+Enter Meta+Enter"
          >
            <Send className="size-4" strokeWidth={1.75} />
            {start.isPending ? "Sending…" : "Send"}
          </Button>
        </div>
      </div>

      {/* Quiet-hours confirm (G5 / SPEC §5, driven by the API's 409). */}
      <Dialog
        open={quietHours !== null}
        onOpenChange={(open) => !open && setQuietHours(null)}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {quietHours?.localTime
                ? `It's ${quietHours.localTime} for this customer.`
                : "It's late where this customer is."}
            </DialogTitle>
            <DialogDescription>Send anyway?</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setQuietHours(null)}>
              Wait
            </Button>
            <Button
              onClick={() => {
                setQuietHours(null);
                void submit(true);
              }}
              disabled={start.isPending}
            >
              Send
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * Headless: GET /v1/contacts/:id carries `opted_out`; lift it so the
 * opted-out banner shows before a doomed send (G5).
 */
function ContactOptOutProbe({
  contactId,
  onChange,
}: {
  contactId: string;
  onChange: (optedOut: boolean) => void;
}) {
  const contact = useContact(contactId);
  const optedOut = contact.data?.opted_out ?? false;
  useEffect(() => {
    onChange(optedOut);
  }, [optedOut, onChange]);
  return null;
}

/** Resolve a ?contact= prefill without conditional hooks in the parent. */
function PrefillContact({
  contactId,
  onLoaded,
}: {
  contactId: string;
  onLoaded: (contact: Contact) => void;
}) {
  const contact = useContact(contactId);
  const { data } = contact;
  useEffect(() => {
    if (data) onLoaded(data);
  }, [data, onLoaded]);
  if (contact.isPending) {
    return <Skeleton className="h-9 w-48 rounded-full" />;
  }
  return null;
}
