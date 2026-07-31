/**
 * /features/tasks, on the v4 "FIRST RESPONSE" FEATURE template
 * (DESIGN-DIRECTION v4 §6, COPY-DECK v2).
 *
 * WHY THIS PAGE EXISTS (#491). Tasks have shipped as a whole app tab — list,
 * board, calendar and map, per docs/TASKS-V2.md — and the marketing site not
 * only omitted them, /for/contractors actively told buyers there was "no
 * separate screen, no board, no counts to maintain". This is the positive
 * half of that correction.
 *
 * THE LINE THIS PAGE HOLDS is the one in the FAQ: a job that came out of a
 * conversation, not a construction suite. Every absence named here (Gantt,
 * dependencies, dispatch, time tracking, invoicing) is a real absence, and
 * naming them is what makes the presences believable.
 *
 * D64: a task promotes a SOURCE, and the source is a message OR a call. That
 * is the sentence the whole page is built around — it is what makes this
 * different from a to-do app somebody also has open.
 */

import Link from "next/link";
import type { Metadata } from "next";

import { JsonLd } from "@/components/marketing/ui/json-ld";
import { PanelFrame } from "@/components/marketing/fr";
import { TaskBoardVisual } from "@/components/marketing/features/task-board-visual";
import {
  FeatureCta,
  FeatureFaq,
  FeatureHero,
  FeatureSection,
  PricingSnippet,
  RelatedLinks,
  TruthStripSection,
  UseCaseSteps,
} from "@/components/marketing/features/feature-page";
import { breadcrumbJsonLd, buildMetadata } from "@/lib/marketing/seo";
import { ACTIVATION_CLAIM } from "@/lib/marketing/activation";

const PATH = "/features/tasks";

export const metadata: Metadata = buildMetadata({
  title: "Turn a text or a call into a job",
  description:
    "Promote any customer message or call into a task with an owner, an address and a due date, still linked to what they said. Work it from a list, a board, a calendar or a map. $29/mo flat for the crew.",
  path: PATH,
});

