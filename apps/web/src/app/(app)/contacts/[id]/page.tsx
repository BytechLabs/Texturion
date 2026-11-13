"use client";

import { ChevronLeft, Clock, Copy, Plus, SquarePen } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { use, useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { isCarrierEnforcedOptOut } from "@/lib/api/types";

import {
  BlockNumberDialog,
  useBlockedNumber,
} from "@/components/blocked/block-number";
import { CallButton } from "@/components/calls/call-button";
import { NewTaskButton } from "@/components/tasks/new-task";
import { ContactLanguage } from "@/components/contact-panel/contact-language";
import { AddressList } from "@/components/contacts/address-list";
import { PhoneList } from "@/components/contacts/phone-list";
import { ExportHistory } from "@/components/contacts/export-history";
import { ContactCustomFields } from "@/components/contacts/custom-fields";
import { ContactHistory } from "@/components/contacts/contact-history";
import {
  CONTACT_PANES,
  PHONE_ACTIVITY_PANES,
  emptyDetailFields,
  paneOf,
  parseContactTab,
  phoneTabOf,
  type ContactPane,
  type ContactTab,
  type DetailField,
  type PhoneTab,
} from "@/components/contacts/contact-tabs";
import { ContactTags } from "@/components/contacts/contact-tags";
import { MergedFrom } from "@/components/contacts/merged-from";
import { SettingsCard } from "@/components/settings/section";
import { LoadError } from "@/components/ui/load-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RecordHeader } from "@/components/ui/record-header";
import { RecordOverflowMenu } from "@/components/ui/record-menu";
import { useContactActions } from "@/components/contacts/contact-record-actions";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchablePicker } from "@/components/ui/searchable-picker";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/i18n/provider";
import {
  useContact,
  useDeleteContact,
  useOptOutContact,
  useRevokeOptOut,
  useUpdateContact,
  type ContactPatch,
} from "@/lib/api/contacts";
import { useConversations } from "@/lib/api/conversations";
import { ApiError } from "@/lib/api/error";
import { flattenPages } from "@/lib/api/pagination";
import { useRecordActivity } from "@/lib/api/record-activity";
import { useMembers } from "@/lib/api/team";
import type { ContactDetail } from "@/lib/api/types";
import { contactDisplayName, formatPhone } from "@/lib/format/phone";
import { cn } from "@/lib/utils";
import {
  useDebouncedAutosave,
  type AutosaveState,
} from "@/lib/hooks/use-debounced-autosave";
import { useCanDeleteRecords } from "@/lib/hooks/use-records-delete";
import { formatTimestamp } from "@/lib/format/time";
import { updateSearch } from "@/lib/url/search-state";
import { NANP_TIMEZONES } from "@loonext/shared";

/**
 * Auto-saving field (G6: name inline-editable, notes auto-saving). Saves
 * 800ms after the last keystroke, on blur, and when you leave the page; the
 * status line is aria-live so screen readers hear "Saved".
 */
function useAutosave(
  contactId: string,
  key: "name" | "address" | "notes" | "email" | "business_name",
  value: string,
) {
  const update = useUpdateContact(contactId);
  const field = useDebouncedAutosave({
    value,
    normalize: (draft) => draft.trim(),
    save: (next) => {
      const patch: ContactPatch = { [key]: next === "" ? null : next };
      return update.mutateAsync(patch);
    },
  });
  return {
    value: field.draft,
    onChange: field.setDraft,
    onBlur: field.onBlur,
    state: field.state,
    error: field.error,
  };
}

function SaveStatus({
  state,
  error,
}: {
  state: AutosaveState;
  error: unknown;
}) {
  const t = useT();
  return (
    <p aria-live="polite" className="min-h-4 text-xs text-muted-foreground">
      {state === "saving" && t("common.saving")}
      {state === "saved" && t("common.saved")}
      {state === "error" && (
        <span className="text-destructive">
          {error instanceof ApiError
            ? error.message
            : t("appShell.contactSaveFailed")}
        </span>
      )}
    </p>
  );
}

