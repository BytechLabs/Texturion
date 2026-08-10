"use client";

import {
  DASHBOARD_PANEL_IDS,
  DASHBOARD_PANEL_LABELS,
  DASHBOARD_PANEL_NOTES,
  type DashboardPanelId,
} from "@loonext/shared";
import { SlidersHorizontal } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { useT } from "@/i18n/provider";
import { useHiddenPanels, useSetHiddenPanels } from "@/lib/api/me-company";

/**
 * #540 — "Customise", on the dashboard, next to the dashboard.
 *
 * ## Evaluation
 *
 * The complaint was that the landing screen is not customisable. The reading that
 * matters is narrower than "let them move everything": an owner who never sells
 * on referrals reads past "Where customers came from" every single morning, and a
 * screen you cannot adjust slowly becomes somebody else's screen.
 *
 * ## What binds it
 *
 * *Zen of Clarity* — five switches ON the dashboard would be five controls
 * competing with the work. This is one quiet button that opens a panel, and the
 * panel is the only place the switches exist.
 *
 * *The Safety Principle* — the control goes in the header cluster that already
 * holds search and notifications. A new affordance in the middle of the page
 * would move the thing it is meant to let you tidy.
 *
 * *Direct manipulation* — the switch takes effect behind the open panel, with no
 * Save button and no spinner. The member is looking at the screen they are
 * changing, so the feedback is the screen changing. A Save step here would make a
 * layout preference feel like a form submission, and worse, would let somebody
 * close the panel and lose it.
 *
 * ## What is deliberately NOT offered
 *
 * The queue. Not "Unassigned", not "Waiting on you", not "Chase these". Hiding
 * those is not a preference — it is a way to stop seeing customers nobody has
 * answered, and the first time it matters the cost is somebody's job. The reason
 * is written down in `packages/shared/src/dashboard-panels.ts`, which is also
 * where a test enforces that no queue id ever appears in this list.
 *
 * Manual reordering, too: the queue is now ordered by what has actually gone
 * wrong, and a member-set order would sit on top of that and put an overdue task
 * below "Unread".
 *
 * *Applying: Zen of Clarity, the Safety Principle, and Chunking — two groups of
 * related switches rather than one list of five.*
 */
export function CustomiseDashboard() {
  const t = useT();
  const hidden = useHiddenPanels();
  const save = useSetHiddenPanels();

  function toggle(panel: DashboardPanelId, visible: boolean) {
    const next = visible
      ? hidden.filter((id) => id !== panel)
      : [...hidden, panel];
    save.mutate(next);
  }

  // The measures answer "how is the business doing"; recent calls is history.
  // Two groups rather than a flat five, because a heading is what tells somebody
  // scanning the list which half of it they came here for.
  const measures = DASHBOARD_PANEL_IDS.filter((id) => id !== "recent_calls");
  const history = DASHBOARD_PANEL_IDS.filter((id) => id === "recent_calls");

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          // THE MARK MATTERS MORE THAN IT LOOKS LIKE IT DOES. Somebody who put
          // two panels away in April has no other way to find out why their
          // dashboard is shorter than a colleague's — and "the app is missing
          // the pipeline card" is a support conversation nobody can win. The dot
          // is the quiet version of the answer; the label is the precise one, so
          // a screen reader gets the number rather than "a dot".
          aria-label={
            hidden.length > 0
              ? t(
                  hidden.length === 1
                    ? "inbox.customiseAriaPutAwayOne"
                    : "inbox.customiseAriaPutAwayMany",
                  { count: hidden.length },
                )
              : t("inbox.customiseAria")
          }
          className="relative grid size-8 place-items-center rounded-[9px] border border-app-line bg-app-paper text-app-muted transition-colors hover:bg-app-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <SlidersHorizontal className="size-[15px]" strokeWidth={1.9} aria-hidden />
          {hidden.length > 0 && (
            <span
              aria-hidden
              className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-app-olive-deep ring-2 ring-app-paper"
            />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[19rem] p-0">
        <div className="border-b border-app-line px-4 py-3">
          <p className="text-[13px] font-semibold text-app-ink">
            {t("inbox.customiseTitle")}
          </p>
          {/* Says what is NOT on offer, once, here — rather than leaving
              somebody to hunt for a switch that does not exist. */}
          <p className="mt-0.5 text-[12px] leading-snug text-app-muted">
            {t("inbox.customiseQueueStays")}
          </p>
        </div>
        <div className="px-4 py-3">
          <PanelGroup
            heading={t("inbox.customiseGroupMeasures")}
            panels={measures}
            hidden={hidden}
            onToggle={toggle}
          />
          <PanelGroup
            heading={t("inbox.customiseGroupHistory")}
            panels={history}
            hidden={hidden}
            onToggle={toggle}
            className="mt-4 border-t border-app-line pt-3"
          />
        </div>
        {/* One line, and only when a write has actually failed. Optimistic
            toggles mean the panel has already moved by the time this appears, so
            it has to say that it went back rather than that something is
            pending. */}
        {save.isError && (
          <p
            role="status"
            className="border-t border-app-line px-4 py-2 text-[12px] text-app-clay"
          >
            {t("inbox.customiseSaveFailed")}
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}

function PanelGroup({
  heading,
  panels,
  hidden,
  onToggle,
  className,
}: {
  heading: string;
  panels: readonly DashboardPanelId[];
  hidden: readonly string[];
  onToggle: (panel: DashboardPanelId, visible: boolean) => void;
  className?: string;
}) {
  return (
    <div className={className}>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-app-muted">
        {heading}
      </p>
      <div className="mt-2 space-y-3">
        {panels.map((id) => {
          const visible = !hidden.includes(id);
          return (
            <div key={id} className="flex items-start justify-between gap-3">
              {/* The label is the control's label, so the whole name is a hit
                  target — a 20px switch is a poor thing to ask a thumb for. */}
              <label
                htmlFor={`panel-${id}`}
                className="cursor-pointer select-none"
              >
                <span
                  id={`panel-${id}-label`}
                  className="block text-[13px] font-medium text-app-ink"
                >
                  {DASHBOARD_PANEL_LABELS[id]}
                </span>
                <span
                  id={`panel-${id}-note`}
                  className="mt-0.5 block text-[12px] leading-snug text-app-muted"
                >
                  {DASHBOARD_PANEL_NOTES[id]}
                </span>
              </label>
              {/* The switch is a `button role="switch"`, so `<label for>` gives
                  it a click target but NOT reliably a name — the accessible name
                  of a button comes from its own content, and this one has none.
                  Pointed at the two lines explicitly: the heading is the name,
                  the reason is the description. */}
              <Switch
                id={`panel-${id}`}
                aria-labelledby={`panel-${id}-label`}
                aria-describedby={`panel-${id}-note`}
                checked={visible}
                onCheckedChange={(next) => onToggle(id, next)}
                className="mt-0.5 shrink-0"
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
