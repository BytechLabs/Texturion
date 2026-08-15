"use client";

import { useState } from "react";
import { toast } from "sonner";

import {
  ON_CALL_COPY,
  ON_CALL_PRESETS,
  onCallLine,
  onCallWindow,
  type OnCallPreset,
} from "@loonext/shared";

import { SettingsCard } from "@/components/settings/section";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { sayWith, useT } from "@/i18n/provider";
import { ApiError } from "@/lib/api/error";
import {
  useCreateOnCallShift,
  useEndOnCallShift,
  useOnCallShifts,
  type OnCallShift,
} from "@/lib/api/on-call";
import { useMembers } from "@/lib/api/team";
import { cn } from "@/lib/utils";

/**
 * #244 — who is holding the phone tonight.
 *
 * Design notes, and the principles behind them:
 *
 * - **The empty state is the default, and it states the CONSEQUENCE.** Every
 *   existing workspace has no rota, so a blank card would read as a gap
 *   somebody forgot to fill. What an owner needs to know is what "nobody on
 *   call" actually costs them — everyone gets woken — because that, not the
 *   absence of a row, is the thing they might want to change.
 *   *Applying: Loss Aversion — frame the choice around what the crew is
 *   currently losing (their nights), not around a feature they could enable.*
 *
 * - **Three presets, not a datetime builder.** The real decision is "Dana has
 *   tonight". Start and end pickers turn a five-second choice into a form, and
 *   a form does not get filled in from a van. Same argument #237 made about
 *   reminder offsets. *Applying: Chunking, and Smart Defaults — the person
 *   defaults to whoever is looking, which is right for the solo owner who is
 *   most of this product's users.*
 *
 * - **The escalation promise is on the card, not in a doc.** Putting one
 *   person on call is only a good decision if the owner knows what happens
 *   when that person sleeps through it. Hiding the safety net would make this
 *   feel riskier than it is, and a feature that feels risky at 6pm gets turned
 *   off at 6:05.
 *
 * - **Ending a shift is one click, with no confirmation.** It is instantly
 *   reversible and it FAILS SAFE: with nobody on call the alert goes to
 *   everyone, which is the pre-#244 behaviour. Friction belongs on the
 *   irreversible edge, and this edge is the opposite of that.
 *   *Applying: Ethical Friction, applied where it belongs rather than
 *   everywhere.*
 */

/** The workspace's current offset from UTC, in minutes. */
function offsetMinutesNow(): number {
  // The browser's own offset. A crew setting their rota is nearly always in
  // the workspace's timezone — and where they are not, "tonight" still means
  // tonight where the person tapping is, which is the more useful reading of
  // an owner covering their own evening from a hotel.
  return -new Date().getTimezoneOffset();
}

function formatUntil(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function OnCallCard({ canEdit }: { canEdit: boolean }) {
  const t = useT();
  // #228: the shared on-call copy names catalogue keys, so this says them in
  // the reader's language.
  const say = sayWith(t);
  const shifts = useOnCallShifts();
  const members = useMembers();
  const create = useCreateOnCallShift();
  const end = useEndOnCallShift();
  const [userId, setUserId] = useState<string | null>(null);

  const roster = members.data?.data ?? [];
  const nameOf = (id: string) =>
    roster.find((member) => member.user_id === id)?.display_name ??
    t("settingsMore.someone");

  const now = Date.now();
  const live: OnCallShift | undefined = shifts.data?.find(
    (shift: OnCallShift) =>
      new Date(shift.starts_at).getTime() <= now &&
      new Date(shift.ends_at).getTime() > now,
  );
  const upcoming = (shifts.data ?? []).filter(
    (shift: OnCallShift) => shift !== live,
  );

  async function put(preset: OnCallPreset) {
    const target = userId ?? roster[0]?.user_id;
    if (!target) return;
    const window = onCallWindow(preset, new Date(), offsetMinutesNow());
    try {
      await create.mutateAsync({ user_id: target, ...window });
      toast.success(
        t("settingsMore.onCallPersonOnCall", { name: nameOf(target) }),
      );
    } catch (cause) {
      toast.error(
        cause instanceof ApiError
          ? cause.message
          : t("settingsMore.onCallSetFailed"),
      );
    }
  }

  return (
    <SettingsCard
      title={say(ON_CALL_COPY.heading)}
      description={say(ON_CALL_COPY.escalation)}
    >
      {shifts.isPending ? (
        <Skeleton className="h-5 w-64" />
      ) : live ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[14px] text-app-ink">
            {onCallLine(nameOf(live.user_id), formatUntil(live.ends_at), say)}
          </p>
          {canEdit ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={end.isPending}
              onClick={() => end.mutate(live.id)}
            >
              {t("settingsMore.onCallEndShift")}
            </Button>
          ) : null}
        </div>
      ) : (
        // Not "no shifts". The sentence says what the current state costs.
        <p className="text-[14px] text-app-muted-2">{say(ON_CALL_COPY.nobody)}</p>
      )}

      {upcoming.length > 0 ? (
        <ul className="mt-3 space-y-1 border-t border-app-line pt-3">
          {upcoming.map((shift: OnCallShift) => (
            <li
              key={shift.id}
              className="flex items-center justify-between gap-3 text-[13px] text-app-muted-2"
            >
              <span>
                {nameOf(shift.user_id)} · {formatUntil(shift.starts_at)} →{" "}
                {formatUntil(shift.ends_at)}
              </span>
              {canEdit ? (
                <button
                  type="button"
                  onClick={() => end.mutate(shift.id)}
                  className="tap-target underline underline-offset-2 hover:text-app-ink"
                >
                  {t("settingsMore.remove")}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {canEdit ? (
        <div className="mt-4 space-y-2 border-t border-app-line pt-4">
          <Label htmlFor="on-call-member" className="text-[13px]">
            {t("settingsMore.onCallPutSomebody")}
          </Label>
          <div className="flex flex-wrap items-center gap-2">
            <select
              id="on-call-member"
              value={userId ?? roster[0]?.user_id ?? ""}
              onChange={(event) => setUserId(event.target.value)}
              className="h-9 rounded-app-input border border-app-line bg-app-paper px-2 text-[13px] text-app-ink"
            >
              {roster.map((member) => (
                <option key={member.user_id} value={member.user_id}>
                  {member.display_name}
                </option>
              ))}
            </select>
            {ON_CALL_PRESETS.map((preset) => (
              <Button
                key={preset.key}
                variant="secondary"
                size="sm"
                disabled={create.isPending || roster.length === 0}
                title={preset.detail}
                onClick={() => put(preset.key)}
              >
                {preset.label}
              </Button>
            ))}
          </div>
          <p className={cn("text-[12px] text-app-muted-2")}>
            {ON_CALL_PRESETS.map((preset) => `${say(preset.label)}: ${say(preset.detail)}`).join(
              " · ",
            )}
          </p>
        </div>
      ) : (
        <p className="mt-3 text-[12px] text-app-muted-2">
          {say(ON_CALL_COPY.read_only)}
        </p>
      )}
    </SettingsCard>
  );
}
