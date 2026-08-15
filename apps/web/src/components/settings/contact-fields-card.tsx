"use client";

import { Plus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import {
  CONTACT_FIELDS_CAP,
  CONTACT_FIELDS_COPY,
  CONTACT_FIELD_KINDS,
  contactFieldKey,
  type ContactFieldKind,
} from "@loonext/shared";

import { SettingsCard } from "@/components/settings/section";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useT, type Translate } from "@/i18n/provider";
import { ApiError } from "@/lib/api/error";
import {
  useContactFields,
  useSaveContactFields,
  type ContactFieldDef,
} from "@/lib/api/contact-fields";

/**
 * #291 — the fields a workspace defines for itself.
 *
 * Design notes, and the principles behind them:
 *
 * - **Nobody types a key.** The label is the only thing worth asking for; the
 *   key is derived from it and shown, not edited. Asking a plumber to invent a
 *   machine-readable identifier is asking them a question about our storage
 *   format. *Applying: Smart Defaults — the field is never an empty form, it
 *   arrives as Text with the label focused.*
 *
 * - **The privacy line sits where the decision is made.** It is the one moment
 *   somebody is thinking about what goes in a field. On a help page it would
 *   never be read, and by the time a card number is in a text column it is too
 *   late to say so.
 *
 * - **The choices editor only exists for a dropdown.** Four of the five types
 *   have nothing to configure, so the fifth's editor appears when it is picked
 *   rather than sitting greyed out on every row. *Applying: Progressive
 *   Disclosure & Zen of Clarity.*
 *
 * - **Removing says what it does to the data.** A field disappears from every
 *   contact; what the crew typed into it stays. Saying so is the difference
 *   between an owner who tidies up and an owner who thinks they deleted
 *   something. *Applying: Ethical Friction on the edge that carries a
 *   misconception, not on every click.*
 *
 * - **The ceiling is shown, not enforced by a refusal at save.** Ten is plenty
 *   and the Add button goes away with a sentence explaining why. A 422 after
 *   filling in an eleventh row is a worse way to learn the same fact.
 */

/** What each type is called on screen, and what it is for. */
function kindLabels(t: Translate): Record<ContactFieldKind, string> {
  return {
    text: t("settings.contactFieldKindText"),
    number: t("settings.contactFieldKindNumber"),
    date: t("settings.contactFieldKindDate"),
    select: t("settings.contactFieldKindSelect"),
    checkbox: t("settings.contactFieldKindCheckbox"),
  };
}

interface DraftField extends ContactFieldDef {
  /** Rows the owner added in this session, which have no key until saved. */
  isNew?: boolean;
}

