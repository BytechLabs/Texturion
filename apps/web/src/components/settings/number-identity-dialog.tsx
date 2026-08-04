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
import { ringsIn } from "@/components/settings/ring-card";
import { activeSources, useLeadSources } from "@/lib/api/lead-sources";
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
  const sources = useLeadSources(open);

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
            {/*
              #278: what THIS line does after hours.

              Per number because a service line and a sales line are two
              businesses, and the one that must reach somebody at 3am is rarely
              the one taking invoice questions. "Same as your workspace" is
              first and is the default position — every line inherits until
              somebody says otherwise, and the option that is always correct is
              the one that needs no thought. *Applying: Smart Defaults.*
            */}
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <Label htmlFor="identity-after-hours">After-hours calls</Label>
                {identity.data.after_hours_calls.inherited ? (
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
                      void restoreWorkspaceValue("after_hours_calls")
                    }
                  >
                    Use the workspace&apos;s
                  </Button>
                )}
              </div>
              <Select
                value={
                  identity.data.after_hours_calls.inherited
                    ? INHERIT
                    : identity.data.after_hours_calls.value
                }
                onValueChange={(next) =>
                  void save.mutateAsync({
                    after_hours_calls:
                      next === INHERIT
                        ? null
                        : (next as NumberIdentity["after_hours_calls"]["value"]),
                  })
                }
              >
                <SelectTrigger id="identity-after-hours">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={INHERIT}>
                    Same as your workspace
                  </SelectItem>
                  <SelectItem value="ring_everyone">
                    Ring everyone, day or night
                  </SelectItem>
                  <SelectItem value="on_call_only">
                    Ring only whoever&apos;s on call
                  </SelectItem>
                  <SelectItem value="voicemail">Take a message</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[12px] text-app-muted-2">
                Outside this line&apos;s hours. With nobody on call, the last
                two still differ — one rings the crew anyway, the other takes a
                message.
              </p>
            </div>
            {/*
              #278: how THIS line rings. Same inherit-first shape as everything
              else here — the option that is always correct is the one that
              needs no thought.
            */}
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <Label htmlFor="identity-ring">How the phones ring</Label>
                {identity.data.ring_strategy.inherited ? (
                  <span className="text-[12px] text-app-muted-2">
                    Same as your workspace
                  </span>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-auto px-1.5 py-0.5 text-[12px]"
                    disabled={save.isPending}
                    onClick={() => void restoreWorkspaceValue("ring_strategy")}
                  >
                    Use the workspace&apos;s
                  </Button>
                )}
              </div>
              <Select
                value={
                  identity.data.ring_strategy.inherited
                    ? INHERIT
                    : identity.data.ring_strategy.value
                }
                onValueChange={(next) =>
                  void save.mutateAsync({
                    ring_strategy:
                      next === INHERIT
                        ? null
                        : (next as NumberIdentity["ring_strategy"]["value"]),
                  })
                }
              >
                <SelectTrigger id="identity-ring">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={INHERIT}>Same as your workspace</SelectItem>
                  <SelectItem value="all">All at once</SelectItem>
                  <SelectItem value="in_turn">One at a time</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <Label htmlFor="identity-ring-seconds">How long they ring</Label>
                {identity.data.ring_seconds.inherited ? (
                  <span className="text-[12px] text-app-muted-2">
                    Same as your workspace
                  </span>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-auto px-1.5 py-0.5 text-[12px]"
                    disabled={save.isPending}
                    onClick={() => void restoreWorkspaceValue("ring_seconds")}
                  >
                    Use the workspace&apos;s
                  </Button>
                )}
              </div>
              <Select
                value={
                  identity.data.ring_seconds.inherited
                    ? INHERIT
                    : String(identity.data.ring_seconds.value)
                }
                onValueChange={(next) =>
                  void save.mutateAsync({
                    ring_seconds: next === INHERIT ? null : Number(next),
                  })
                }
              >
                <SelectTrigger id="identity-ring-seconds">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={INHERIT}>Same as your workspace</SelectItem>
                  {RING_SECOND_CHOICES.map((value) => (
                    <SelectItem key={value} value={String(value)}>
                      {value} seconds · about {ringsIn(value)} rings
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {/*
              #301: where calls and texts to THIS line come from.

              The one field here that does NOT inherit, and the copy says so
              rather than offering "same as your workspace": a lead source is a
              fact about a specific line — the number on the truck, the number
              in the ad — and a workspace default would attribute every line to
              the same place, which is the opposite of what tracking numbers
              are for. Hidden entirely until the workspace has a vocabulary,
              because a picker with one option reading "None" teaches nothing.
            */}
            {activeSources(sources.data?.data).length > 0 && (
              <div className="space-y-1.5">
                <Label htmlFor="identity-lead-source">Where this line is advertised</Label>
                <Select
                  value={identity.data.lead_source_id ?? UNTRACKED}
                  onValueChange={(next) =>
                    void save.mutateAsync({
                      lead_source_id: next === UNTRACKED ? null : next,
                    })
                  }
                >
                  <SelectTrigger id="identity-lead-source">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={UNTRACKED}>Not advertised anywhere</SelectItem>
                    {activeSources(sources.data?.data).map((row) => (
                      <SelectItem key={row.id} value={row.id}>
                        {row.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[12px] text-app-muted-2">
                  Every new conversation on this line is counted here, with
                  nobody tapping anything. Changing it later does not relabel
                  the customers you already have.
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
type ClearableField =
  | Field
  | "mctb_enabled"
  | "voicemail_greeting_id"
  // #278: null is INHERIT here too, and it is a value an owner sets on purpose
  // — a line that was set to take messages after hours has to be able to go
  // back to following the workspace.
  | "after_hours_calls"
  | "ring_strategy"
  | "ring_seconds";

/**
 * The select's stand-in for "no recording".
 *
 * A Radix Select cannot hold an empty-string value, and null is not a value it
 * can carry at all — so the written-words option needs a sentinel. It is
 * translated back to null on the way out, which is what the column means.
 */
const WRITTEN = "__written__";

/** The select's "follow the workspace" sentinel — Radix cannot hold null. */
const INHERIT = "__inherit__";

/** #301's own sentinel, and deliberately NOT the inherit one: an untracked
 *  line follows nothing, it simply is not advertised. */
const UNTRACKED = "__untracked__";

/** The same four the workspace card offers, so the two never disagree about
 *  what a reasonable ring length is. */
const RING_SECOND_CHOICES = [15, 20, 30, 45];

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