function ConsentLine({ contact }: { contact: ContactDetail }) {
  const t = useT();
  const members = useMembers();
  if (!contact.consent_source) {
    return (
      <p className="text-sm text-muted-foreground">
        {t("appShell.contactNoConsent")}
      </p>
    );
  }
  const date = contact.consent_at
    ? formatTimestamp(contact.consent_at, { style: "long", t })
    : null;
  if (contact.consent_source === "inbound_sms") {
    return (
      <p className="text-sm">
        {t("appShell.contactConsentInbound")}
        {date ? ` · ${date}` : ""}
      </p>
    );
  }
  const attester = members.data?.data.find(
    (m) => m.user_id === contact.consent_attested_by,
  )?.display_name;
  return (
    <p className="text-sm">
      {attester
        ? t("appShell.contactConsentRecordedBy", { name: attester })
        : t("appShell.contactConsentRecorded")}
      {date ? ` · ${date}` : ""}
    </p>
  );
}

/**
 * #191: a quiet record-attribution caption — who added the contact, and who
 * last edited it if that was someone else. The API resolves the actor to a
 * company-member display name and returns null for contacts that predate
 * attribution, so this renders nothing rather than "Added by unknown".
 */
function RecordAttribution({ contact }: { contact: ContactDetail }) {
  const t = useT();
  const addedBy = contact.created_by_name?.trim();
  const editedBy = contact.updated_by_name?.trim();
  if (!addedBy && !editedBy) return null;
  const addedOn = new Date(contact.created_at).toLocaleDateString(t.locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  return (
    <div className="space-y-0.5 text-xs text-muted-foreground">
      {addedBy && (
        <p>{t("appShell.contactAddedBy", { name: addedBy, date: addedOn })}</p>
      )}
      {editedBy && editedBy !== addedBy && (
        <p>{t("appShell.contactEditedBy", { name: editedBy })}</p>
      )}
    </div>
  );
}

/**
 * #292/D49 — what time it is where this customer is, and the way to fix it
 * when the area code lies.
 *
 * A reading and a quiet correction, not a form field. The inference is right
 * for the large majority of contacts, so a 23-item picker sitting open in the
 * primary view would be permanent clutter earning its keep a few times a year.
 * It reveals on request instead, pre-filled with the zone currently in force —
 * never an empty select asking a dispatcher to work out the answer from
 * scratch.
 *
 * Applying: Zen of Clarity (advanced control stays folded), Progressive
 * Disclosure, Smart Defaults (the picker opens on the current answer).
 */
function DestinationClock({ contact }: { contact: ContactDetail }) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const update = useUpdateContact(contact.id);

  const reading = new Intl.DateTimeFormat(t.locale, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: contact.timezone_resolved,
  }).format(new Date());

  // Honest about the guess. "From their area code" is an inference a
  // dispatcher may know better than; "using your timezone" is us admitting we
  // do not know, which is the one they most need to see.
  const provenance =
    contact.timezone_source === "contact"
      ? t("appShell.contactClockSetByCrew")
      : contact.timezone_source === "area_code"
        ? t("appShell.contactClockFromAreaCode")
        : t("appShell.contactClockUnknown");

  function save(next: string | null) {
    update.mutate({ timezone: next } as ContactPatch, {
      onSuccess: () => {
        setEditing(false);
        toast.success(
          next
            ? t("appShell.contactTimezoneUpdated")
            : t("appShell.contactTimezoneReset"),
        );
      },
      onError: (cause) =>
        toast.error(
          cause instanceof ApiError
            ? cause.message
            : t("appShell.contactTimezoneSaveFailed"),
        ),
    });
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor="contact-timezone">{t("appShell.contactTheirTime")}</Label>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <p className="flex items-center gap-1.5 text-sm">
          <Clock
            className="size-4 text-muted-foreground"
            strokeWidth={1.75}
            aria-hidden
          />
          <span className="tabular-nums">{reading}</span>
        </p>
        <p className="text-xs text-muted-foreground">{provenance}</p>
        {!editing && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => setEditing(true)}
          >
            {t("appShell.contactClockChange")}
          </Button>
        )}
      </div>

      {editing && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <SearchablePicker
            id="contact-timezone"
            value={contact.timezone_resolved}
            onValueChange={(next) => save(next)}
            disabled={update.isPending}
            className="w-64"
            options={NANP_TIMEZONES.map((zone) => ({
              value: zone,
              label: zone.split("/").slice(1).join(" / ").replaceAll("_", " "),
            }))}
          />
          {contact.timezone && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-xs"
              disabled={update.isPending}
              onClick={() => save(null)}
            >
              {t("appShell.contactUseAreaCode")}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2 text-xs"
            disabled={update.isPending}
            onClick={() => setEditing(false)}
          >
            {t("common.cancel")}
          </Button>
        </div>
      )}
    </div>
  );
}

