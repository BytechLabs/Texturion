"use client";

import { ChevronLeft, Copy, SquarePen } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { CallButton } from "@/components/calls/call-button";
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

type SaveState = "idle" | "saving" | "saved" | "error";

/**
 * Auto-saving field (G6: name inline-editable, notes auto-saving). Saves
 * 800ms after the last keystroke; the status line is aria-live so screen
 * readers hear "Saved".
 */
function useAutosave(
  contactId: string,
  key: "name" | "address" | "notes",
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
  const address = useAutosave(contact.id, "address", contact.address ?? "");
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
              If they texted STOP, they also need to text START before
              messages will deliver.
            </p>
          </div>
        </div>
      )}

      <SettingsCard title="Details">
        <div className="space-y-4">
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
        </div>
      </SettingsCard>

      <SettingsCard title="Consent">
        <ConsentLine contact={contact} />
      </SettingsCard>

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
