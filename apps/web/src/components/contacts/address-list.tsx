"use client";

import { MapPin, Plus, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api/error";
import {
  useAddContactAddress,
  useRemoveContactAddress,
  useUpdateContactAddress,
} from "@/lib/api/contacts";
import type { ContactDetail } from "@/lib/api/types";
import { cn } from "@/lib/utils";

/**
 * #291 — the other places this customer is.
 *
 * Design notes, and the principles behind them:
 *
 * - **It is absent until it has something to say.** Most contacts have one
 *   address, which the field above already holds; showing an empty "Other
 *   addresses" list beside it would be a permanent question mark on every
 *   record to serve the property manager with forty. So the section appears
 *   when there are rows, or when somebody asks for it.
 *   *Applying: Zen of Clarity, and Prioritize Intent — complexity expands with
 *   the user's intent rather than ahead of it.*
 *
 * - **The primary one is named, not just first.** "Which address" is the
 *   question this list exists to answer, and ordering alone answers it only
 *   for somebody who knows the ordering means something.
 *
 * - **A label is optional and free text.** A fixed vocabulary is wrong for the
 *   second trade that uses it: a property manager labels by unit, a builder by
 *   lot, an HVAC company by which rooftop the plant is on.
 *
 * - **Removing takes one click.** It is reversible by typing it again, and
 *   nothing has been sent anywhere. *Applying: Ethical Friction, on the
 *   irreversible edge only.*
 */
export function AddressList({ contact }: { contact: ContactDetail }) {
  const addresses = contact.addresses ?? [];
  const add = useAddContactAddress(contact.id);
  const update = useUpdateContactAddress(contact.id);
  const remove = useRemoveContactAddress(contact.id);

  const [adding, setAdding] = useState(false);
  const [draftLabel, setDraftLabel] = useState("");
  const [draftAddress, setDraftAddress] = useState("");

  async function submit() {
    const address = draftAddress.trim();
    if (!address) return;
    try {
      await add.mutateAsync({
        address,
        label: draftLabel.trim() || null,
      });
      setDraftLabel("");
      setDraftAddress("");
      setAdding(false);
    } catch (cause) {
      toast.error(
        cause instanceof ApiError ? cause.message : "Couldn't add that address.",
      );
    }
  }

  // No early return for the empty case: the list below is already conditional
  // on having rows, so an extra branch rendered the same button twice and
  // looked load-bearing without being it. Found by breaking it and watching
  // nothing fail.

  return (
    <div className="space-y-2">
      {addresses.length > 0 ? (
        <ul className="space-y-1">
          {addresses.map((entry) => (
            <li
              key={entry.id}
              className="flex flex-wrap items-center gap-2 rounded-app-input border border-app-line bg-app-paper px-3 py-2"
            >
              <MapPin
                className="size-3.5 shrink-0 text-app-muted-2"
                strokeWidth={1.75}
                aria-hidden
              />
              <span className="flex-1 text-[13px] text-app-ink">
                {entry.label ? (
                  <span className="text-app-muted-2">{entry.label} · </span>
                ) : null}
                {entry.address}
              </span>
              {entry.is_primary ? (
                <span className="rounded-full bg-app-tint px-2 py-0.5 text-[11px] font-semibold text-app-olive-deep">
                  Where the van goes
                </span>
              ) : (
                <button
                  type="button"
                  disabled={update.isPending}
                  onClick={() =>
                    update.mutate({ addressId: entry.id, is_primary: true })
                  }
                  className="tap-target text-[12px] text-app-muted-2 underline-offset-2 hover:text-app-ink hover:underline"
                >
                  Make it the main one
                </button>
              )}
              <button
                type="button"
                aria-label={`Remove ${entry.address}`}
                disabled={remove.isPending}
                onClick={() => remove.mutate(entry.id)}
                className="tap-target text-app-muted-2 hover:text-app-ink"
              >
                <X className="size-3.5" strokeWidth={1.75} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {adding ? (
        <div className="space-y-2 rounded-app-input border border-app-line bg-app-paper p-3">
          <div className="space-y-1">
            <Label htmlFor="new-address-label" className="text-[12px]">
              Label
            </Label>
            <Input
              id="new-address-label"
              value={draftLabel}
              maxLength={80}
              placeholder="Unit 4, Billing, the rooftop…"
              autoComplete="off"
              onChange={(event) => setDraftLabel(event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="new-address" className="text-[12px]">
              Address
            </Label>
            <Input
              id="new-address"
              value={draftAddress}
              maxLength={500}
              placeholder="Where the job is"
              autoComplete="off"
              onChange={(event) => setDraftAddress(event.target.value)}
            />
          </div>
          <div className={cn("flex items-center gap-2")}>
            <Button
              size="sm"
              disabled={add.isPending || draftAddress.trim().length === 0}
              onClick={submit}
            >
              Add
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setAdding(false);
                setDraftLabel("");
                setDraftAddress("");
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="tap-target flex items-center gap-1 text-[13px] text-app-muted-2 underline-offset-2 hover:text-app-ink hover:underline"
        >
          <Plus className="size-3.5" strokeWidth={1.75} aria-hidden />
          Add another address
        </button>
      )}
    </div>
  );
}
