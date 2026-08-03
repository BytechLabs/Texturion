"use client";

import { ChevronLeft, Clock, Copy, SquarePen } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { isCarrierEnforcedOptOut } from "@/lib/api/types";

import { CallButton } from "@/components/calls/call-button";
import { AddressList } from "@/components/contacts/address-list";
import { PhoneList } from "@/components/contacts/phone-list";
import { ContactCustomFields } from "@/components/contacts/custom-fields";
import { ContactTimeline } from "@/components/contacts/contact-timeline";
import { ContactCallHistory } from "@/components/contacts/contact-call-history";
import { LoadError, SettingsCard } from "@/components/settings/section";
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
import { Textarea } from "@/components/ui/textarea";
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
import { useMembers } from "@/lib/api/team";
import type { ContactDetail } from "@/lib/api/types";
import { formatPhone } from "@/lib/format/phone";
import { NANP_TIMEZONES } from "@loonext/shared";

type SaveState = "idle" | "saving" | "saved" | "error";

/**
 * Auto-saving field (G6: name inline-editable, notes auto-saving). Saves
 * 800ms after the last keystroke; the status line is aria-live so screen
 * readers hear "Saved".
 */
function useAutosave(
  contactId: string,
  key: "name" | "address" | "notes" | "email" | "business_name",
  initial: string,
) {
  const update = useUpdateContact(contactId);
  const [value, setValue] = useState(initial);
  const [state, setState] = useState<SaveState>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSaved = useRef(initial);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  function onChange(next: string) {
    setValue(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const trimmed = next.trim();
      if (trimmed === lastSaved.current.trim()) return;
      setState("saving");
      const patch: ContactPatch = {
        [key]: trimmed === "" ? null : trimmed,
      };
      update.mutate(patch, {
        onSuccess: () => {
          lastSaved.current = next;
          setState("saved");
        },
        onError: () => setState("error"),
      });
    }, 800);
  }

  return { value, onChange, state };
}

function SaveStatus({ state }: { state: SaveState }) {
  return (
    <p aria-live="polite" className="min-h-4 text-xs text-muted-foreground">
      {state === "saving" && "Saving…"}
      {state === "saved" && "Saved"}
      {state === "error" && (
        <span className="text-destructive">Couldn&apos;t save. Check your connection.</span>
      )}
    </p>
  );
}

