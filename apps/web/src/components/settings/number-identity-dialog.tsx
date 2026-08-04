"use client";

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
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ApiError } from "@/lib/api/error";
import { useNumberIdentity, useSetNumberIdentity } from "@/lib/api/numbers";
import { useVoicemailGreetings } from "@/lib/api/voicemail-greetings";
import type { NumberIdentity, NumberIdentityPatch } from "@/lib/api/types";

/**
 * #307 — "How this line answers".
 *
 * A workspace running a service line and a sales line had one identity across
 * both: the same name, the same greeting, the same away reply. Somebody who
 * bought a second number BECAUSE it is a different business found the product
 * quietly making it the same one.
 *
 * Design notes, and the principles behind them:
 *
 * - **Every box is pre-filled with what a caller ACTUALLY gets**, never blank.
 *   An empty field cannot tell an owner what the line currently does, and this
 *   screen's whole job is to show that before it is changed. *Applying: Smart
 *   Defaults — the default is the live value, not an empty box.*
 *
 * - **Inherited is stated, per field.** This is the distinction the entire
 *   model exists to make visible: without it, an owner editing a box cannot
 *   tell whether they are fixing a sales greeting or rewriting the one every
 *   customer already knows. A field that came from the workspace says so, and
 *   a field that did not offers a way back.
 *
 * - **"Use the workspace's" rather than a Clear button.** Clear implies empty,
 *   and empty is the one thing this cannot mean — a cleared greeting restores
 *   the workspace's, it does not silence the line. The label says the outcome.
 *   *Applying: Ethical Friction, on the control whose effect is easy to
 *   misread.*
 *
 * - **A dialog, not a permanent panel.** The numbers screen is a list of
 *   lines; this is one question about one of them, and it is answered rarely.
 *   *Applying: Zen of Clarity — secondary detail collapses.*
 */