export default function TasksPage() {
  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Home", path: "/" },
          { name: "Tasks", path: PATH },
        ])}
      />

      <FeatureHero
        dateline="THE JOB KEEPS ITS RECEIPT"
        title="Book the Hendersons for Tuesday. Now it lives somewhere."
        sub="A customer asks for something in a text or on the phone, and right now that promise lives in the head of whoever heard it. Promote the message into a task and it gets an owner, a due date and an address, and it stays linked to the exact words the customer used. Work it from a list, a board, a calendar you can drag, or a map of where everything is."
        panel={
          <PanelFrame
            caption="Thursday's board: what the crew promised, and who owns it."
            ariaLabel="The Loonext task board with to-do and done columns"
          >
            <TaskBoardVisual />
          </PanelFrame>
        }
      />

      <FeatureSection
        ground="frost"
        eyebrow="The core idea"
        heading="A task remembers where it came from."
      >
        <p>
          Every task keeps a link back to the message or the call that created
          it. Open the job and you can read what the customer actually wrote,
          in their words, months later. That is the difference between this and
          the notes app somebody on the crew is also using: a note is a retyped
          summary, and a retyped summary is where the gate code turns into the
          wrong gate code.
        </p>
        <p>
          It works from a call too. Somebody describes a job on the phone,
          hangs up, and the person who answered turns that call into a task
          without opening anything else. The task carries the call the way it
          carries a text.
        </p>
        <p>
          And it goes both ways. Task activity shows up inside the
          conversation, so a teammate reading the thread sees the job was
          created, assigned, and scheduled without leaving it.
        </p>
      </FeatureSection>

      <UseCaseSteps
        ground="white"
        eyebrow="Four ways to look at the same work"
        heading="Whichever view matches the question you are asking."
        steps={[
          {
            title: "List and board",
            body: "The flat list for working through, and a to-do and done board for the morning stand-up. Same tasks, same owners; only the arrangement changes.",
          },
          {
            title: "Calendar",
            body: "A month or a week of what is due. Drag a job to a different day to reschedule it, which is what actually happens when a van breaks down and Thursday becomes Friday.",
          },
          {
            title: "Map",
            body: "Every job with an address, plotted. Two calls on the same street stop being two separate trips, which is the one view that saves fuel rather than time.",
          },
          {
            title: "In the conversation",
            body: "Open a customer's thread and the jobs attached to it are right there as a checklist. You never have to remember whether you promised them something; the thread tells you.",
          },
        ]}
      />

      <TruthStripSection
        heading="The plain facts"
        items={[
          {
            text: "A task is created from a message or a call and stays linked to it. Title, description, owner, due date and address, all editable after the fact.",
            good: true,
          },
          {
            text: "Lou can fill in the address and the due date from what the customer wrote. Two separate switches, both on by default, both switchable off.",
          },
          {
            text: "This is the work that comes out of a conversation, not a construction suite. No Gantt charts, no dependencies, no crew dispatch, no time tracking, no invoicing.",
          },
          {
            text: "Tasks are included on every plan. There is no per-task charge and no separate project add-on.",
          },
        ]}
      />

      <PricingSnippet>
        <p>
          Tasks come with the inbox at one flat price for the whole crew:
          $29/mo on Starter for up to 3 people, $79/mo on Pro for up to 15.
          Nothing about tasks is metered, and nothing here is an add-on. If you
          want the detail on what IS metered, it is texting and calling minutes,
          both under our{" "}
          <Link
            href="/legal/fair-use"
            className="font-medium text-[color:var(--fr-olive)] underline-offset-2 hover:underline"
          >
            fair use policy
          </Link>
          .
        </p>
      </PricingSnippet>

      <RelatedLinks
        heading="Where jobs come from"
        intro="A task is the second half of a conversation. Here is the first half, and the assistant that fills in the boring parts."
        links={[
          {
            label: "Shared inbox",
            href: "/features/shared-inbox",
            hint: "The texts that become jobs, in one place the crew can see.",
          },
          {
            label: "Calls and voicemail",
            href: "/features/calls",
            hint: "A call becomes a task the same way a message does.",
          },
          {
            label: "Lou, your assistant",
            href: "/features/assistant",
            hint: "Fills in the address and the due date from their words.",
          },
          {
            label: "Texting for contractors",
            href: "/for/contractors",
            hint: "Change orders, decided in writing and turned into work.",
          },
        ]}
      />

      <FeatureFaq
        heading="Task questions, straight answers."
        faqs={[
          {
            q: "Is this a replacement for my job-management software?",
            a: "No, and it is not trying to be. There are no Gantt charts, no dependencies between jobs, no crew dispatch or scheduling board, no time tracking and no invoicing. What it does is stop a promise made in a text from evaporating: it becomes a job with an owner and a date, attached to what the customer said. If you run a full estimating and invoicing suite, this sits in front of it, not instead of it.",
          },
          {
            q: "What is the difference between marking a message done and making a task?",
            a: "Weight. A done-mark is one tap on a message with no owner and no date, which is right for \"paint the hall Hale Navy\". A task has an owner, a due date and an address, and shows up on the board and the calendar, which is right for something that has to happen on a particular day by a particular person. Most crews use both, and the message is the source either way.",
          },
          {
            q: "Can I assign a job to someone who is not in the conversation?",
            a: "Yes. Assignment on a task is separate from who owns the conversation, because the person who answers the phone is often not the person who does the work. They get the job with the customer's own words attached, so they are not starting from a summary.",
          },
          {
            q: "What happens to tasks when a teammate leaves?",
            a: "They stay, like the conversations they came from. Deactivate the departing teammate in settings and their jobs remain exactly where they are, ready to be reassigned. Nothing belongs to a person's account.",
          },
          {
            q: "Do tasks work on a phone?",
            a: "Yes, all four views. The map and the calendar are the two that earn their keep on a phone specifically: what is near me, and what is due today, answered from the van without calling the office.",
          },
        ]}
      />

      <FeatureCta
        heading="Stop keeping the schedule in your head."
        sub={`Texts and calls that turn into jobs with owners and dates, ${ACTIVATION_CLAIM}. See the price.`}
      />
    </>
  );
}
