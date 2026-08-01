"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

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
import { Textarea } from "@/components/ui/textarea";
import { useCreateContact } from "@/lib/api/contacts";
import { ApiError } from "@/lib/api/error";
import { normalizeNanpPhone } from "@/lib/contacts/csv-import";

/** Server column limits (apps/api/src/routes/contacts.ts), mirrored on both phones. */
const NAME_MAX = 200;
const ADDRESS_MAX = 500;
const NOTES_MAX = 5000;

/**
 * Create one contact by hand. Both phone apps have had this since contacts
 * shipped; on web the only ways in were a CSV, a vCard, or texting the person
 * first, so writing down the number a customer gave you over the phone meant
 * building a file for it.
 *
 * POST /v1/contacts upserts on (company, phone), so adding a number that is
 * already on file updates that contact rather than making a second one.
 */
export function NewContactDialog({
  open,
  onOpenChange,
  prefillPhone = "",
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  /**
   * #459: the number the dialer had on screen. A form that made somebody
   * retype the digits they just dialed would be a form that punishes them for
   * using the feature — Smart Defaults, the one field we CAN fill.
   */
  prefillPhone?: string;
}) {
  const router = useRouter();
  const create = useCreateContact();
  const [phone, setPhone] = useState(prefillPhone);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Re-seed when the dialog opens with a different number: the component
  // stays mounted between openings, so initial state alone would show the
  // first number forever.
  useEffect(() => {
    if (open) setPhone(prefillPhone);
  }, [open, prefillPhone]);

  const normalized = normalizeNanpPhone(phone);
  const phoneLooksWrong = phone.trim() !== "" && normalized === null;

  const close = (next: boolean) => {
    if (create.isPending) return;
    if (!next) {
      setPhone("");
      setName("");
      setAddress("");
      setNotes("");
      setError(null);
    }
    onOpenChange(next);
  };

  const submit = () => {
    if (normalized === null) {
      setError("Enter a 10-digit US or Canada number.");
      return;
    }
    setError(null);
    create.mutate(
      {
        phone_e164: normalized,
        name: name.trim() || undefined,
        address: address.trim() || undefined,
        notes: notes.trim() || undefined,
      },
      {
        onSuccess: (contact) => {
          toast.success("Contact added");
          close(false);
          router.push(`/contacts/${contact.id}`);
        },
        onError: (cause) =>
          setError(
            cause instanceof ApiError
              ? cause.message
              : "Couldn't add that contact. Try again.",
          ),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New contact</DialogTitle>
          <DialogDescription>
            A number already on file updates that contact instead of adding a
            second one.
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="new-contact-phone">Phone</Label>
            <Input
              id="new-contact-phone"
              inputMode="tel"
              autoComplete="tel"
              placeholder="(416) 555-0123"
              value={phone}
              onChange={(event) => {
                setPhone(event.target.value);
                setError(null);
              }}
            />
            {phoneLooksWrong && (
              <p className="text-xs text-destructive">
                Enter a 10-digit US or Canada number.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="new-contact-name">Name</Label>
            <Input
              id="new-contact-name"
              autoComplete="name"
              placeholder="Optional"
              maxLength={NAME_MAX}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="new-contact-address">Address</Label>
            <Input
              id="new-contact-address"
              placeholder="Optional"
              maxLength={ADDRESS_MAX}
              value={address}
              onChange={(event) => setAddress(event.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="new-contact-notes">Notes</Label>
            <Textarea
              id="new-contact-notes"
              placeholder="Optional"
              maxLength={NOTES_MAX}
              rows={3}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </div>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => close(false)}
              disabled={create.isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={normalized === null || create.isPending}
            >
              {create.isPending ? "Adding…" : "Add contact"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