export function NumberIdentityDialog({
  numberId,
  open,
  onOpenChange,
}: {
  numberId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const identity = useNumberIdentity(numberId, open);
  const save = useSetNumberIdentity(numberId);
  // #309: only fetched while the dialog is open, and only to put NAMES on
  // the ids the identity already carries.
  const greetings = useVoicemailGreetings(open);

  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);

  // Re-seed whenever the server's answer changes, including after a save that
  // cleared a field: the box must show what a caller now gets, which for a
  // cleared field is the workspace's value rather than what was typed.
  useEffect(() => {
    if (identity.data) setDraft(draftOf(identity.data));
  }, [identity.data]);

  async function submit() {
    if (!identity.data) return;
    try {
      await save.mutateAsync(patchFrom(identity.data, draft));
      onOpenChange(false);
      toast.success("Saved. New callers hear this straight away.");
    } catch (cause) {
      toast.error(
        cause instanceof ApiError ? cause.message : "That could not be saved.",
      );
    }
  }

  async function restoreWorkspaceValue(field: ClearableField) {
    try {
      await save.mutateAsync({ [field]: null } as NumberIdentityPatch);
      toast.success("Back to your workspace's.");
    } catch (cause) {
      toast.error(
        cause instanceof ApiError ? cause.message : "That could not be changed.",
      );
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>How this line answers</DialogTitle>
          <DialogDescription>
            Anything you leave alone follows your workspace. Change one here and
            it only affects this number.
          </DialogDescription>
        </DialogHeader>

        {identity.isPending ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : identity.data ? (
          <div className="space-y-4">
            {/*
              The one control here that is not a box. It is rendered from the
              RESOLVED value, so it shows what a missed caller gets today
              rather than what this line has stored — which for every number
              nobody has touched is the workspace's answer.

              A switch is two-state and the setting is three: on, off, and
              follow the workspace. Rather than invent a third position nobody
              would recognise, the third state is carried by the same per-field
              affordance the other four fields already use. One model across
              the dialog beats a second one learned for a single row.
              *Applying: the Safety Principle (a conventional control) and Zen
              of Clarity (the exception lives in the label, not the widget).*
            */}
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3">
              <div className="space-y-0.5">
                <Label htmlFor="identity-mctb-enabled">
                  Text back a missed caller
                </Label>
                <p className="text-[12px] text-app-muted-2">
                  Sent from this line when a call goes unanswered.
                </p>
              </div>
              <div className="flex items-center gap-2">
                {identity.data.mctb_enabled.inherited ? (
                  <span className="text-[12px] text-app-muted-2">
                    Same as your workspace
                  </span>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-auto px-1.5 py-0.5 text-[12px]"
                    disabled={save.isPending}
                    onClick={() => void restoreWorkspaceValue("mctb_enabled")}
                  >
                    Use the workspace&apos;s
                  </Button>
                )}
                <Switch
                  id="identity-mctb-enabled"
                  checked={draft.mctb_enabled}
                  onCheckedChange={(checked) =>
                    setDraft((d) => ({ ...d, mctb_enabled: checked }))
                  }
                />
              </div>
            </div>
            {/*
              #309: which voice, before which words.

              A select rather than a list of radios: a workspace can hold
              several greetings and this is one line in a dialog about five
              other things. The written-words option is FIRST and is the
              default position, because it is what every line does until
              somebody chooses otherwise — and because it is the only option
              that is guaranteed to exist. *Applying: Zen of Clarity, and
              Smart Defaults on the option that is always available.*
            */}
            {(greetings.data?.data.length ?? 0) > 0 && (
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <Label htmlFor="identity-greeting">Voicemail voice</Label>
                  {identity.data.voicemail_greeting_id.inherited ? (
                    <span className="text-[12px] text-app-muted-2">
                      Same as your workspace
                    </span>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-auto px-1.5 py-0.5 text-[12px]"
                      disabled={save.isPending}
                      onClick={() =>
                        void restoreWorkspaceValue("voicemail_greeting_id")
                      }
                    >
                      Use the workspace&apos;s
                    </Button>
                  )}
                </div>
                <Select
                  value={identity.data.voicemail_greeting_id.value ?? WRITTEN}
                  onValueChange={(next) =>
                    void save.mutateAsync({
                      voicemail_greeting_id: next === WRITTEN ? null : next,
                    })
                  }
                >
                  <SelectTrigger id="identity-greeting">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={WRITTEN}>
                      The written greeting, read aloud
                    </SelectItem>
                    {greetings.data?.data.map((row) => (
                      <SelectItem key={row.id} value={row.id}>
                        {row.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[12px] text-app-muted-2">
                  A recording that will not play falls back to the words below,
                  so a caller never hears silence.
                </p>
              </div>
            )}
            {FIELDS.map((field) => {
              const resolved = identity.data![field.key];
              return (
                <div key={field.key} className="space-y-1.5">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <Label htmlFor={`identity-${field.key}`}>{field.label}</Label>
                    {resolved.inherited ? (
                      <span className="text-[12px] text-app-muted-2">
                        Same as your workspace
                      </span>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-auto px-1.5 py-0.5 text-[12px]"
                        disabled={save.isPending}
                        onClick={() => void restoreWorkspaceValue(field.key)}
                      >
                        Use the workspace&apos;s
                      </Button>
                    )}
                  </div>
                  {field.multiline ? (
                    <Textarea
                      id={`identity-${field.key}`}
                      rows={3}
                      value={draft[field.key]}
                      onChange={(event) =>
                        setDraft((d) => ({ ...d, [field.key]: event.target.value }))
                      }
                    />
                  ) : (
                    <Input
                      id={`identity-${field.key}`}
                      value={draft[field.key]}
                      onChange={(event) =>
                        setDraft((d) => ({ ...d, [field.key]: event.target.value }))
                      }
                    />
                  )}
                  <p className="text-[12px] text-app-muted-2">{field.hint}</p>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            That number could not be loaded.
          </p>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={save.isPending || !identity.data}
            onClick={() => void submit()}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type Field = "label" | "voicemail_greeting" | "away_message" | "mctb_message";

/** Every field the dialog can clear, including the one that is not text. */
type ClearableField = Field | "mctb_enabled" | "voicemail_greeting_id";

/**
 * The select's stand-in for "no recording".
 *
 * A Radix Select cannot hold an empty-string value, and null is not a value it
 * can carry at all — so the written-words option needs a sentinel. It is
 * translated back to null on the way out, which is what the column means.
 */
const WRITTEN = "__written__";

const FIELDS: { key: Field; label: string; hint: string; multiline?: boolean }[] = [
  {
    key: "label",
    label: "Name for this line",
    hint: "Used in the greeting, on missed-call texts, and wherever this line introduces itself.",
  },
  {
    key: "voicemail_greeting",
    label: "Voicemail greeting",
    hint: "What a caller hears when nobody picks up.",
    multiline: true,
  },
  {
    key: "away_message",
    label: "After-hours reply",
    hint: "The text sent when somebody messages this line outside your hours.",
    multiline: true,
  },
  {
    key: "mctb_message",
    label: "Missed-call text",
    hint: "What a caller gets when nobody picks up and they hang up.",
    multiline: true,
  },
];

const EMPTY_DRAFT: Draft = {
  label: "",
  voicemail_greeting: "",
  away_message: "",
  mctb_message: "",
  mctb_enabled: false,
};

/** The boxes, plus the one switch. */
type Draft = Record<Field, string> & { mctb_enabled: boolean };

/** The boxes start at what a caller GETS, inherited or not. */
function draftOf(identity: NumberIdentity): Draft {
  return {
    label: identity.label.value,
    voicemail_greeting: identity.voicemail_greeting.value ?? "",
    away_message: identity.away_message.value ?? "",
    mctb_message: identity.mctb_message.value ?? "",
    // The switch starts at what a missed caller gets TODAY, never off.
    // *Applying: Smart Defaults.*
    mctb_enabled: identity.mctb_enabled.value,
  };
}

/**
 * Only what actually changed.
 *
 * A field left alone must not be SENT — sending the resolved value back would
 * turn an inherited field into an override just by opening the dialog, and the
 * line would stop following the workspace without anybody choosing that.
 */
export function patchFrom(
  identity: NumberIdentity,
  draft: Draft,
): NumberIdentityPatch {
  const patch: NumberIdentityPatch = {};
  for (const field of FIELDS) {
    const current = identity[field.key].value ?? "";
    if (draft[field.key] !== current) patch[field.key] = draft[field.key];
  }
  // The switch, by the same rule. Flipping it to the value it already shows is
  // not a change — and sending it anyway would turn an inherited toggle into
  // an override just by opening the dialog, which is the one thing this
  // function exists to prevent.
  if (draft.mctb_enabled !== identity.mctb_enabled.value) {
    patch.mctb_enabled = draft.mctb_enabled;
  }
  return patch;
}
