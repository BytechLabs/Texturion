"use client";

import { Ban, Check, ChevronDown, Copy, Plus, Sparkles, Undo2, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import { contactRelationshipLine , avatarInitials } from "@loonext/shared";

import { CallButton } from "@/components/calls/call-button";
import { SECTION_LABEL_CLASS } from "@/components/ui/section-label";
import { useMemberNames } from "@/components/inbox/member-avatar";
import { StatusPill } from "@/components/inbox/status-pill";
import { avatarColorClass } from "@/components/shell/avatar-color";
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
import {
  RecordHeader,
  RecordOpenLink,
  RecordSection,
} from "@/components/ui/record-header";
import { Skeleton } from "@/components/ui/skeleton";
import { useT, type Translate } from "@/i18n/provider";
import { useOptOutContact, useRevokeOptOut } from "@/lib/api/contacts";
import {
  useAttachTag,
  useConversations,
  useDetachTag,
} from "@/lib/api/conversations";
import { LeadSourcePicker } from "@/components/contact-panel/lead-source-picker";
import { ApiError } from "@/lib/api/error";
import { roleHasCapability, suggestExistingTag } from "@loonext/shared";
import { useCompany } from "@/lib/api/companies";
import { useActiveCompany } from "@/lib/company/provider";
import { activeSources, useLeadSources } from "@/lib/api/lead-sources";
import { useTags } from "@/lib/api/tags";
import { useConversationTasks } from "@/lib/api/tasks";
import { flattenPages } from "@/lib/api/pagination";
import { isCarrierEnforcedOptOut } from "@/lib/api/types";
import type { ConversationDetail, ContactDetail } from "@/lib/api/types";
import { contactDisplayName, formatPhone } from "@/lib/format/phone";
import { Timestamp } from "@/components/ui/timestamp";
import { formatTimestamp } from "@/lib/format/time";
import { cn } from "@/lib/utils";

import { ContactLanguage, useContactLanguageLabel } from "./contact-language";
import { AutoSaveNotes, InlineTextField } from "./inline-field";
import { TasksChecklist } from "./tasks-checklist";
import { ActivityTimeline } from "@/components/activity/activity-timeline";
import { LinkedTasks } from "@/components/tasks/linked-tasks";

function onApiError(error: unknown, fallback: string) {
  toast.error(error instanceof ApiError ? error.message : fallback);
}

/** Consent status line (D3/D4): who consented, how, when — plain language. */
function consentLine(
  contact: ContactDetail,
  memberName: (id: string | null) => string | null,
  t: Translate,
): string {
  if (contact.consent_source === "inbound_sms") {
    return contact.consent_at
      ? t("contacts.consentTextedFirstOn", {
          date: formatTimestamp(contact.consent_at, { style: "long", t }),
        })
      : t("contacts.consentTextedFirst");
  }
  if (contact.consent_source === "attested") {
    const by = memberName(contact.consent_attested_by) ?? t("contacts.aTeammate");
    return contact.consent_at
      ? t("contacts.consentRecordedByOn", {
          name: by,
          date: formatTimestamp(contact.consent_at, { style: "long", t }),
        })
      : t("contacts.consentRecordedBy", { name: by });
  }
  return t("contacts.consentNone");
}

/**
 * The context panel (APP-LAYOUT-V2 §1.5) as one surface (#717): a
 * header (who, their number, how long they have been a customer) with an
 * action row that calls, copies and opens the contact, then one section style
 * for Details, Consent, Tasks, Tags and Conversations, and the rarely-changed
 * settings folded into Preferences. Default-closed and toggled from the thread
 * header.
 */
export function ContactPanel({
  conversation,
  contact,
  contactPending,
  onOpenGallery,
  active = true,
  variant = "panel",
}: {
  conversation: ConversationDetail;
  contact: ContactDetail | undefined;
  contactPending: boolean;
  /** Open the attachments gallery (§5.2 single entry point). */
  onOpenGallery: () => void;
  /** The panel is actually visible — gates the lazy attachments preview fetch. */
  active?: boolean;
  /** #119: "sheet" is the phone's bottom sheet, whose own close button sits
   * over the header's right edge; "panel" is the desktop drawer. */
  variant?: "panel" | "sheet";
}) {
  const t = useT();
  const memberNames = useMemberNames();
  const [copied, setCopied] = useState(false);
  const [confirmOptOut, setConfirmOptOut] = useState(false);
  const optOut = useOptOutContact();
  const revoke = useRevokeOptOut();
  const leadSources = useLeadSources();
  const checklist = useConversationTasks(conversation.id, { enabled: active });

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
          {t("contacts.contactLoadFailed")}
        </p>
      </div>
    );
  }

  const phone = formatPhone(contact.phone_e164);
  const memberName = (id: string | null) =>
    id ? memberNames.get(id) ?? t("contacts.aTeammate") : null;
  // #301: an unanswered source stays out in the open as the one-tap ask; once
  // answered it is a setting, and joins Preferences.
  const asksForSource =
    activeSources(leadSources.data?.data).length > 0 &&
    conversation.lead_source_id === null;

  const copyNumber = async () => {
    try {
      await navigator.clipboard.writeText(phone);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable — number stays selectable.
    }
  };

  const relationship = contactRelationshipLine(
    contact.conversation_count,
    contact.first_conversation_at,
    t,
  );

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto">
      <RecordHeader
        // pr-12 keeps the sheet's header clear of the sheet's own close button.
        className={cn(
          "border-b border-app-line-soft p-4",
          variant === "sheet" && "pr-12",
        )}
        leading={
          <span
            aria-hidden
            className={cn(
              "grid size-11 shrink-0 place-items-center rounded-[14px] text-[15px] font-bold text-app-olive-deep",
              avatarColorClass(contact.id),
            )}
          >
            {avatarInitials(contactDisplayName(contact))}
          </span>
        }
        title={
          <InlineTextField
            contactId={contact.id}
            field="name"
            value={contact.name}
            label={t("contacts.contactNameLabel")}
            placeholder={t("contacts.addName")}
            className="text-[15px] font-semibold"
          />
        }
        meta={
          <>
            <p className="select-all whitespace-nowrap px-2 text-sm tabular-nums text-muted-foreground">
              {phone}
            </p>
            {/* #410: how long they have been a customer, and how often. */}
            {relationship !== null && (
              <p className="px-2 text-[13px] text-muted-foreground">
                {relationship}
              </p>
            )}
          </>
        }
        actions={
          <>
            <CallButton
              conversationId={conversation.id}
              contactName={contactDisplayName(contact)}
              label={t("shell.call")}
              variant="outline"
            />
            <Button variant="outline" size="sm" onClick={copyNumber}>
              {copied ? (
                <Check className="text-success" strokeWidth={1.75} aria-hidden />
              ) : (
                <Copy strokeWidth={1.75} aria-hidden />
              )}
              {t(copied ? "contacts.numberCopied" : "contacts.copyNumber")}
            </Button>
            <RecordOpenLink
              href={`/contacts/${contact.id}`}
              label={t("contacts.openContact")}
            />
          </>
        }
      />
      <div className="space-y-5 p-4">
        <RecordSection label={t("contacts.detailsGroup")}>
          <div className="space-y-1">
            <InlineTextField
              contactId={contact.id}
              field="address"
              value={contact.address}
              label={t("contacts.contactAddressLabel")}
              placeholder={t("contacts.addAddress")}
              wrap
            />
            <AutoSaveNotes contactId={contact.id} value={contact.notes} />
          </div>
        </RecordSection>

        {/* Consent history (D3/D4), actionable only when they are opted out. */}
        <RecordSection label={t("contacts.consentGroup")}>
          <p className="px-2 text-[13px] text-muted-foreground">
            {consentLine(contact, memberName, t)}
          </p>
          {contact.opted_out && (
            <div className="flex flex-wrap items-center gap-2 px-2 pt-1.5">
              <Badge variant="destructive">{t("contacts.optedOut")}</Badge>
              {/* #407: a STOP the customer sent is a carrier block that only
                  they can lift, so it gets an explanation instead of a
                  button. */}
              {isCarrierEnforcedOptOut(contact.opt_out_source) ? (
                <p className="basis-full text-xs text-muted-foreground">
                  {t("contacts.carrierOptOutNote")}
                </p>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={revoke.isPending}
                  onClick={() =>
                    revoke.mutate(contact.id, {
                      onSuccess: () =>
                        toast.success(t("contacts.optedInAgain")),
                      onError: (e) =>
                        onApiError(e, t("contacts.optOutUpdateFailed")),
                    })
                  }
                >
                  <Undo2 strokeWidth={1.75} aria-hidden />
                  {revoke.isPending
                    ? t("contacts.working")
                    : t("contacts.markOptedIn")}
                </Button>
              )}
            </div>
          )}
        </RecordSection>

        {/* Tasks checklist (D17/TASKS.md T5.2). `active` gates the fetch to
            when the panel is open. */}
        <RecordSection label={t("contacts.tasksGroup")}>
          <div className="space-y-3 px-2">
            <TasksChecklist conversationId={conversation.id} active={active} />
            <LinkedTasks
              kind="conversation"
              id={conversation.id}
              active={active}
              shownElsewhere={checklist.data?.data.map((task) => task.id)}
            />
          </div>
        </RecordSection>

        {/* §5.2: the one entry point to the gallery. Renders nothing while
            empty. */}
        <AttachmentsClump
          conversationId={conversation.id}
          onOpenGallery={onOpenGallery}
          enabled={active}
        />

        {asksForSource && (
          <RecordSection label={t("contacts.leadSourceGroup")}>
            <div className="px-2">
              <LeadSourcePicker conversation={conversation} />
            </div>
          </RecordSection>
        )}

        <RecordSection label={t("contacts.tagsGroup")}>
          <ConversationTags conversation={conversation} />
        </RecordSection>

        <RecordSection label={t("contacts.conversationsGroup")}>
          <PriorConversations
            phoneE164={contact.phone_e164}
            currentConversationId={conversation.id}
          />
        </RecordSection>

        {/* #714: this thread's own activity: texts, calls, assignments, tags,
            status, opt-outs and scheduled texts. Fetched only while the panel
            is open. */}
        {active && (
          <RecordSection label={t("activity.heading")}>
            <div className="px-2">
              <ActivityTimeline
                recordType="conversation"
                recordId={conversation.id}
                compact
                hideHeading
              />
            </div>
          </RecordSection>
        )}

        <Preferences
          contact={contact}
          conversation={conversation}
          withSource={!asksForSource}
        />
      </div>

      {/* §3.3 quiet danger zone: opting out is routine and reversible, so the
          trigger is neutral at rest and the confirm dialog guards the action. */}
      {!contact.opted_out && (
        <div className="mt-auto border-t border-app-line p-4">
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-destructive"
            onClick={() => setConfirmOptOut(true)}
          >
            <Ban strokeWidth={1.75} aria-hidden />
            {t("contacts.optOutAction")}
          </Button>
        </div>
      )}

      <Dialog open={confirmOptOut} onOpenChange={setConfirmOptOut}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {t("contacts.optOutTitle", {
                name: contactDisplayName(contact),
              })}
            </DialogTitle>
            <DialogDescription>
              {t("contacts.optOutConfirmBody")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOptOut(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={optOut.isPending}
              onClick={() =>
                optOut.mutate(contact.id, {
                  onSuccess: () => {
                    setConfirmOptOut(false);
                    toast.success(t("contacts.contactOptedOut"));
                  },
                  onError: (e) => onApiError(e, t("contacts.optOutFailed")),
                })
              }
            >
              {optOut.isPending
                ? t("contacts.optingOut")
                : t("contacts.optOut")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * #717: the settings a crew sets once per customer, if ever, folded into one
 * row that says what they are set to and opens on demand.
 */
function Preferences({
  contact,
  conversation,
  withSource,
}: {
  contact: ContactDetail;
  conversation: ConversationDetail;
  /** The source is answered, so it is a setting rather than an ask. */
  withSource: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const language = useContactLanguageLabel(contact.locale);
  const sources = useLeadSources();
  const source = withSource
    ? (sources.data?.data ?? []).find(
        (row) => row.id === conversation.lead_source_id,
      )?.name
    : undefined;
  const summary = [language, source].filter(Boolean).join(" · ");

  return (
    <section aria-label={t("contacts.preferencesGroup")} className="space-y-1.5">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left transition-colors duration-150 ease-out hover:bg-app-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className={cn(SECTION_LABEL_CLASS, "shrink-0")}>
          {t("contacts.preferencesGroup")}
        </span>
        <span className="min-w-0 flex-1 truncate text-right text-[12px] text-muted-foreground">
          {summary}
        </span>
        <ChevronDown
          className={cn(
            "size-3.5 shrink-0 text-app-muted-2 transition-transform duration-150",
            open && "rotate-180",
          )}
          strokeWidth={1.75}
          aria-hidden
        />
      </button>
      {open && (
        <div className="space-y-4 px-2 pt-1">
          <div className="space-y-1.5">
            <p className="text-[12px] font-medium text-app-ink">
              {t("contacts.languageGroup")}
            </p>
            <ContactLanguage contact={contact} />
          </div>
          {withSource && (
            <div className="space-y-1.5">
              <p className="text-[12px] font-medium text-app-ink">
                {t("contacts.leadSourceGroup")}
              </p>
              <LeadSourcePicker conversation={conversation} />
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function ConversationTags({
  conversation,
}: {
  conversation: ConversationDetail;
}) {
  const t = useT();
  const attach = useAttachTag(conversation.id);
  const detach = useDetachTag(conversation.id);
  const tags = useTags();
  const company = useCompany();
  const { role } = useActiveCompany();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const attached = conversation.tags;
  const available = (tags.data?.data ?? []).filter(
    (tag) => !attached.some((t) => t.id === tag.id),
  );
  const trimmed = query.trim();
  /**
   * #298 — the tag this typing probably means, if one already exists.
   *
   * Catching a near-duplicate at CREATION is worth more than any amount of
   * cleanup afterwards, because sprawl is invisible while it happens: each act
   * is reasonable on its own, a tech typing "warranty" instead of "Warranty",
   * and it only becomes visible once a filter has been quietly under-returning
   * for months.
   *
   * The list above is filtered by cmdk's own matcher, which does not know that
   * "quote-sent" and "Quote sent" are the same idea, or that "warrenty" is a
   * typo. This does.
   */
  const suggestion = suggestExistingTag(trimmed, tags.data?.data ?? []);
  const suggested =
    suggestion && !attached.some((t) => t.id === suggestion.tag.id)
      ? suggestion
      : null;
  // An EXACT normalised match cannot be created: the find-or-create RPC keys on
  // lower(name) and would hand back the existing tag anyway. Offering "Create"
  // there is offering something that does not happen.
  const exactExists = suggestion?.exact === true;
  /**
   * #298 — a locked workspace hides Create rather than failing it.
   *
   * The server refuses either way (api_find_or_create_tag holds the lock and
   * the existence check in one statement), so this is not the gate. It is the
   * difference between an affordance that is absent and one that says no after
   * you have typed the name — and being told no is exactly what sends somebody
   * to the notes field instead. Every existing tag is still one tap away.
   */
  const mayCreate =
    company.data?.tags_locked !== true ||
    roleHasCapability(role, "settings.manage");

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
                onError: (e) => onApiError(e, t("contacts.tagRemoveFailed")),
              })
            }
            aria-label={t("contacts.removeTag", { name: tag.name })}
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
            aria-label={t("contacts.addTag")}
            className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors duration-150 ease-out hover:text-foreground"
          >
            <Plus className="size-3" strokeWidth={1.75} aria-hidden />
            {t("contacts.tagChip")}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-56 p-0">
          <Command>
            <CommandInput
              placeholder={t("contacts.tagSearchPlaceholder")}
              value={query}
              onValueChange={setQuery}
            />
            <CommandList>
              <CommandEmpty>
                {/* #298: the placeholder has to be true. A locked workspace
                    can search this list but not add to it, and inviting a
                    member to "create" one is an offer we would then refuse. */}
                {trimmed === ""
                  ? t(
                      mayCreate
                        ? "contacts.typeToCreateTag"
                        : "contacts.typeToFindTag",
                    )
                  : !mayCreate
                    ? t("contacts.noTagAskAdmin")
                    : null}
              </CommandEmpty>
              <CommandGroup>
                {available.map((tag) => (
                  <CommandItem
                    key={tag.id}
                    value={tag.name}
                    onSelect={() => {
                      attach.mutate(
                        { tag_id: tag.id },
                        {
                          onError: (e) =>
                            onApiError(e, t("contacts.tagAddFailed")),
                        },
                      );
                      setOpen(false);
                    }}
                  >
                    {/* #298: what it means, under what it is called. This is
                        the moment somebody picks between two similar tags, and
                        a description written anywhere else is a description
                        nobody reads. */}
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate">{tag.name}</span>
                      {tag.description != null && tag.description !== "" && (
                        <span className="truncate text-[11px] text-muted-foreground">
                          {tag.description}
                        </span>
                      )}
                    </span>
                  </CommandItem>
                ))}
                {/* #298: the existing tag comes FIRST, and it says why it is
                    being offered. A prompt that just reorders the list teaches
                    nothing; one that names the near-duplicate is how somebody
                    stops making it. */}
                {suggested && !suggested.exact && (
                  <CommandItem
                    value={`suggest-${suggested.tag.id}`}
                    onSelect={() => {
                      attach.mutate(
                        { tag_id: suggested.tag.id },
                        {
                          onError: (e) =>
                            onApiError(e, t("contacts.tagAddFailed")),
                        },
                      );
                      setOpen(false);
                    }}
                  >
                    <Sparkles className="size-3.5" strokeWidth={1.75} />
                    {t("contacts.didYouMean", { name: suggested.tag.name })}
                  </CommandItem>
                )}
                {trimmed !== "" && !exactExists && mayCreate && (
                  <CommandItem
                    value={`create-${trimmed}`}
                    onSelect={() => {
                      attach.mutate(
                        { name: trimmed },
                        {
                          onError: (e) =>
                            onApiError(e, t("contacts.tagCreateFailed")),
                        },
                      );
                      setOpen(false);
                    }}
                  >
                    <Plus className="size-3.5" strokeWidth={1.75} />
                    {t("contacts.createTag", { name: trimmed })}
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
  const t = useT();
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
        {t("contacts.priorConversationsFailed")}
      </p>
    );
  }
  if (rows.length === 0) {
    return (
      <p className="px-2 text-[13px] text-muted-foreground">
        {t("contacts.noPriorConversations")}
      </p>
    );
  }

  return (
    <ul className="space-y-0.5">
      {rows.map((row) => (
        <li key={row.id}>
          <Link
            href={`/inbox/${row.id}`}
            className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 transition-colors duration-150 ease-out hover:bg-app-hover"
          >
            <span className="flex items-center gap-2">
              <StatusPill status={row.status} />
              <Timestamp
                at={row.last_message_at}
                style="short"
                className="text-[13px] text-muted-foreground"
              />
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
