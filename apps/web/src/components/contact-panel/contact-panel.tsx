"use client";

import { format } from "date-fns";
import { Ban, Check, Copy, Plus, Undo2, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import { useMemberNames } from "@/components/inbox/member-avatar";
import { StatusPill } from "@/components/inbox/status-pill";
import { avatarColorClass, avatarInitials } from "@/components/shell/avatar-color";
import { AttachmentsClump } from "@/components/thread/attachments-gallery";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { useOptOutContact, useRevokeOptOut } from "@/lib/api/contacts";
import {
  useAttachTag,
  useConversations,
  useDetachTag,
} from "@/lib/api/conversations";
import { ApiError } from "@/lib/api/error";
import { useTags } from "@/lib/api/tags";
import { flattenPages } from "@/lib/api/pagination";
import type { ConversationDetail, ContactDetail } from "@/lib/api/types";
import { contactDisplayName, formatPhone } from "@/lib/format/phone";
import { formatAbsoluteDateTime, formatRelativeTime } from "@/lib/format/time";
import { cn } from "@/lib/utils";

import { AutoSaveNotes, InlineTextField } from "./inline-field";
import { TasksChecklist } from "./tasks-checklist";

function onApiError(error: unknown, fallback: string) {
  toast.error(error instanceof ApiError ? error.message : fallback);
}

/** An elevated section card (mockup .panel): a white card with the panel shadow
 * and a bold section head, holding the section's content. Reserved for the
 * things people act on — Tasks and Attachments — so weight tracks importance. */
function PanelSection({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-app-card border border-app-line bg-app-white p-3.5">
      <h3 className="mb-2.5 text-[13px] font-bold text-app-ink">{label}</h3>
      {children}
    </section>
  );
}

/**
 * The QUIET tier (#6 declutter): look-up-occasionally metadata (Consent, Tags,
 * prior Conversations) gets no card chrome — just a small uppercase label over
 * its content. Two label weights (bold-card vs quiet-uppercase) replace the old
 * six-identical-cards monotony, so the eye lands on identity + actions first.
 */
function QuietGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="mb-1.5 px-2 text-[11px] font-semibold uppercase tracking-wide text-app-muted-2">
        {label}
      </h3>
      {children}
    </section>
  );
}

/** Consent status line (D3/D4): who consented, how, when — plain language. */
function consentLine(
  contact: ContactDetail,
  memberName: (id: string | null) => string | null,
): string {
  if (contact.consent_source === "inbound_sms") {
    return contact.consent_at
      ? `Texted you first · ${format(new Date(contact.consent_at), "MMM d")}`
      : "Texted you first";
  }
  if (contact.consent_source === "attested") {
    const by = memberName(contact.consent_attested_by) ?? "a teammate";
    return contact.consent_at
      ? `Consent recorded by ${by} · ${format(new Date(contact.consent_at), "MMM d")}`
      : `Consent recorded by ${by}`;
  }
  return "No consent recorded yet";
}

/**
 * The context panel (APP-LAYOUT-V2 §1.5 — Missive-style Details, trimmed to the
 * calm core), tiered for personality + scannability (#6): an IDENTITY card
 * (app-ava avatar + inline-edit name + number+copy + address + notes) · a quiet
 * Consent group (actionable only when opted-out) · a Tasks-checklist card · the
 * AttachmentsClump card (an iMessage-style grid that opens the single gallery
 * surface, §5.2 — one entry point, never a second gallery) · a quiet Tags group
 * · a quiet prior-Conversations group · a quiet opt-out danger zone.
 * Default-closed and toggled from the thread header.
 */
