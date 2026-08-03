"use client";

import { Phone, Plus, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api/error";
import {
  useAddContactPhone,
  useRemoveContactPhone,
} from "@/lib/api/contacts";
import type { ContactDetail } from "@/lib/api/types";

/**
 * #291 — the other numbers this customer answers.
 *
 * Design notes, and the principles behind them:
 *
 * - **Absent until it has something to say.** Nearly every customer has one
 *   line, which the field above already holds. An empty "other numbers" list
 *   on every record would be a permanent question mark to serve the household
 *   with two people in it. *Applying: Zen of Clarity, and Prioritize Intent —
 *   complexity expands with the user's intent, not ahead of it.*
 *
 * - **It says what adding one DOES.** This is not a notes field. A number
 *   recorded here is matched against every inbound text and call, so the crew
 *   is told that in one line — otherwise the first time anyone learns it is
 *   when a message arrives under a name they did not expect.
 *
 * - **A label is optional and free text.** A fixed vocabulary is wrong for the
 *   second trade that uses it: a household labels by person, a business by
 *   which line it is, a property manager by site.
 *
 * - **Removing takes one click.** It is reversible by typing it again, and the
 *   conversations held with that number stay. *Applying: Ethical Friction, on
 *   the irreversible edge only — and this edge is not irreversible.*
 *
 * Mirrors the Android and iOS lists; `phone-parity.test.ts` keeps the words
 * the same.
 */
export function PhoneList({ contact }: { contact: ContactDetail }) {
  const phones = contact.phones ?? [];
  const add = useAddContactPhone(contact.id);
  const remove = useRemoveContactPhone(contact.id);

  const [adding, setAdding] = useState(false);
  const [draftLabel, setDraftLabel] = useState("");
  const [draftPhone, setDraftPhone] = useState("");

  async function submit() {
    const phone = draftPhone.trim();
    if (!phone) return;
    try {
      await add.mutateAsync({ phone_e164: phone, label: draftLabel.trim() || null });
      setDraftLabel("");
      setDraftPhone("");
      setAdding(false);
    } catch (cause) {
      // The server's words, not ours: it is the side that knows WHOSE number
      // this already is, and "couldn't add that" would send somebody looking
      // for a fault that is really a collision.
      toast.error(
        cause instanceof ApiError ? cause.message : "Couldn't add that number.",
      );
    }
  }

  return (
    <div className="space-y-2">
      {phones.length > 0 ? (
        <ul className="space-y-1">
          {phones.map((entry) => (
            <li
              key={entry.id}
              className="flex flex-wrap items-center gap-2 rounded-app-input border border-app-line bg-app-paper px-3 py-2"
            >
              <Phone
                className="size-3.5 shrink-0 text-app-muted-2"
                strokeWidth={1.75}
                aria-hidden
              />
              <span className="flex-1 text-[13px] text-app-ink">
                {entry.label ? (
                  <span className="text-app-muted-2">{entry.label} · </span>
                ) : null}
                {entry.phone_e164}
              </span>
              <button
                type="button"
                aria-label={`Remove ${entry.phone_e164}`}
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
            <Label htmlFor="new-phone-label" className="text-[12px]">
              Label
            </Label>
            <Input
              id="new-phone-label"
              value={draftLabel}
              maxLength={80}
              placeholder="Landline, the wife, the shop…"
              autoComplete="off"
              onChange={(event) => setDraftLabel(event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="new-phone" className="text-[12px]">
              Number
            </Label>
            <Input
              id="new-phone"
              type="tel"
              value={draftPhone}
              maxLength={32}
              placeholder="Another number they answer"
              autoComplete="off"
              onChange={(event) => setDraftPhone(event.target.value)}
            />
          </div>
          {/* What this actually does, said before it is done. */}
          <p className="text-[12px] text-app-muted-2">{PHONE_MATCH_NOTE}</p>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              disabled={add.isPending || draftPhone.trim().length === 0}
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
                setDraftPhone("");
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
          {PHONE_ADD_LABEL}
        </button>
      )}
    </div>
  );
}

/** The two sentences this surface owns, kept where the parity test can read them. */
export const PHONE_ADD_LABEL = "Add another number";
export const PHONE_MATCH_NOTE =
  "Texts and calls from this number will show up under this customer, in " +
  "their own thread.";
