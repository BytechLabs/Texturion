"use client";

import { Merge, Users } from "lucide-react";
import { useState } from "react";
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
import { useT } from "@/i18n/provider";
import { ApiError } from "@/lib/api/error";
import {
  useDuplicateContacts,
  useMergeContacts,
  type DuplicatePair,
} from "@/lib/api/contacts";
import { formatPhone } from "@/lib/format/phone";

/**
 * #246 — the duplicates this workspace has, offered rather than hunted for.
 *
 * # Why it sits on the contacts page and not behind its own route
 *
 * "The workspace can find its likely duplicates without knowing they exist."
 * Somebody who does not know they have duplicates will not navigate to a page
 * about them. The card appears above the table only when there is something to
 * act on, which makes it a finding rather than a feature.
 *
 * *Applying: Meaningful Highlights & Context — the pair IS the insight, so it
 * is stated in one line each with the reason attached. Zen of Clarity — no
 * card at all when there is nothing to merge.*
 */
export function DuplicateContactsCard({ canMerge }: { canMerge: boolean }) {
  const t = useT();
  const duplicates = useDuplicateContacts();
  const [merging, setMerging] = useState<DuplicatePair | null>(null);

  const pairs = duplicates.data?.data ?? [];
  // No skeleton and no empty state: a workspace with no duplicates should see
  // its contacts page exactly as it always did.
  if (pairs.length === 0) return null;

  return (
    <>
      <section className="rounded-lg border bg-card">
        <div className="flex items-start gap-2.5 border-b border-border-subtle px-4 py-3 sm:px-5">
          <Users aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div className="space-y-0.5">
            <h2 className="text-sm font-semibold">
              {pairs.length === 1
                ? t("contacts.duplicatesOnePair")
                : t("contacts.duplicatesManyPairs", { count: pairs.length })}
            </h2>
            <p className="text-sm text-muted-foreground">
              {t("contacts.duplicatesBlurb")}
            </p>
          </div>
        </div>
        <ul className="divide-y divide-border">
          {pairs.map((pair) => (
            <li
              key={`${pair.contact_a}:${pair.contact_b}`}
              className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3 sm:px-5"
            >
              <div className="min-w-0 flex-1 text-sm">
                <p className="truncate">
                  {describe(pair.name_a, pair.phone_a)}
                  <span className="text-muted-foreground">
                    {t("contacts.duplicateAnd")}
                  </span>
                  {describe(pair.name_b, pair.phone_b)}
                </p>
                {/* The reason, in the words the server used. A suggestion
                    somebody cannot verify is one they learn to dismiss. */}
                <p className="text-xs text-muted-foreground">{pair.reason}</p>
              </div>
              {canMerge && (
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  onClick={() => setMerging(pair)}
                >
                  <Merge className="size-3.5" strokeWidth={1.75} aria-hidden />
                  {t("contacts.merge")}
                </Button>
              )}
            </li>
          ))}
        </ul>
      </section>

      <MergeDialog pair={merging} onClose={() => setMerging(null)} />
    </>
  );
}

/** A contact as somebody recognises it: the name if there is one, else the number. */
function describe(name: string | null, phone: string): string {
  const trimmed = name?.trim();
  return trimmed ? `${trimmed} (${formatPhone(phone)})` : formatPhone(phone);
}

/**
 * # Ethical Friction, and which direction the dialog states
 *
 * A merge moves somebody's whole history under a different record. The undo
 * restores the second contact, but NOT which thread came from which — so this
 * says out loud what survives and what does not, and it names the direction in
 * the way people get backwards ("merge A into B" is ambiguous to almost
 * everyone).
 *
 * The customer keeps both numbers either way, which is the fact that makes the
 * decision safe and the one most likely to be assumed wrong.
 */
function MergeDialog({
  pair,
  onClose,
}: {
  pair: DuplicatePair | null;
  onClose: () => void;
}) {
  const t = useT();
  const merge = useMergeContacts();
  const [keepFirst, setKeepFirst] = useState(true);
  const [error, setError] = useState<string | null>(null);

  if (pair === null) return null;

  const survivor = keepFirst
    ? { id: pair.contact_a, name: pair.name_a, phone: pair.phone_a }
    : { id: pair.contact_b, name: pair.name_b, phone: pair.phone_b };
  const folded = keepFirst
    ? { id: pair.contact_b, name: pair.name_b, phone: pair.phone_b }
    : { id: pair.contact_a, name: pair.name_a, phone: pair.phone_a };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("contacts.mergeTitle")}</DialogTitle>
          <DialogDescription>{t("contacts.mergeBlurb")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">
              {t("contacts.mergeWhichToKeep")}
            </legend>
            {[true, false].map((first) => {
              const option = first
                ? { name: pair.name_a, phone: pair.phone_a }
                : { name: pair.name_b, phone: pair.phone_b };
              return (
                <label
                  key={String(first)}
                  className="flex items-center gap-2 text-sm"
                >
                  <input
                    type="radio"
                    name="survivor"
                    checked={keepFirst === first}
                    onChange={() => setKeepFirst(first)}
                  />
                  {describe(option.name, option.phone)}
                </label>
              );
            })}
          </fieldset>

          {/* Said back in the direction people get backwards. */}
          <p className="text-[13px] text-muted-foreground">
            {t("contacts.mergeDirection", {
              folded: describe(folded.name, folded.phone),
              survivor: describe(survivor.name, survivor.phone),
            })}
          </p>

          {error !== null && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            disabled={merge.isPending}
            onClick={() => {
              setError(null);
              merge.mutate(
                { fromContactId: folded.id, intoContactId: survivor.id },
                {
                  onSuccess: (result) => {
                    onClose();
                    toast.success(
                      t(
                        result.opted_out
                          ? "contacts.mergedOptedOut"
                          : "contacts.merged",
                      ),
                    );
                  },
                  onError: (cause) =>
                    setError(
                      cause instanceof ApiError
                        ? cause.message
                        : t("contacts.mergeFailed"),
                    ),
                },
              );
            }}
          >
            {merge.isPending ? t("contacts.merging") : t("contacts.merge")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
