"use client";

import { ArrowLeft, Send, X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { SegmentMeterLabel, useAutoGrow } from "@/components/thread/composer";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { flattenPages } from "@/lib/api/pagination";
import type { Contact } from "@/lib/api/types";
import { useUsage } from "@/lib/api/usage";
import { useActiveCompany } from "@/lib/company/provider";
import { contactDisplayName, formatPhone } from "@/lib/format/phone";
import { identificationFooter } from "@/lib/settings/footer-preview";

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
 * number with live E.164 formatting, the D4 consent checkbox, first-message
 * footer preview, segment meter, quiet-hours dialog driven by the API's
 * `quiet_hours_confirmation_required` code (409; matched structurally, never
 * by message text).
 */
export function NewConversation() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { membership } = useActiveCompany();
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
  const [consent, setConsent] = useState(false);
  const [quietHours, setQuietHours] = useState<{
    localTime: string | null;
  } | null>(null);
  const textareaRef = useAutoGrow(body);

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

  // First-message footer preview (G5/§5): raw numbers are new contacts;
  // existing contacts show it until their first identification went out.
  const footerNeeded =
    recipient === null ||
    recipient.kind === "number" ||
    recipient.contact.first_identification_sent_at === null;
  // One footer mirror for the whole app (lib/settings/footer-preview mirrors
  // the API's appendIdentificationFooter, which composes with company.name).
  const footerText = identificationFooter(membership.name);

  const canSend =
    !start.isPending &&
    destinationE164 !== null &&
    destinationE164 !== undefined &&
    body.trim() !== "" &&
    consent &&
    numberId !== null &&
    banner === null;

  const submit = (quietConfirmed: boolean) => {
    if (!destinationE164 || numberId === null || !consent) return;
    const inputBody: ComposeInput = {
      ...(recipient?.kind === "contact"
        ? { contact_id: recipient.contact.id }
        : { phone_e164: destinationE164 }),
      phone_number_id: numberId,
      body,
      consent_attested: true,
      ...(quietConfirmed ? { quiet_hours_confirmed: true } : {}),
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
    <div className="flex h-full min-h-0 flex-col">
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
                <div className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-md border border-border bg-popover shadow-lg">
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
          <Label htmlFor="compose-body">Message</Label>
          <textarea
            id="compose-body"
            ref={textareaRef}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                if (canSend) submit(false);
              }
            }}
            rows={3}
            placeholder="Write your text…"
            className="min-h-20 w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 text-[16px] leading-6 outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 md:text-[15px]"
          />
          <div className="flex items-center justify-between">
            <span aria-hidden />
            <SegmentMeterLabel text={body} />
          </div>
          {footerNeeded && (
            <div className="space-y-0.5 px-1">
              {/* G5 wants this quiet, but the footer text is real content the
                  sender must read — stone-400 was 2.48:1. muted-foreground is
                  quiet yet clears AA (4.61:1 light / 7.63:1 dark). */}
              <p className="text-[13px] text-muted-foreground">{footerText}</p>
              <p className="text-[11px] text-muted-foreground">
                Added to your first message to this contact
              </p>
            </div>
          )}
        </div>

        {/* Consent attestation (D4) — mandatory. */}
        <div className="flex items-start gap-2">
          <Checkbox
            id="compose-consent"
            checked={consent}
            onCheckedChange={(checked) => setConsent(checked === true)}
          />
          <Label htmlFor="compose-consent" className="font-normal leading-snug">
            This customer asked us to text them
          </Label>
        </div>

        {banner && <ComposerBannerCard banner={banner} />}

        <div className="flex items-center justify-end gap-2">
          <Button
            onClick={() => submit(false)}
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
                submit(true);
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