export function ContactFieldsCard({ canEdit }: { canEdit: boolean }) {
  const t = useT();
  const KIND_LABELS = kindLabels(t);
  const query = useContactFields();
  const save = useSaveContactFields();
  const [draft, setDraft] = useState<DraftField[] | null>(null);

  // Re-seeded whenever the server answers. Keeping a draft rather than editing
  // the cache means navigating away discards an unsaved edit.
  useEffect(() => {
    if (query.data) setDraft(query.data.data);
  }, [query.data]);

  if (query.isPending || draft === null) {
    return (
      <SettingsCard
        title={t(CONTACT_FIELDS_COPY.heading)}
        description={t(CONTACT_FIELDS_COPY.intro)}
      >
        <Skeleton className="h-24 w-full" />
      </SettingsCard>
    );
  }

  const cap = query.data?.cap ?? CONTACT_FIELDS_CAP;
  const saved = query.data?.data ?? [];
  const dirty = JSON.stringify(strip(draft)) !== JSON.stringify(strip(saved));

  function update(index: number, patch: Partial<DraftField>) {
    setDraft((current) =>
      (current ?? []).map((field, i) =>
        i === index ? { ...field, ...patch } : field,
      ),
    );
  }

  /**
   * A NEW row's key follows its label; a SAVED row's key is frozen.
   *
   * Values are stored under the key, so re-deriving it on a saved field would
   * turn a typo fix into a silent wipe of every value on every contact.
   */
  function relabel(index: number, label: string) {
    const field = (draft ?? [])[index];
    if (!field) return;
    update(index, {
      label,
      ...(field.isNew ? { key: contactFieldKey(label) ?? "" } : {}),
    });
  }

  async function commit() {
    const fields = draft ?? [];
    const unnamed = fields.find((field) => !field.key || !field.label.trim());
    if (unnamed) {
      toast.error(t("settings.contactFieldsNeedName"));
      return;
    }
    try {
      await save.mutateAsync(fields);
      toast.success(
        fields.length === 0
          ? t("settings.contactFieldsSavedEmpty")
          : t("settings.contactFieldsSaved"),
      );
    } catch (cause) {
      toast.error(
        cause instanceof ApiError
          ? cause.message
          : t("settings.contactFieldsSaveFailed"),
      );
    }
  }

  return (
    <SettingsCard
      title={t(CONTACT_FIELDS_COPY.heading)}
      description={t(CONTACT_FIELDS_COPY.intro)}
    >
      <div className="space-y-4">
        {draft.length === 0 && (
          <p className="text-[13px] text-app-muted">
            {t("settings.contactFieldsEmpty")}
          </p>
        )}

        {draft.map((field, index) => (
          <div
            key={index}
            className="space-y-2 rounded-app-ctrl border border-app-line p-3"
          >
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-[10rem] flex-1 space-y-1">
                <Label className="sr-only" htmlFor={`field-label-${index}`}>
                  {t("settings.contactFieldLabelLabel")}
                </Label>
                <Input
                  id={`field-label-${index}`}
                  value={field.label}
                  disabled={!canEdit}
                  placeholder={t("settings.contactFieldLabelPlaceholder")}
                  onChange={(event) => relabel(index, event.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label className="sr-only" htmlFor={`field-kind-${index}`}>
                  {t("settings.contactFieldKindLabel")}
                </Label>
                <select
                  id={`field-kind-${index}`}
                  value={field.kind}
                  disabled={!canEdit || !field.isNew}
                  onChange={(event) =>
                    update(index, {
                      kind: event.target.value as ContactFieldKind,
                      options:
                        event.target.value === "select" ? field.options ?? [] : null,
                    })
                  }
                  className="h-9 rounded-app-ctrl border border-app-line bg-app-paper px-2 text-[13px] text-app-ink disabled:opacity-45"
                >
                  {CONTACT_FIELD_KINDS.map((kind) => (
                    <option key={kind} value={kind}>
                      {KIND_LABELS[kind]}
                    </option>
                  ))}
                </select>
              </div>
              {canEdit && (
                <button
                  type="button"
                  aria-label={t("settings.contactFieldRemoveAria", {
                    name: field.label || t("settings.contactFieldThisField"),
                  })}
                  onClick={() =>
                    setDraft((current) =>
                      (current ?? []).filter((_, i) => i !== index),
                    )
                  }
                  className="tap-target rounded-app-ctrl px-2 py-2 text-[12px] text-app-muted transition-colors duration-150 hover:bg-app-line-soft hover:text-app-ink"
                >
                  <X className="size-3.5" strokeWidth={1.75} />
                </button>
              )}
            </div>

            {/* The choices editor, for the one type that has any. */}
            {field.kind === "select" && (
              <div className="space-y-1">
                <Label
                  className="text-[12px] text-app-muted"
                  htmlFor={`field-options-${index}`}
                >
                  {t("settings.contactFieldChoicesLabel")}
                </Label>
                <textarea
                  id={`field-options-${index}`}
                  rows={3}
                  disabled={!canEdit}
                  value={(field.options ?? []).join("\n")}
                  placeholder={t("settings.contactFieldChoicesPlaceholder")}
                  onChange={(event) =>
                    update(index, {
                      options: event.target.value
                        .split("\n")
                        .map((line) => line.trim())
                        .filter(Boolean),
                    })
                  }
                  className="w-full rounded-app-ctrl border border-app-line bg-app-paper px-2 py-1.5 text-[13px] text-app-ink disabled:opacity-45"
                />
              </div>
            )}

            {/*
              The key, shown rather than asked for. It matters because it is the
              column head in an export, and because a saved field's type and key
              are frozen — values are stored under it.
            */}
            {field.key && (
              <p className="text-[12px] text-app-muted-2">
                {t("settings.contactFieldExportsAs")} <code>{field.key}</code>
                {!field.isNew && t("settings.contactFieldFrozenType")}
              </p>
            )}
          </div>
        ))}

        {canEdit && draft.length < cap && (
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setDraft((current) => [
                ...(current ?? []),
                // Smart Defaults: a row arrives as Text with an empty name,
                // which is the commonest field and one decision fewer.
                { key: "", label: "", kind: "text", options: null, isNew: true },
              ])
            }
          >
            <Plus className="size-3.5" strokeWidth={1.75} />
            {t("settings.contactFieldsAdd")}
          </Button>
        )}

        {draft.length >= cap && (
          <p className="text-[12px] text-app-muted-2">
            {/* `cap`, not the constant: the server may send its own, and the
                line right above this one gates on `cap`. A sentence naming a
                different number from the rule that produced it is worse than
                no sentence. */}
            {t(CONTACT_FIELDS_COPY.cap_reached, { count: String(cap) })}
          </p>
        )}

        {/* Said where fields are DEFINED, which is the only moment it lands. */}
        <p className="text-[12px] text-app-muted-2">
          {t(CONTACT_FIELDS_COPY.privacy)}
        </p>

        {canEdit && dirty && (
          <div className="space-y-2">
            {/* What a removal actually does, said before it is committed. */}
            {saved.some(
              (field) => !draft.some((row) => row.key === field.key),
            ) && (
              <p className="text-[12px] text-app-muted">
                {t(CONTACT_FIELDS_COPY.delete_warning)}
              </p>
            )}
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                disabled={save.isPending}
                onClick={() => void commit()}
              >
                {t("settings.contactFieldsSave")}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDraft(query.data?.data ?? [])}
              >
                {t("settings.contactFieldsDiscard")}
              </Button>
            </div>
          </div>
        )}
      </div>
    </SettingsCard>
  );
}

/** Compare what the server stores, not the local-only `isNew` marker. */
function strip(fields: ContactFieldDef[]): ContactFieldDef[] {
  return fields.map((field) => ({
    key: field.key,
    label: field.label,
    kind: field.kind,
    options: field.kind === "select" ? field.options ?? [] : null,
  }));
}
