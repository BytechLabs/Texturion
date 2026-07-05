import {
  ConsentRow,
  NoteRow,
  QuietHoursDialog,
  StatusPill,
  TagChip,
  TaskCardMini,
} from "@/components/marketing/night/kit";
import { Reveal, RevealGroup } from "@/components/marketing/ui/reveal";
import { Section } from "@/components/marketing/ui/section";
import { cn } from "@/lib/utils";

/**
 * S4 — "The crew's tools" (v3 "Quiet daylight" spec §6 S4, copy deck S4).
 *
 * A normal light section: H2 + intro line, then the disciplined 3x2 grid of
 * six white panel-cards, each docked with a working micro-fragment of that
 * exact UI from the restyled (light) kit. The dawn transition band, the night
 * wells around the fragments, and every nxd- rule (sky gradient, STAMP
 * wiring) are gone.
 *
 * Motion: <Reveal>/<RevealGroup> staggers only. Server component, zero JS of
 * its own.
 */

/**
 * The saved-replies picker recreation (copy deck S4 card 5): the Templates
 * pick-list as it reads in the composer, first reply highlighted the way the
 * shell marks its active row (petrol tint + petrol, the kit's active look).
 * Static picture — spans, no tab stops, no false affordances (kit convention).
 */
function SavedRepliesPicker() {
  const replies = ["On our way", "Quote follow-up", "Running late"];
  return (
    <div className="font-body-mkt w-full max-w-xs rounded-xl border border-[rgba(11,43,38,0.08)] bg-white p-1.5">
      <span className="block px-2 pb-1.5 pt-1 text-[0.6875rem] font-semibold text-[color:var(--ink-55)]">
        Templates
      </span>
      <ul className="grid gap-px">
        {replies.map((reply, i) => (
          <li key={reply}>
            <span
              className={cn(
                "flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-[0.8125rem]",
                i === 0
                  ? "bg-[color:var(--petrol-12)] font-medium text-[color:var(--petrol)]"
                  : "text-[color:var(--ink-70)]",
              )}
            >
              {reply}
              {i === 0 ? (
                /* Insert-arrow on the active row, petrol via currentColor. */
                <svg
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                  className="size-3.5 shrink-0"
                >
                  <path d="M2.5 8h9.5" />
                  <path d="m8.5 4.5 3.5 3.5-3.5 3.5" />
                </svg>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * One feature card: white panel-card, H3 + body, and the docked
 * micro-fragment sitting directly on the card (the light kit needs no well).
 */
function FeatureCard({
  title,
  body,
  fragment,
}: {
  title: string;
  body: React.ReactNode;
  fragment: React.ReactNode;
}) {
  return (
    <article className="panel-card flex h-full flex-col rounded-xl p-5 sm:p-6">
      <h3 className="display-h3">{title}</h3>
      <p className="mt-2.5 text-base leading-[1.65] text-[color:var(--ink-70)]">{body}</p>
      <div className="mt-auto pt-5">{fragment}</div>
    </article>
  );
}

export function DaylightFeatures() {
  return (
    <Section id="day" defer intrinsic={1560}>
      <Reveal className="max-w-2xl">
        <h2 className="display-h2">Run the day from one inbox.</h2>
        <p className="mt-4 text-[1.0625rem] leading-[1.65] text-[color:var(--ink-70)]">
          No dashboards to babysit. Statuses, tags, notes, tasks, templates, and
          manners. That’s the whole system.
        </p>
      </Reveal>

      <RevealGroup className="mt-10 grid gap-4 sm:mt-12 sm:grid-cols-2 sm:gap-5 lg:grid-cols-3">
        <FeatureCard
          title="Know where every job stands"
          body={
            <>
              Every conversation is New, Open, Waiting, or Closed. Nobody asks
              &ldquo;did anyone get back to them&rdquo; twice.
            </>
          }
          fragment={
            <div className="flex flex-wrap items-center gap-1.5">
              {(["New", "Open", "Waiting", "Closed"] as const).map((status) => (
                <StatusPill key={status} status={status} />
              ))}
            </div>
          }
        />
        <FeatureCard
          title="Tag the money"
          body="Quote sent, Scheduled, Won, Lost. On Friday, filter to Quote sent and chase whatever stalled."
          fragment={
            <div className="flex flex-wrap items-center gap-1.5">
              <TagChip>Quote sent</TagChip>
              <TagChip>Scheduled</TagChip>
              {/* Won is the money tag: copper, one of copper's three uses. */}
              <TagChip tone="won">Won</TagChip>
              <TagChip>Lost</TagChip>
            </div>
          }
        />
        <FeatureCard
          title="Talk behind the thread"
          body="Leave a note the customer never sees. The gate code lives next to the message, not in somebody’s head."
          fragment={
            <NoteRow as="div" author="Marcus">
              gate code 4418, dog is friendly
            </NoteRow>
          }
        />
        <FeatureCard
          title="Turn a yes into a task"
          body="Promote any message to a task with an assignee and a due date. The job leaves the chat and lands on someone’s list."
          fragment={
            <TaskCardMini
              title="Replace 50 gal water heater"
              assignee="Marcus"
              due="today 8:00 AM"
            />
          }
        />
        <FeatureCard
          title="Stop typing the same three sentences"
          body="Save the replies you send every day. On our way, here’s the quote, we’re running late. Two taps and it’s sent."
          fragment={<SavedRepliesPicker />}
        />
        <FeatureCard
          title="Built polite on purpose"
          body="New conversations start with one checkbox, and late-night sends get one honest question first. Your number stays welcome in their phone."
          fragment={
            <div className="grid justify-items-start gap-3">
              <ConsentRow />
              <QuietHoursDialog />
            </div>
          }
        />
      </RevealGroup>
    </Section>
  );
}