function ContactBody({ contact }: { contact: ContactDetail }) {
  const t = useT();
  const router = useRouter();
  const optOut = useOptOutContact();
  const revoke = useRevokeOptOut();
  const deleteContact = useDeleteContact();
  // #691: the server gates DELETE /contacts/:id on records.delete now.
  const canDelete = useCanDeleteRecords();

  // #82: the Message button is contextual — if this contact already has a
  // conversation, open it directly instead of the compose screen. (Compose
  // reuses the same thread on send, so the compose fallback is safe while this
  // loads or when there's no thread yet.)
  const conversations = useConversations({ q: contact.phone_e164 });
  const existingConversation = flattenPages(conversations.data)[0] ?? null;

  const name = useAutosave(contact.id, "name", contact.name ?? "");
  const businessName = useAutosave(
    contact.id,
    "business_name",
    contact.business_name ?? "",
  );
  const address = useAutosave(contact.id, "address", contact.address ?? "");
  const email = useAutosave(contact.id, "email", contact.email ?? "");
  const notes = useAutosave(contact.id, "notes", contact.notes ?? "");

  // #740: the page's tab lives in the URL, so a link can open one. A desktop
  // shows the details beside every tab; a phone shows one tab at a time.
  const searchParams = useSearchParams();
  const tab = parseContactTab(searchParams.get("tab"));
  function selectTab(next: ContactTab) {
    updateSearch((params) => {
      if (next === "details") params.delete("tab");
      else params.set("tab", next);
    });
  }
  const paneLabel: Record<ContactPane, string> = {
    activity: t("appShell.contactTabActivity"),
    conversations: t("appShell.contactTabConversations"),
    calls: t("appShell.contactTabCalls"),
    tasks: t("appShell.contactTabTasks"),
    files: t("appShell.contactTabFiles"),
  };
  const phoneTab = phoneTabOf(tab);
  const phoneTabs: { value: PhoneTab; label: string }[] = [
    { value: "details", label: t("appShell.contactTabDetails") },
    { value: "activity", label: paneLabel.activity },
    { value: "files", label: paneLabel.files },
  ];

  // #740: fields nobody has filled in sit behind "Add details". Decided when
  // the page opens, so clearing a field you are typing in does not make it
  // vanish under your cursor.
  const [initiallyEmpty] = useState<DetailField[]>(() =>
    emptyDetailFields(contact),
  );
  const [addingDetails, setAddingDetails] = useState(false);
  const emptyNow = emptyDetailFields(contact);
  const hidden = (field: DetailField) =>
    !addingDetails &&
    initiallyEmpty.includes(field) &&
    emptyNow.includes(field);
  const anyHidden = (["business", "address", "email", "notes"] as const).some(
    hidden,
  );

  const [confirmingOptOut, setConfirmingOptOut] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [confirmingBlock, setConfirmingBlock] = useState(false);
  const blockedNumber = useBlockedNumber(contact.phone_e164);
  // #712: the contact's one action list, the same one a list row's right-click
  // menu opens. The danger-zone buttons below keep their own explanations.
  const { actions: menuActions, dialogs: menuDialogs } = useContactActions({
    contact,
    onDeleted: () => router.push("/contacts"),
  });

  const named = Boolean(contact.name?.trim());
  const copyNumber = (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={t("appShell.contactCopyNumberAria")}
      onClick={() => {
        void navigator.clipboard.writeText(contact.phone_e164);
        toast.success(t("appShell.contactNumberCopied"));
      }}
    >
      <Copy strokeWidth={1.75} />
    </Button>
  );

  return (
    // #740: who they are on the left, what happened on the right. On a phone
    // the two columns are one: the header, then a control that picks Details,
    // Activity or Files.
    <div className="space-y-6 lg:grid lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:items-start lg:gap-8 lg:space-y-0">
      <div className="min-w-0 space-y-6">
        {/* #695: only when a record was folded into this one. */}
        <MergedFrom contact={contact} />
        <RecordHeader
          title={
            // The name leads, as in every list and on the phones; a contact
            // with no name is titled by its number.
            <div className="flex flex-wrap items-center gap-2">
              <p
                className={cn("text-xl font-medium", !named && "tabular-nums")}
              >
                {contactDisplayName(contact, t)}
              </p>
              {!named && copyNumber}
              {contact.opted_out && (
                <Badge
                  variant="outline"
                  className="border-destructive text-foreground"
                >
                  {t("appShell.contactOptedOutBadge")}
                </Badge>
              )}
              {blockedNumber.blocked && (
                <Badge variant="outline">
                  {t("blockedNumbers.blockedBadge")}
                </Badge>
              )}
            </div>
          }
          meta={
            named ? (
              <div className="flex items-center gap-1">
                <p className="text-sm text-app-muted tabular-nums">
                  {formatPhone(contact.phone_e164)}
                </p>
                {copyNumber}
              </div>
            ) : undefined
          }
          actions={
            <>
              {/* #73/#82: message this contact. Contextual — if a conversation already
                exists, open it; otherwise start one via the compose flow (which
                prefills the recipient from ?contact=). Opted-out contacts are gated
                honestly by the composer's own opt-out banner. */}
              {/* #135: call ANY contact — including a fresh import you've never
                texted. From an existing thread (its number presents as caller ID)
                or straight from the contact (the server resolves the business
                number; threading creates the conversation on answer). Opted-out
                contacts stay callable (STOP is SMS consent — a requested callback
                may be the only channel). #106 note-level members get the API's
                honest error — the list row carries no viewer level to gate
                client-side. */}
              <CallButton
                conversationId={existingConversation?.id}
                contactId={existingConversation ? undefined : contact.id}
                contactName={
                  contact.name?.trim() || formatPhone(contact.phone_e164)
                }
                label={t("shell.call")}
                variant="outline"
              />
              <NewTaskButton
                context={{
                  contactId: contact.id,
                  contactName:
                    contact.name?.trim() || formatPhone(contact.phone_e164),
                }}
              />
              <Button asChild>
                <Link
                  href={
                    existingConversation
                      ? `/inbox/${existingConversation.id}`
                      : `/inbox/new?contact=${contact.id}`
                  }
                >
                  <SquarePen strokeWidth={1.75} />
                  {existingConversation
                    ? t("appShell.contactOpenConversation")
                    : t("appShell.contactMessage")}
                </Link>
              </Button>
              <RecordOverflowMenu
                actions={menuActions}
                label={t("recordMenu.moreActionsFor", {
                  name: contact.name?.trim() || formatPhone(contact.phone_e164),
                })}
              />
            </>
          }
        />

        {contact.opted_out && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3">
            <p className="text-sm">{t("appShell.contactOptedOutNotice")}</p>
            {/* Which kind of opt-out decides whether there is anything to press.
              A carrier block is a carrier block: undoing our record would not
              lift it, and the very next send would come back rejected anyway.
              #331 added a second source with the same consequence, so this
              asks the predicate rather than naming one. */}
            {isCarrierEnforcedOptOut(contact.opt_out_source) ? (
              <p className="mt-2 text-xs text-muted-foreground">
                {t("appShell.contactCarrierOptOut")}
              </p>
            ) : (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={revoke.isPending}
                  onClick={() =>
                    revoke.mutate(contact.id, {
                      onSuccess: () =>
                        toast.success(t("appShell.contactOptedBackIn")),
                      onError: (cause) =>
                        toast.error(
                          cause instanceof ApiError
                            ? cause.message
                            : t("appShell.contactOptInFailed"),
                        ),
                    })
                  }
                >
                  {revoke.isPending
                    ? t("appShell.contactWorking")
                    : t("appShell.contactMarkOptedIn")}
                </Button>
                <p className="text-xs text-muted-foreground">
                  {t("appShell.contactManualOptOutNote")}
                </p>
              </div>
            )}
          </div>
        )}

        <SegmentedControl
          className="lg:hidden"
          fill
          ariaLabel={t("appShell.contactTabsAria")}
          value={phoneTab}
          options={phoneTabs}
          onChange={(next) =>
            selectTab(
              next === "activity" && phoneTab === "activity" ? tab : next,
            )
          }
        />

        <div
          className={cn("space-y-6 lg:block", tab !== "details" && "hidden")}
        >
          <SettingsCard title={t("appShell.contactDetailsCard")}>
            <div className="space-y-4">
              {/* #291: FIRST, and above the name, because it belongs to the number
              in the header rather than to the record below it — the same
              question, answered twice over. Absent entirely until a crew adds
              one, so most records read exactly as they did before.
              *Applying: Relationship Strength — the closest semantic pair on
              the page gets the tightest grouping.* */}
              <PhoneList contact={contact} />
              <div className="space-y-1.5">
                <Label htmlFor="contact-name">
                  {t("appShell.contactName")}
                </Label>
                <Input
                  id="contact-name"
                  value={name.value}
                  maxLength={200}
                  placeholder={t("appShell.contactNamePlaceholder")}
                  onChange={(event) => name.onChange(event.target.value)}
                  onBlur={name.onBlur}
                />
                <SaveStatus state={name.state} error={name.error} />
              </div>
              {/* #291: directly under the name, because for a property manager
              or a general contractor it IS the name — "Dave" is not a useful
              record, "Dave at Maple Property Group" is.
              *Applying: Relationship Strength — a strong semantic pair gets
              tight grouping.* */}
              {!hidden("business") && (
                <div className="space-y-1.5">
                  <Label htmlFor="contact-business">
                    {t("appShell.contactBusiness")}
                  </Label>
                  <Input
                    id="contact-business"
                    value={businessName.value}
                    maxLength={200}
                    placeholder={t("appShell.contactBusinessPlaceholder")}
                    autoComplete="off"
                    onChange={(event) =>
                      businessName.onChange(event.target.value)
                    }
                    onBlur={businessName.onBlur}
                  />
                  <SaveStatus
                    state={businessName.state}
                    error={businessName.error}
                  />
                </div>
              )}
              {!hidden("address") && (
                <div className="space-y-1.5">
                  <Label htmlFor="contact-address">
                    {t("appShell.contactAddress")}
                  </Label>
                  <Input
                    id="contact-address"
                    value={address.value}
                    maxLength={500}
                    placeholder={t("appShell.contactAddressPlaceholder")}
                    autoComplete="off"
                    onChange={(event) => address.onChange(event.target.value)}
                    onBlur={address.onBlur}
                  />
                  <SaveStatus state={address.state} error={address.error} />
                  {/* #291: the OTHER addresses, absent until there are any. The
                field above stays the one-address case, which is most of them —
                a property manager with forty is the reason this exists, not
                the reason every record should carry an empty list. */}
                  <AddressList contact={contact} />
                </div>
              )}
              {/* #291: beside the address rather than beside the phone, because
              it answers the same question — how do we reach them when a text
              is the wrong shape for what we are sending. */}
              {!hidden("email") && (
                <div className="space-y-1.5">
                  <Label htmlFor="contact-email">
                    {t("appShell.contactEmail")}
                  </Label>
                  <Input
                    id="contact-email"
                    type="email"
                    value={email.value}
                    maxLength={254}
                    placeholder={t("appShell.contactEmailPlaceholder")}
                    autoComplete="off"
                    onChange={(event) => email.onChange(event.target.value)}
                    onBlur={email.onBlur}
                  />
                  <SaveStatus state={email.state} error={email.error} />
                </div>
              )}
              {!hidden("notes") && (
                <div className="space-y-1.5">
                  <Label htmlFor="contact-notes">
                    {t("appShell.contactNotes")}
                  </Label>
                  <Textarea
                    id="contact-notes"
                    value={notes.value}
                    maxLength={5000}
                    rows={4}
                    placeholder={t("appShell.contactNotesPlaceholder")}
                    onChange={(event) => notes.onChange(event.target.value)}
                    onBlur={notes.onBlur}
                  />
                  <SaveStatus state={notes.state} error={notes.error} />
                </div>
              )}
              {anyHidden && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="-ml-2 text-muted-foreground"
                  onClick={() => setAddingDetails(true)}
                >
                  <Plus strokeWidth={1.75} />
                  {t("appShell.contactAddDetails")}
                </Button>
              )}
              {/* #291: the fields this workspace defined for itself. Absent
              entirely until somebody defines one, so a crew that never opens
              the settings screen never sees an empty heading. */}
              <ContactCustomFields contact={contact} />
              <DestinationClock contact={contact} />
              {/* #228: the same control the thread panel carries, because a
              contact nobody has texted yet has no thread and therefore no
              panel. A language you can only set on customers who already wrote
              to you is not a setting a crew can rely on.

              A heading rather than a Label: a radiogroup has no single control
              for htmlFor to point at, and the group already carries its own
              accessible name. */}
              <div className="space-y-1.5">
                <p className="text-sm font-medium">
                  {t("appShell.contactLanguage")}
                </p>
                <ContactLanguage contact={contact} />
              </div>
              <RecordAttribution contact={contact} />
            </div>
          </SettingsCard>

          <ContactTags contact={contact} />

          <SettingsCard title={t("appShell.contactConsentCard")}>
            <ConsentLine contact={contact} />
          </SettingsCard>

          {/* §3.3: the danger zone stays genuinely quiet — these are routine,
          reversible actions, so the triggers are neutral until hovered, no red
          scare-styling. The typed/confirm gauntlet lives in the dialogs. */}
          <SettingsCard title={t("appShell.contactManageCard")}>
            <div className="space-y-4">
              {/* #304: first in this card, because it is the only thing here that
              is not destructive — and absent entirely for anybody without
              contacts.bulk, so most crews never see it. */}
              <ExportHistory contactId={contact.id} />
              {!contact.opted_out && (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm text-muted-foreground">
                    {t("appShell.contactStopTexting")}
                  </p>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => setConfirmingOptOut(true)}
                  >
                    {t("appShell.contactOptOutAction")}
                  </Button>
                </div>
              )}
              {blockedNumber.canManage && (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm text-muted-foreground">
                    {blockedNumber.blocked
                      ? t("blockedNumbers.manageNoteBlocked")
                      : t("blockedNumbers.manageNote")}
                  </p>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground hover:text-destructive"
                    disabled={blockedNumber.unblocking}
                    onClick={() =>
                      blockedNumber.blocked
                        ? blockedNumber.unblock()
                        : setConfirmingBlock(true)
                    }
                  >
                    {blockedNumber.blocked
                      ? t("blockedNumbers.unblockAction")
                      : t("blockedNumbers.blockAction")}
                  </Button>
                </div>
              )}
              {canDelete && (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm text-muted-foreground">
                    {t("appShell.contactHideNote")}
                  </p>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => setConfirmingDelete(true)}
                  >
                    {t("appShell.contactDeleteAction")}
                  </Button>
                </div>
              )}
            </div>
          </SettingsCard>
        </div>
      </div>

      {/* #714/#740: ONE activity timeline for the customer (texts, calls,
          edits, tags, merges, opt-outs, blocks, assignments, mentions,
          references), the same one a job, a thread and a call show, with the
          customer's conversations, calls, tasks and files each one tap away
          behind the same control. */}
      <div
        className={cn(
          "min-w-0 space-y-4 lg:block",
          tab === "details" && "hidden",
        )}
      >
        <SegmentedControl
          className="hidden lg:flex"
          ariaLabel={t("appShell.contactTabsAria")}
          value={paneOf(tab)}
          options={CONTACT_PANES.map((pane) => ({
            value: pane,
            label: paneLabel[pane],
          }))}
          onChange={selectTab}
        />
        {phoneTab === "activity" && (
          <SegmentedControl
            className="lg:hidden"
            fill
            size="sm"
            ariaLabel={t("appShell.contactTabActivity")}
            value={paneOf(tab)}
            options={PHONE_ACTIVITY_PANES.map((pane) => ({
              value: pane,
              label:
                pane === "activity"
                  ? t("appShell.contactTabTimeline")
                  : paneLabel[pane],
            }))}
            onChange={selectTab}
          />
        )}
        <ContactHistory
          contact={contact}
          pane={paneOf(tab)}
          conversationId={existingConversation?.id ?? null}
        />
      </div>

      <BlockNumberDialog
        phone={contact.phone_e164}
        open={confirmingBlock}
        onOpenChange={setConfirmingBlock}
      />

      <ConfirmDialog
        open={confirmingOptOut}
        onOpenChange={setConfirmingOptOut}
        title={t("appShell.contactOptOutTitle")}
        description={t("appShell.contactOptOutBody", {
          phone: formatPhone(contact.phone_e164),
        })}
        confirmLabel={t("appShell.contactOptOutConfirm")}
        pendingLabel={t("appShell.contactWorking")}
        pending={optOut.isPending}
        onConfirm={() =>
          optOut.mutate(contact.id, {
            onSuccess: () => {
              setConfirmingOptOut(false);
              toast.success(t("appShell.contactOptedOut"));
            },
            onError: (cause) =>
              toast.error(
                cause instanceof ApiError
                  ? cause.message
                  : t("appShell.contactOptOutFailed"),
              ),
          })
        }
      />

      <ConfirmDialog
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        title={t("appShell.contactDeleteTitle")}
        description={t("appShell.contactDeleteBody")}
        cancelLabel={t("appShell.contactKeepContact")}
        confirmLabel={t("common.delete")}
        pendingLabel={t("appShell.contactDeleting")}
        pending={deleteContact.isPending}
        onConfirm={() =>
          deleteContact.mutate(contact.id, {
            onSuccess: () => {
              toast.success(t("appShell.contactDeleted"));
              router.push("/contacts");
            },
            onError: (cause) =>
              toast.error(
                cause instanceof ApiError
                  ? cause.message
                  : t("appShell.contactDeleteFailed"),
              ),
          })
        }
      />
      {menuDialogs}
    </div>
  );
}

