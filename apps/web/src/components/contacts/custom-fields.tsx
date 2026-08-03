"use client";

import { useState } from "react";
import { toast } from "sonner";

import { contactFieldValueError, type ContactFieldKind } from "@loonext/shared";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ApiError } from "@/lib/api/error";
import { useContactFields } from "@/lib/api/contact-fields";
import { useUpdateContact } from "@/lib/api/contacts";
import type { ContactDetail } from "@/lib/api/types";

/**
 * #291 — what this workspace needs to know about a customer.
 *
 * Design notes, and the principles behind them:
 *
 * - **Absent until the workspace defines something.** A crew that has not set
 *   up any fields sees nothing here rather than an empty "Custom fields"
 *   heading on every contact forever. *Applying: Zen of Clarity.*
 *
 * - **Every defined field shows, answered or not.** The unanswered ones are the
 *   point: an empty "Gate code" on a job sheet is the prompt to ask. Hiding
 *   them until filled would make the feature invisible exactly when it is
 *   useful.
 *
 * - **Saves on blur, per field, like the fields above it.** These are one-line
 *   facts a crew corrects from a van; a Save button under ten inputs is a step
 *   between knowing something and recording it.
 *
 * - **A refused value keeps what was typed.** The input holds the text and says
 *   why, rather than reverting to the last good value and losing the correction
 *   somebody just made.
 */
export function ContactCustomFields({ contact }: { contact: ContactDetail }) {
  const fields = useContactFields();
  const update = useUpdateContact(contact.id);

  const stored = (contact.custom_fields ?? {}) as Record<string, string>;
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const defs = fields.data?.data ?? [];
  if (defs.length === 0) return null;

  const valueOf = (key: string) => drafts[key] ?? stored[key] ?? "";

  async function commit(
    def: { key: string; kind: ContactFieldKind; options?: string[] | null; label: string },
    next: string,
  ) {
    if (next === (stored[def.key] ?? "")) return;
    const reason = contactFieldValueError(
      { kind: def.kind, options: def.options ?? null, label: def.label },
      next,
    );
    if (reason) {
      setErrors((current) => ({ ...current, [def.key]: reason }));
      return;
    }
    setErrors((current) => {
      const { [def.key]: _removed, ...rest } = current;
      return rest;
    });
    try {
      // The WHOLE object each time: the API stores what it is sent, so a
      // partial send would drop every other field's value.
      await update.mutateAsync({
        custom_fields: { ...stored, ...drafts, [def.key]: next },
      });
      setDrafts((current) => {
        const { [def.key]: _saved, ...rest } = current;
        return rest;
      });
    } catch (cause) {
      toast.error(
        cause instanceof ApiError
          ? cause.message
          : `Couldn't save ${def.label}.`,
      );
    }
  }

  return (
    <div className="space-y-3">
      {defs.map((def) => {
        const value = valueOf(def.key);
        const error = errors[def.key];
        const inputId = `custom-${def.key}`;
        return (
          <div key={def.key} className="space-y-1">
            <Label htmlFor={inputId} className="text-[12px] text-app-muted">
              {def.label}
            </Label>

            {def.kind === "checkbox" ? (
              <div className="flex items-center gap-2">
                <Switch
                  id={inputId}
                  checked={value === "yes"}
                  aria-label={def.label}
                  onCheckedChange={(on) => void commit(def, on ? "yes" : "no")}
                />
                <span className="text-[13px] text-app-ink">
                  {value === "yes" ? "Yes" : value === "no" ? "No" : "Not asked"}
                </span>
              </div>
            ) : def.kind === "select" ? (
              <select
                id={inputId}
                value={value}
                onChange={(event) => void commit(def, event.target.value)}
                className="h-9 w-full rounded-app-input border border-app-line bg-app-paper px-2 text-[13px] text-app-ink"
              >
                {/* Empty is an ANSWER, and it has to stay reachable: "we asked,
                    there is no gate code" is a fact worth recording. */}
                <option value="">Not set</option>
                {(def.options ?? []).map((choice) => (
                  <option key={choice} value={choice}>
                    {choice}
                  </option>
                ))}
              </select>
            ) : (
              <Input
                id={inputId}
                type={def.kind === "date" ? "date" : def.kind === "number" ? "number" : "text"}
                value={value}
                aria-invalid={error ? true : undefined}
                onChange={(event) =>
                  setDrafts((current) => ({
                    ...current,
                    [def.key]: event.target.value,
                  }))
                }
                onBlur={(event) => void commit(def, event.target.value)}
              />
            )}

            {error && (
              <p role="alert" className="text-[12px] text-destructive">
                {error}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
