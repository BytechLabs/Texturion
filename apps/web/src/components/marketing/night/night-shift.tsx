import {
  InBubble,
  NightShell,
  NoteRow,
  OutBubble,
  StatusPill,
  SystemLine,
  TagChip,
  TaskCardMini,
  UsageMeter,
} from "@/components/marketing/night/kit";
import { Reveal } from "@/components/marketing/ui/reveal";
import { Section } from "@/components/marketing/ui/section";

/**
 * S3 — "The night shift" (v3 spec §6 S3; copy deck S3).
 *
 * v3 "Quiet daylight": a calm, normal-height section. LEFT: the five story
 * steps as a static <ol> (mono time, Besley caption, one detail line). RIGHT:
 * the fully resolved conversation in one clean white thread card, plus the
 * usage meter beneath. Everything is server markup revealed with the standard
 * [data-reveal] stagger; the only motion inside the card is the delivery-tick
 * step, which fires once when the card's <Reveal> wrapper reveals (kit
 * contract: [data-revealed="true"] triggers .nx-tick). No sticky, no beats,
 * no sentinels, no tints, no island. No-JS / reduced motion reads the same
 * finished scene.
 */

/* Copy (deck S3). Times + step captions are the deck's beats, verbatim. The
   auto-append line in the reply holds the page's ONLY dash: the product's
   literal appended string, UI truth reproduced faithfully (deck note 2). */
const STEPS = [
  {
    time: "9:47 PM",
    caption: "A lead texts your number.",
    detail: "Dana’s text lands in the shared inbox, unread and marked New.",
  },
  {
    time: "9:49 PM",
    caption: "Reply without breaking the rules.",
    detail: "One honest question first, then the reply goes out. Queued, sent, delivered.",
  },
  {
    time: "9:52 PM",
    caption: "The crew talks behind the thread.",
    detail: "The quote goes out. Marcus takes the job and leaves a note the customer never sees.",
  },
  {
    time: "6:52 AM",
    caption: "Yes is a task, not a memory.",
    detail: "The yes becomes a task on Marcus’s list, due at 8:00 AM.",
  },
  {
    time: "7:00 AM",
    caption: "500 outbound segments included on Starter. Inbound is free.",
    detail: "The dashboard shows included, used, and overage at all times.",
  },
] as const;

/** The resolved Reyes Plumbing thread, one clean white card (kit-styled). */
function ThreadCard() {
  return (
    <NightShell
      ariaLabel="Demo: a Reyes Plumbing conversation in the Loonext inbox"
      sidebar={false}
      className="w-full max-w-xl"
      threadExtra={
        <div className="flex items-center justify-between gap-3 border-b border-[color:var(--rule-light)] px-4 py-2.5 sm:px-5">
          <span className="min-w-0 truncate text-[0.8125rem] font-semibold text-[color:var(--day-ink)]">
            Dana Whitfield
          </span>
          <StatusPill status="Closed" />
        </div>
      }
      thread={
        <>
          <InBubble>
            Hi, saw your truck on Cedar St. Our water heater is leaking into the
            garage. Too late to text?
          </InBubble>

          {/* Ticks step queued -> sent -> delivered once the card reveals;
              450ms lets the reveal rise seat first. The append slot is the
              product's literal auto-appended line (the page's only dash). */}
          <OutBubble
            style={{ "--nx-tick-delay": "450ms" } as React.CSSProperties}
            append={<>&mdash; Reyes Plumbing. Reply STOP to opt out.</>}
          >
            Not too late. Shut the cold valve on top of the tank if you can
            reach it. We can be there at 8 tomorrow morning.
          </OutBubble>

          <OutBubble ticks={false}>
            Here&rsquo;s the number: new 50 gal, $1,450 installed, haul away
            included. Good for 30 days.
          </OutBubble>

          <SystemLine>Assigned to Marcus</SystemLine>

          <NoteRow author="Marcus">
            on Cedar St tomorrow anyway, I&rsquo;ll bring the 50 gal.
          </NoteRow>

          <li className="flex flex-wrap items-center gap-2 self-start">
            <TagChip>Quote sent</TagChip>
            <TagChip>Scheduled</TagChip>
            <TagChip tone="won">Won</TagChip>
          </li>

          <InBubble>Yes please, 8 works. Gate code 4418.</InBubble>

          <TaskCardMini
            as="li"
            done
            title="Replace 50 gal water heater"
            assignee="Marcus"
            due="today 8:00 AM"
            className="self-start"
          />
        </>
      }
    />
  );
}

export function NightShift() {
  return (
    <Section id="night-shift" defer intrinsic={1100}>
      <Reveal className="max-w-2xl">
        <h2 className="display-h2">Watch one lead cross the night.</h2>
        <p className="mt-4 text-[1.0625rem] leading-[1.65] text-[color:var(--ink-70)]">
          9:47 pm to 7:00 am, in the real interface. Nothing here is a
          screenshot.
        </p>
      </Reveal>

      <div className="mt-10 grid items-start gap-10 sm:mt-14 lg:grid-cols-[minmax(15rem,19rem)_minmax(0,1fr)] lg:gap-14">
        <ol className="flex flex-col gap-7">
          {STEPS.map((step, i) => (
            <Reveal as="li" key={step.time} delay={Math.min(i, 3) * 60}>
              <p className="font-mono-mkt text-xs tracking-[0.02em] text-[color:var(--ink-55)]">
                {step.time}
              </p>
              <h3 className="display-h3 mt-1.5 max-w-[26ch] text-balance">
                {step.caption}
              </h3>
              <p className="mt-1.5 max-w-[42ch] text-sm leading-[1.55] text-[color:var(--ink-70)]">
                {step.detail}
              </p>
            </Reveal>
          ))}
        </ol>

        {/* One reveal for the whole column: the card rises, then the reply's
            ticks step ([data-revealed="true"] trigger, no island). */}
        <Reveal>
          <ThreadCard />
          <UsageMeter className="mt-4 w-full max-w-xl" />
          <p className="mt-4 text-[0.8125rem] text-[color:var(--ink-55)]">
            Demo thread. This is the real interface.
          </p>
        </Reveal>
      </div>
    </Section>
  );
}