export default function ContactDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const t = useT();
  const { id } = use(params);
  const contact = useContact(id);
  // The timeline's default (All) read, started beside the contact's own.
  useRecordActivity("contact", id, null);

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-8 md:px-6">
      <Link
        href="/contacts"
        className="inline-flex min-h-[44px] items-center gap-1 text-sm text-muted-foreground transition-colors duration-150 ease-out hover:text-foreground"
      >
        <ChevronLeft className="size-4" strokeWidth={1.75} aria-hidden />
        {t("appShell.contactsTitle")}
      </Link>

      {contact.isPending ? (
        <div className="space-y-4" aria-label={t("appShell.contactLoading")}>
          <Skeleton className="h-8 w-52" />
          <Skeleton className="h-64 w-full rounded-lg" />
        </div>
      ) : contact.isError ? (
        contact.error instanceof ApiError &&
        contact.error.code === "not_found" ? (
          <p className="rounded-lg border bg-card px-4 py-6 text-sm text-muted-foreground">
            {t("appShell.contactNotFound")}
          </p>
        ) : (
          <LoadError onRetry={() => contact.refetch()} />
        )
      ) : (
        <>
          <h1 className="sr-only">
            {contact.data.name ?? formatPhone(contact.data.phone_e164)}
          </h1>
          <ContactBody contact={contact.data} />
        </>
      )}
    </div>
  );
}
