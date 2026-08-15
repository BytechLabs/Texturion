"use client";

import { toast } from "sonner";

import {
  BATCH_WINDOW_CHOICES,
  CATEGORY_LABELS,
  DEFAULT_BATCH_WINDOW,
  DELIVERY_COPY,
  DELIVERY_MODES,
  NOTIFICATION_CATEGORIES,
  type DeliveryMode,
  type NotificationCategory,
} from "@loonext/shared";

import { SettingsCard } from "@/components/settings/section";
import { Label } from "@/components/ui/label";
import { sayWith, useT } from "@/i18n/provider";
import { ApiError } from "@/lib/api/error";
import type { NotificationPrefs } from "@/lib/api/types";
import { cn } from "@/lib/utils";

/**
 * #297 — how loud each kind of notification is.
 *
 * Design notes, and the principles behind them:
 *
 * - **The promise comes first, above every control.** "An emergency always
 *   arrives straight away, whatever you choose here." Without that sentence
 *   nobody picks a quieter setting, because the fear is missing the call that
 *   mattered — and they go back to turning notifications off entirely, which is
 *   the failure this feature exists to prevent.
 *   *Applying: Loss Aversion, read the right way round — name what they do NOT
 *   lose, because that is what stands between them and the setting.*
 *
 * - **One row per category, one decision each.** Six categories times three
 *   modes is eighteen controls; as a flat list of switches it is a form. As six
 *   rows each holding one three-way choice it is six small decisions, which is
 *   the shape the brain can hold. *Applying: Chunking.*
 *
 * - **The window and the summary time appear only when they mean something.**
 *   A batch window is noise until something is batched. *Applying: Zen of
 *   Clarity, and progressive disclosure rather than a settings wall.*
 *
 * - **"Once a day" says it is HELD, not discarded.** It is the option people
 *   misread as off, and the misreading costs them messages they wanted.
 */

/** The label under each mode, kept next to the mode it describes. */
const MODE_LABEL: Record<DeliveryMode, string> = {
  // #228: catalogue keys, said by the component. This table is module scope
  // and cannot reach a hook.
  immediate: DELIVERY_COPY.immediate,
  batched: DELIVERY_COPY.batched,
  summary: DELIVERY_COPY.summary,
};

export function DeliveryModesCard({
  prefs,
  onSave,
  saving,
}: {
  prefs: NotificationPrefs;
  onSave: (next: NotificationPrefs) => Promise<unknown>;
  saving: boolean;
}) {
  const t = useT();
  // #228: the shared delivery tables name keys, so this card says them in
  // the reader's language.
  const say = sayWith(t);
  const delivery = (prefs.delivery ?? {}) as Partial<
    Record<NotificationCategory, DeliveryMode>
  >;
  // An absent key means immediate — the server's rule, not this component's, so
  // the two cannot drift.
  const modeOf = (category: NotificationCategory): DeliveryMode =>
    delivery[category] ?? "immediate";

  const anyBatched = NOTIFICATION_CATEGORIES.some(
    (category) => modeOf(category) === "batched",
  );
  const anySummary = NOTIFICATION_CATEGORIES.some(
    (category) => modeOf(category) === "summary",
  );

  async function save(next: Partial<NotificationPrefs>) {
    try {
      await onSave({ ...prefs, ...next });
    } catch (cause) {
      toast.error(
        cause instanceof ApiError
          ? cause.message
          : t("settings.deliveryModesSaveFailed"),
      );
    }
  }

  function setMode(category: NotificationCategory, mode: DeliveryMode) {
    const next = { ...delivery };
    // Immediate is the default, so it is stored as ABSENCE. Writing it would
    // mean a member who never touched this looked different from one who chose
    // the default, and the two are the same thing.
    if (mode === "immediate") delete next[category];
    else next[category] = mode;

    save({
      delivery: next,
      // Turning something to batched with no window would fall back to the
      // default server-side anyway; naming it here means the number on screen
      // is the number in use.
      batch_window_minutes:
        Object.values(next).includes("batched")
          ? (prefs.batch_window_minutes ?? DEFAULT_BATCH_WINDOW)
          : null,
    });
  }

  return (
    <SettingsCard
      title={say(DELIVERY_COPY.heading)}
      description={say(DELIVERY_COPY.urgent_always)}
    >
      <div className="space-y-1">
        {NOTIFICATION_CATEGORIES.map((category) => (
          <div
            key={category}
            className="flex flex-wrap items-center justify-between gap-2 py-1.5"
          >
            <span className="text-[14px] text-app-ink">
              {say(CATEGORY_LABELS[category])}
            </span>
            <span
              className="flex items-center gap-0.5"
              role="group"
              aria-label={say(CATEGORY_LABELS[category])}
            >
              {DELIVERY_MODES.map((mode) => (
                <button
                  key={mode}
                  type="button"
                  disabled={saving}
                  aria-pressed={modeOf(category) === mode}
                  onClick={() => setMode(category, mode)}
                  className={cn(
                    "tap-target rounded-full px-2 py-0.5 text-[12px] font-semibold transition-colors duration-150 ease-out disabled:opacity-50",
                    modeOf(category) === mode
                      ? "bg-app-ink text-app-paper"
                      : "text-app-muted-2 hover:bg-app-hover",
                  )}
                >
                  {say(MODE_LABEL[mode])}
                </button>
              ))}
            </span>
          </div>
        ))}
      </div>

      {anySummary ? (
        <p className="pt-1 text-[12px] text-app-muted-2">
          {say(DELIVERY_COPY.summary_detail)}
        </p>
      ) : null}

      {anyBatched ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-app-line pt-3">
          <Label htmlFor="batch-window" className="text-[13px]">
            {t("settings.deliveryBatchEvery")}
          </Label>
          <select
            id="batch-window"
            disabled={saving}
            value={prefs.batch_window_minutes ?? DEFAULT_BATCH_WINDOW}
            onChange={(event) =>
              save({ batch_window_minutes: Number(event.target.value) })
            }
            className="h-9 rounded-app-input border border-app-line bg-app-paper px-2 text-[13px] tabular-nums text-app-ink"
          >
            {BATCH_WINDOW_CHOICES.map((minutes) => (
              <option key={minutes} value={minutes}>
                {t("settings.deliveryBatchMinutes", { minutes })}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-app-line pt-3">
        <Label htmlFor="summary-at" className="text-[13px]">
          {t("settings.deliverySummaryAt")}
        </Label>
        <input
          id="summary-at"
          type="time"
          disabled={saving}
          value={prefs.summary_at ?? ""}
          onChange={(event) =>
            save({ summary_at: event.target.value || null })
          }
          className="h-9 rounded-app-input border border-app-line bg-app-paper px-2 text-[13px] tabular-nums text-app-ink"
        />
        <span className="text-[12px] text-app-muted-2">
          {prefs.summary_at
            ? t("settings.deliverySummaryOn")
            : t("settings.deliverySummaryOff")}
        </span>
      </div>
    </SettingsCard>
  );
}