export function ContactPanel({
  conversation,
  contact,
  contactPending,
  onOpenGallery,
  active = true,
}: {
  conversation: ConversationDetail;
  contact: ContactDetail | undefined;
  contactPending: boolean;
  /** Open the attachments gallery (§5.2 single entry point). */
  onOpenGallery: () => void;
  /** The panel is actually visible — gates the lazy attachments preview fetch. */
  active?: boolean;
}) {
  const memberNames = useMemberNames();
  const [copied, setCopied] = useState(false);
  const [confirmOptOut, setConfirmOptOut] = useState(false);
  const optOut = useOptOutContact();
  const revoke = useRevokeOptOut();

  if (contactPending) {
    return (
      <div className="space-y-4 p-5" aria-hidden>
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-3 w-48" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  if (!contact) {
    return (
      <div className="p-5">
        <p className="text-sm text-muted-foreground">
          Couldn&apos;t load this contact.
        </p>
      </div>
    );
  }

  const phone = formatPhone(contact.phone_e164);
  const memberName = (id: string | null) =>
    id ? memberNames.get(id) ?? "a teammate" : null;

  const copyNumber = async () => {
    try {
      await navigator.clipboard.writeText(phone);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable — number stays selectable.
    }
  };

  return (
    // §1.5 / #6: a CALM, TIERED surface. Weight tracks importance: an identity
    // card (avatar + name + number + address + notes) and two action cards
    // (Tasks, Attachments) carry card chrome; look-up metadata (Consent, Tags,
    // Conversations) is a quiet uppercase-label group. Two label weights, not
    // six identical cards — the eye lands on who-this-is first. Progressive
    // disclosure: the thread stays the hero; this detail lives in the panel.
    <div className="flex h-full min-h-0 flex-col overflow-y-auto">
      <div className="space-y-5 p-4">
        {/* IDENTITY — the panel's one anchor of personality (#6): a colored
            app-ava avatar + the editable name and number up top, then address
            and notes under a hairline. Who this is, in one card. */}
        <section className="rounded-app-card border border-app-line bg-app-white p-3.5">
          <div className="flex items-start gap-3">
            <span
              aria-hidden
              className={cn(
                "grid size-11 shrink-0 place-items-center rounded-[14px] text-[15px] font-bold text-app-petrol-deep",
                avatarColorClass(contact.id),
              )}
            >
              {avatarInitials(contactDisplayName(contact))}
            </span>
            <div className="min-w-0 flex-1">
              <InlineTextField
                contactId={contact.id}
                field="name"
                value={contact.name}
                label="Contact name"
                placeholder="Add a name"
                className="text-[15px] font-semibold"
              />
              <div className="flex items-center gap-1 px-2">
                <span className="select-all text-sm tabular-nums text-muted-foreground">
                  {phone}
                </span>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={copyNumber}
                  aria-label={copied ? "Number copied" : "Copy number"}
                >
                  {copied ? (
                    <Check className="size-3 text-success" strokeWidth={1.75} />
                  ) : (
                    <Copy className="size-3" strokeWidth={1.75} />
                  )}
                </Button>
              </div>
            </div>
          </div>
          <div className="mt-3 space-y-1 border-t border-app-line-soft pt-3">
            <InlineTextField
              contactId={contact.id}
              field="address"
              value={contact.address}
              label="Contact address"
              placeholder="Add an address"
            />
            <div className="px-2">
              <AutoSaveNotes contactId={contact.id} value={contact.notes} />
            </div>
          </div>
        </section>

        {/* Consent history (D3/D4) — quiet metadata about the person, unless
            they're opted out (then it carries the actionable revoke). */}
        <QuietGroup label="Consent">
          <p className="px-2 text-[13px] text-muted-foreground">
            {consentLine(contact, memberName)}
          </p>
          {contact.opted_out && (
            <div className="flex items-center gap-2 px-2 pt-1.5">
              <Badge variant="destructive">Opted out</Badge>
              <button
                type="button"
                onClick={() =>
                  revoke.mutate(contact.id, {
                    onSuccess: () => toast.success("Marked opted in again."),
                    onError: (e) => onApiError(e, "Couldn't update opt-out."),
                  })
                }
                disabled={revoke.isPending}
                className="inline-flex items-center gap-1 text-[13px] font-medium text-primary underline-offset-2 hover:underline disabled:opacity-50"
              >
                <Undo2 className="size-3" strokeWidth={1.75} aria-hidden />
                Mark opted in again
              </button>
            </div>
          )}
        </QuietGroup>

        {/* Tasks checklist (D17/TASKS.md T5.2) — an action surface, so it keeps
            card weight. Checking a row calls the source message's PATCH
            /v1/messages/:id {done} (derived completion, T2), striking the
            message through in the thread via the one message.status broadcast.
            `active` gates the fetch to when the panel is open. */}
        <PanelSection label="Tasks">
          <TasksChecklist conversationId={conversation.id} active={active} />
        </PanelSection>

        {/* §1.5 / §5.2: the attachments clump — a titled card of recent thumbs
            that opens the single gallery surface (one entry point, never a
            second gallery). Renders nothing while empty. */}
        <AttachmentsClump
          conversationId={conversation.id}
          onOpenGallery={onOpenGallery}
          enabled={active}
        />

        {/* Tags on this conversation — quiet. */}
        <QuietGroup label="Tags">
          <ConversationTags conversation={conversation} />
        </QuietGroup>

        {/* Prior conversations with this contact — quiet. */}
        <QuietGroup label="Conversations">
          <PriorConversations
            phoneE164={contact.phone_e164}
            currentConversationId={conversation.id}
          />
        </QuietGroup>
      </div>

      {/* §3.3 quiet danger zone: opting out is routine and reversible, so it
          sits alone, neutral (stone-500) until hovered — no red scare-styling.
          The confirm dialog still guards the actual action. */}
      {!contact.opted_out && (
        <div className="mt-auto border-t border-app-line p-4">
          <button
            type="button"
            onClick={() => setConfirmOptOut(true)}
            className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground transition-colors duration-150 ease-out hover:text-foreground"
          >
            <Ban className="size-3.5" strokeWidth={1.75} aria-hidden />
            Opt out this contact
          </button>
        </div>
      )}

      <Dialog open={confirmOptOut} onOpenChange={setConfirmOptOut}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Opt out {contactDisplayName(contact)}?</DialogTitle>
            <DialogDescription>
              They won&apos;t receive texts from you anymore. Use this when a
              customer asks to stop hearing from you in any words.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOptOut(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={optOut.isPending}
              onClick={() =>
                optOut.mutate(contact.id, {
                  onSuccess: () => {
                    setConfirmOptOut(false);
                    toast.success("Contact opted out.");
                  },
                  onError: (e) => onApiError(e, "Couldn't opt out the contact."),
                })
              }
            >
              {optOut.isPending ? "Opting out…" : "Opt out"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ConversationTags({
  conversation,
}: {
  conversation: ConversationDetail;
}) {
  const attach = useAttachTag(conversation.id);
  const detach = useDetachTag(conversation.id);
  const tags = useTags();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const attached = conversation.tags;
  const available = (tags.data?.data ?? []).filter(
    (tag) => !attached.some((t) => t.id === tag.id),
  );
  const trimmed = query.trim();
  const exactExists = (tags.data?.data ?? []).some(
    (tag) => tag.name.toLowerCase() === trimmed.toLowerCase(),
  );

  return (
    <div className="flex flex-wrap items-center gap-1.5 px-2">
      {attached.map((tag) => (
        <span
          key={tag.id}
          className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-secondary-foreground"
        >
          {tag.name}
          <button
            type="button"
            onClick={() =>
              detach.mutate(tag.id, {
                onError: (e) => onApiError(e, "Couldn't remove the tag."),
              })
            }
            aria-label={`Remove tag ${tag.name}`}
            className="rounded-full p-0.5 hover:bg-background"
          >
            <X className="size-3" strokeWidth={1.75} />
          </button>
        </span>
      ))}
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setQuery("");
        }}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="Add a tag"
            className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors duration-150 ease-out hover:text-foreground"
          >
            <Plus className="size-3" strokeWidth={1.75} aria-hidden />
            Tag
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-56 p-0">
          <Command>
            <CommandInput
              placeholder="Find or create a tag…"
              value={query}
              onValueChange={setQuery}
            />
            <CommandList>
              <CommandEmpty>
                {trimmed === "" ? "Type to create a tag." : null}
              </CommandEmpty>
              <CommandGroup>
                {available.map((tag) => (
                  <CommandItem
                    key={tag.id}
                    value={tag.name}
                    onSelect={() => {
                      attach.mutate(
                        { tag_id: tag.id },
                        { onError: (e) => onApiError(e, "Couldn't add the tag.") },
                      );
                      setOpen(false);
                    }}
                  >
                    {tag.name}
                  </CommandItem>
                ))}
                {trimmed !== "" && !exactExists && (
                  <CommandItem
                    value={`create-${trimmed}`}
                    onSelect={() => {
                      attach.mutate(
                        { name: trimmed },
                        { onError: (e) => onApiError(e, "Couldn't create the tag.") },
                      );
                      setOpen(false);
                    }}
                  >
                    <Plus className="size-3.5" strokeWidth={1.75} />
                    Create “{trimmed}”
                  </CommandItem>
                )}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}

/**
 * Prior conversations for the contact (G6): the list endpoint's `q` matches
 * the contact's phone exactly (api_list_conversations trgm ilike), which is
 * unique per company — an honest "conversations with this number" query.
 */
function PriorConversations({
  phoneE164,
  currentConversationId,
}: {
  phoneE164: string;
  currentConversationId: string;
}) {
  const conversations = useConversations({ q: phoneE164 });
  const rows = flattenPages(conversations.data).filter(
    (row) => row.id !== currentConversationId,
  );

  if (conversations.isPending) {
    return (
      <div className="space-y-2 px-2" aria-hidden>
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    );
  }
  if (conversations.isError) {
    return (
      <p className="px-2 text-[13px] text-muted-foreground">
        Couldn&apos;t load prior conversations.
      </p>
    );
  }
  if (rows.length === 0) {
    return (
      <p className="px-2 text-[13px] text-muted-foreground">
        No other conversations with this contact.
      </p>
    );
  }

  return (
    <ul className="space-y-0.5">
      {rows.map((row) => (
        <li key={row.id}>
          <Link
            href={`/inbox/${row.id}`}
            className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 transition-colors duration-150 ease-out hover:bg-secondary/60"
          >
            <span className="flex items-center gap-2">
              <StatusPill status={row.status} />
              <span
                className="text-[13px] text-muted-foreground"
                title={formatAbsoluteDateTime(row.last_message_at)}
              >
                {formatRelativeTime(row.last_message_at)}
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