function ConsentLine({ contact }: { contact: ContactDetail }) {
  const members = useMembers();
  if (!contact.consent_source) {
    return (
      <p className="text-sm text-muted-foreground">
        No consent recorded yet. It&apos;s recorded when they text you first,
        or when you send them their first text, which attests they asked for it.
      </p>
    );
  }
  const date = contact.consent_at
    ? new Date(contact.consent_at).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      })
    : null;
  if (contact.consent_source === "inbound_sms") {
    return (
      <p className="text-sm">
        Texted you first{date ? ` · ${date}` : ""}
      </p>
    );
  }
  const attester = members.data?.data.find(
    (m) => m.user_id === contact.consent_attested_by,
  )?.display_name;
  return (
    <p className="text-sm">
      Consent recorded{attester ? ` by ${attester}` : ""}
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
  const addedBy = contact.created_by_name?.trim();
  const editedBy = contact.updated_by_name?.trim();
  if (!addedBy && !editedBy) return null;
  const addedOn = new Date(contact.created_at).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  return (
    <div className="space-y-0.5 text-xs text-muted-foreground">
      {addedBy && (
        <p>
          Added by {addedBy} on {addedOn}
        </p>
      )}
      {editedBy && editedBy !== addedBy && <p>Edited by {editedBy}</p>}
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
  const [editing, setEditing] = useState(false);
  const update = useUpdateContact(contact.id);

  const reading = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: contact.timezone_resolved,
  }).format(new Date());

  // Honest about the guess. "From their area code" is an inference a
  // dispatcher may know better than; "using your timezone" is us admitting we
  // do not know, which is the one they most need to see.
  const provenance =
    contact.timezone_source === "contact"
      ? "Set by your crew"
      : contact.timezone_source === "area_code"
        ? "From their area code"
        : "Their area code doesn't say — using your timezone";

  function save(next: string | null) {
    update.mutate(
      { timezone: next } as ContactPatch,
      {
        onSuccess: () => {
          setEditing(false);
          toast.success(
            next ? "Timezone updated." : "Back to their area code.",
          );
        },
        onError: (cause) =>
          toast.error(
            cause instanceof ApiError
              ? cause.message
              : "Couldn't save the timezone. Try again.",
          ),
      },
    );
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor="contact-timezone">Their time</Label>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <p className="flex items-center gap-1.5 text-sm">
          <Clock className="size-4 text-muted-foreground" strokeWidth={1.75} aria-hidden />
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
            Change
          </Button>
        )}
      </div>

      {editing && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Select
            value={contact.timezone_resolved}
            onValueChange={(next) => save(next)}
            disabled={update.isPending}
          >
            <SelectTrigger id="contact-timezone" className="w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {NANP_TIMEZONES.map((zone) => (
                <SelectItem key={zone} value={zone}>
                  {zone.split("/").slice(1).join(" / ").replaceAll("_", " ")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {contact.timezone && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-xs"
              disabled={update.isPending}
              onClick={() => save(null)}
            >
              Use their area code
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2 text-xs"
            disabled={update.isPending}
            onClick={() => setEditing(false)}
          >
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}

function ContactBody({ contact }: { contact: ContactDetail }) {
  const router = useRouter();
  const optOut = useOptOutContact();
  const revoke = useRevokeOptOut();
  const deleteContact = useDeleteContact();

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

  const [confirmingOptOut, setConfirmingOptOut] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xl font-medium tabular-nums">
          {formatPhone(contact.phone_e164)}
        </p>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Copy number"
          onClick={() => {
            void navigator.clipboard.writeText(contact.phone_e164);
            toast.success("Number copied.");
          }}
        >
          <Copy strokeWidth={1.75} />
        </Button>
        {contact.opted_out && (
          <Badge className="border-transparent bg-destructive/10 text-destructive">
            Opted out
          </Badge>
        )}
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
          contactName={contact.name?.trim() || formatPhone(contact.phone_e164)}
          className="ml-auto"
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
            {existingConversation ? "Open conversation" : "Message"}
          </Link>
        </Button>
      </div>

      {contact.opted_out && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3">
          <p className="text-sm">
            This customer opted out of texting. Sends to them are blocked.
          </p>
          {/* Which kind of opt-out decides whether there is anything to press.
              A carrier block is a carrier block: undoing our record would not
              lift it, and the very next send would come back rejected anyway.
              #331 added a second source with the same consequence, so this
              asks the predicate rather than naming one. */}
          {isCarrierEnforcedOptOut(contact.opt_out_source) ? (
            <p className="mt-2 text-xs text-muted-foreground">
              They texted STOP, so their carrier is blocking your texts. Only
              they can undo it, by texting START to your number.
            </p>
          ) : (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={revoke.isPending}
                onClick={() =>
                  revoke.mutate(contact.id, {
                    onSuccess: () => toast.success("Marked opted in again."),
                    onError: (cause) =>
                      toast.error(
                        cause instanceof ApiError
                          ? cause.message
                          : "Couldn't opt them back in. Try again.",
                      ),
                  })
                }
              >
                {revoke.isPending ? "Working…" : "Mark opted in again"}
              </Button>
              <p className="text-xs text-muted-foreground">
                Someone recorded this by hand, so undoing it here is all it
                takes.
              </p>
            </div>
          )}
        </div>
      )}

      <SettingsCard title="Details">
        <div className="space-y-4">
          {/* #291: FIRST, and above the name, because it belongs to the number
              in the header rather than to the record below it — the same
              question, answered twice over. Absent entirely until a crew adds
              one, so most records read exactly as they did before.
              *Applying: Relationship Strength — the closest semantic pair on
              the page gets the tightest grouping.* */}
          <PhoneList contact={contact} />
          <div className="space-y-1.5">
            <Label htmlFor="contact-name">Name</Label>
            <Input
              id="contact-name"
              value={name.value}
              maxLength={200}
              placeholder="Add a name"
              onChange={(event) => name.onChange(event.target.value)}
            />
            <SaveStatus state={name.state} />
          </div>
          {/* #291: directly under the name, because for a property manager
              or a general contractor it IS the name — "Dave" is not a useful
              record, "Dave at Maple Property Group" is.
              *Applying: Relationship Strength — a strong semantic pair gets
              tight grouping.* */}
          <div className="space-y-1.5">
            <Label htmlFor="contact-business">Business</Label>
            <Input
              id="contact-business"
              value={businessName.value}
              maxLength={200}
              placeholder="Who they work for, if anyone"
              autoComplete="off"
              onChange={(event) => businessName.onChange(event.target.value)}
            />
            <SaveStatus state={businessName.state} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="contact-address">Address</Label>
            <Input
              id="contact-address"
              value={address.value}
              maxLength={500}
              placeholder="Add an address"
              autoComplete="off"
              onChange={(event) => address.onChange(event.target.value)}
            />
            <SaveStatus state={address.state} />
            {/* #291: the OTHER addresses, absent until there are any. The
                field above stays the one-address case, which is most of them —
                a property manager with forty is the reason this exists, not
                the reason every record should carry an empty list. */}
            <AddressList contact={contact} />
          </div>
          {/* #291: beside the address rather than beside the phone, because
              it answers the same question — how do we reach them when a text
              is the wrong shape for what we are sending. */}
          <div className="space-y-1.5">
            <Label htmlFor="contact-email">Email</Label>
            <Input
              id="contact-email"
              type="email"
              value={email.value}
              maxLength={254}
              placeholder="For quotes and receipts"
              autoComplete="off"
              onChange={(event) => email.onChange(event.target.value)}
            />
            <SaveStatus state={email.state} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="contact-notes">Notes</Label>
            <Textarea
              id="contact-notes"
              value={notes.value}
              maxLength={5000}
              rows={4}
              placeholder="Gate code, dog's name, preferred arrival window…"
              onChange={(event) => notes.onChange(event.target.value)}
            />
            <SaveStatus state={notes.state} />
          </div>
          {/* #291: the fields this workspace defined for itself. Absent
              entirely until somebody defines one, so a crew that never opens
              the settings screen never sees an empty heading. */}
          <ContactCustomFields contact={contact} />
          <DestinationClock contact={contact} />
          <RecordAttribution contact={contact} />
        </div>
      </SettingsCard>

      <SettingsCard title="Consent">
        <ConsentLine contact={contact} />
      </SettingsCard>

      {/* #324: ONE chronology of texts, calls and jobs. D7's threading rule
          makes a long relationship many conversations rather than one thread,
          so "what have we done for this customer?" spanned N threads with
          nothing assembling them. The call history below stays: it is the
          #205 detail view (voicemail playable in place), and this is the
          overview above it. */}
      <ContactTimeline contactId={contact.id} />

      {/* #205: every call with this customer, in the /calls row grammar —
          day-grouped, voicemail playable in place, threaded rows tap through
          to the conversation. */}
      <ContactCallHistory contactId={contact.id} />

      {/* §3.3: the danger zone stays genuinely quiet — these are routine,
          reversible actions, so the triggers are neutral until hovered, no red
          scare-styling. The typed/confirm gauntlet lives in the dialogs. */}
      <SettingsCard title="Manage this contact">
        <div className="space-y-4">
          {!contact.opted_out && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-muted-foreground">
                Stop all texting to this customer.
              </p>
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-destructive"
                onClick={() => setConfirmingOptOut(true)}
              >
                Opt out this contact
              </Button>
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              Hide this contact from your list. Texting history stays, and
              they reappear if they text you again.
            </p>
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-destructive"
              onClick={() => setConfirmingDelete(true)}
            >
              Delete contact
            </Button>
          </div>
        </div>
      </SettingsCard>

      <Dialog open={confirmingOptOut} onOpenChange={setConfirmingOptOut}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Opt out this contact?</DialogTitle>
            <DialogDescription>
              All texting to {formatPhone(contact.phone_e164)} is blocked
              until they&apos;re opted back in. Use this when a customer asks
              you to stop texting them.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmingOptOut(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={optOut.isPending}
              onClick={() =>
                optOut.mutate(contact.id, {
                  onSuccess: () => {
                    setConfirmingOptOut(false);
                    toast.success("Contact opted out.");
                  },
                  onError: (cause) =>
                    toast.error(
                      cause instanceof ApiError
                        ? cause.message
                        : "Couldn't opt them out. Try again.",
                    ),
                })
              }
            >
              {optOut.isPending ? "Working…" : "Opt out"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this contact?</DialogTitle>
            <DialogDescription>
              They disappear from your contact list. Conversations and
              messages stay, and the contact comes back automatically if they
              text you again.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmingDelete(false)}>
              Keep contact
            </Button>
            <Button
              variant="destructive"
              disabled={deleteContact.isPending}
              onClick={() =>
                deleteContact.mutate(contact.id, {
                  onSuccess: () => {
                    toast.success("Contact deleted.");
                    router.push("/contacts");
                  },
                  onError: (cause) =>
                    toast.error(
                      cause instanceof ApiError
                        ? cause.message
                        : "Couldn't delete the contact. Try again.",
                    ),
                })
              }
            >
              {deleteContact.isPending ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function ContactDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const contact = useContact(id);

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 px-4 py-8 md:px-6">
      <Link
        href="/contacts"
        className="inline-flex min-h-[44px] items-center gap-1 text-sm text-muted-foreground transition-colors duration-150 ease-out hover:text-foreground"
      >
        <ChevronLeft className="size-4" strokeWidth={1.75} aria-hidden />
        Contacts
      </Link>

      {contact.isPending ? (
        <div className="space-y-4" aria-label="Loading contact">
          <Skeleton className="h-8 w-52" />
          <Skeleton className="h-64 w-full rounded-lg" />
        </div>
      ) : contact.isError ? (
        contact.error instanceof ApiError &&
        contact.error.code === "not_found" ? (
          <p className="rounded-lg border bg-card px-4 py-6 text-sm text-muted-foreground">
            This contact doesn&apos;t exist or was removed.
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
