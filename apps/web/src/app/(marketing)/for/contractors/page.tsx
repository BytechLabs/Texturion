/**
 * /for/contractors (trades crew), v4 "FIRST RESPONSE". COPY-DECK v2
 * §/for/contractors: dateline 8:02 AM · CHANGE ORDER, H1 "The text inbox for
 * contracting crews.", pain H2 "The change order is in a text thread on your
 * estimator's phone.", the homeowner-change-request script (filed against
 * the job, assigned, confirmed in writing, with the request carrying the
 * app's D14 done state once written up), the v2 use cases (decisions in
 * writing, sub coordination on one number, photo documentation), and the
 * "texting, not project management" Truth Strip pointing at the compare
 * pages. DECISIONS D14: the message itself is the task; there is NO jobs
 * feature and this page never implies one. Fully static; own metadata +
 * BreadcrumbList JSON-LD.
 */

import type { Metadata } from "next";
import Link from "next/link";

import { CountryText } from "@/components/marketing/country";
import { JsonLd } from "@/components/marketing/ui/json-ld";
import { TradePage } from "@/components/marketing/trades/trade-page";
import type { TradeContent } from "@/components/marketing/trades/trade-page";
import { CONTRACTORS_SCRIPT } from "@/components/marketing/trades/scripts";
import { breadcrumbJsonLd, buildMetadata } from "@/lib/marketing/seo";

const PATH = "/for/contractors";

export const metadata: Metadata = buildMetadata({
  title: "Texting app for contractors and builders",
  description:
    "A shared text inbox for contractors: change orders priced and approved in writing, subs coordinated on one number, off your personal cell. Flat $29/mo.",
  path: PATH,
});

const CONTENT: TradeContent = {
  slug: "contractors",
  displayName: "Contractors",

  dateline: "8:02 AM · CHANGE ORDER",
  h1: "The text inbox for contracting crews.",
  heroSub:
    "The homeowner's change request is worth real money, if it lands where the crew can see it and gets approved in writing. Loonext gives the client, the GC, and the subs one business number and the crew one shared inbox, so every decision is on the record. $29 a month.",
  heroTruth:
    "Job texts off your personal cell · Live in minutes · Month to month",

  painH2: "The change order is in a text thread on your estimator's phone.",
  painBody: [
    "On a job site, everything runs through whoever's number is on the estimate. The homeowner texts a change, the electrician texts a question, the supplier texts that the tile's in, all to one personal cell, in between the family group chat. Miss one and you're redoing an island in the wrong material or holding up a sub for a day.",
    "The stakes outlast the day, too. When it's time to invoice a change, the “proof” is a text thread on a phone that walks off the job if that person does. Loonext makes the number the business's and the conversation the crew's: the change request gets filed against the job, priced, and approved in writing, where everyone can see it.",
  ],

  threadH2: "A change order, approved in writing before the template.",
  threadLede:
    "The homeowner texts a change of heart at 8:02 AM. The office files it against the job, checks the counter schedule, assigns it, and texts back a price. “Approved” lands in the thread thirteen minutes later, on the record, and the request is marked done.",
  script: CONTRACTORS_SCRIPT,
  threadAriaLabel:
    "A contracting conversation: a homeowner's island change request at 8:02 AM, priced at $840 and approved in writing before Thursday's counter template",

  useCasesH2: "Where texting earns its keep on a job site.",
  useCases: [
    {
      title: "Decisions in writing.",
      body: "“Walnut butcher block adds $840. Reply approved and I'll write it up.” The request, the price, and the yes all sit in the thread with names and times. When you invoice the change, the conversation is the record behind it.",
    },
    {
      title: "Sub coordination on one number.",
      body: "The electrician's question gets assigned to whoever owns that trade, answered in the thread, and marked done. Nothing waits on you personally, and nothing gets answered twice.",
    },
    {
      title: "Photo documentation, job by job.",
      body: "Progress shots, the finished cut-in, the thing the client needs to approve before you proceed. All in the conversation, free to receive, visible to whoever picks the job up tomorrow.",
    },
    {
      title: "Off your personal cell.",
      body: "The number on the estimate belongs to the business. Take a day off and the crew covers the inbox; your evenings stop belonging to the job.",
    },
  ],

  savedRepliesH2: "Six texts every contractor sends. Steal these.",
  savedRepliesIntro:
    "Six saved replies worth setting up on day one: the site-access confirm, the change-order write-up, the progress update, in a straight, professional voice. Save each one once and it's two taps forever.",
  savedReplies: [
    {
      name: "Site access confirmed",
      text: "Got the access details, thanks. The crew will be on site Tuesday at 8am. I'll text you a photo once we're rolling.",
    },
    {
      name: "Change order",
      text: "That change is doable. I'll price it today, and if the number works for you, reply approved and I'll write it up as a change order and get it moving.",
    },
    {
      name: "Client progress update",
      text: "Quick update, {first_name}: rough-in is done and drywall starts Monday. Photos attached. Still on track, and I'll flag you the moment anything shifts.",
    },
    {
      name: "Sub coordination",
      text: "We'll be ready for you Thursday. Rough-in's complete and the area's cleared. Text me here if the timing moves on your end.",
    },
    {
      name: "Need a decision",
      text: "Before we go further we need your call on the counter material. Options and costs are in the next text. Whenever you're ready, we'll hold your spot in the schedule.",
    },
    {
      name: "Walkthrough / punch list",
      text: "We're wrapping up. Want to do a walkthrough Friday to build the punch list together? Anything you spot, we'll knock out before final.",
    },
  ],
  savedRepliesCaption:
    "The contracting pack in the composer: the change-order write-up is two taps, not a forgotten promise.",

  featuresH2: "Built for how a contractor actually works.",
  features: [
    {
      title: "Mark any message done.",
      body: "The address text, the paint spec, the “need a decision.” Tap it done in the thread when it's handled: strikethrough, a check with who and when, synced to the crew. No jobs board, no second app.",
    },
    {
      title: "Hand off without dropping the ball.",
      body: "Assign a conversation to whoever's covering that trade or that day. One owner per thread, so a sub's question never sits on “I thought you had it.”",
    },
    {
      title: "Notes the client never sees.",
      body: "“Change orders through me, not the client” or “this sub runs late.” Internal notes on the conversation, visible to the crew, never sent.",
    },
    {
      title: "The number is the business's.",
      body: "A local number on the estimate that stays with the company. When a crew member moves on, the conversations and contacts don't leave with their phone.",
    },
  ],

  pricingH2: "$29 a month for the whole crew.",
  pricingBody:
    "Starter covers 3 people, 1 local number, and texting sized for a small crew running a couple of jobs on a fair-use basis, not a hard cap, and the composer shows the count before you send. Running a bigger crew with subs, or want the office and the field on separate lines? Pro is $79 for up to 15 people and 2 numbers.",
  truthLines: [
    {
      text: (
        <>
          Loonext is texting, not project management. The{" "}
          <Link
            href="/compare"
            className="text-[color:var(--fr-cobalt)] underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--fr-cobalt)]"
          >
            compare pages
          </Link>{" "}
          say when a bigger platform fits better.
        </>
      ),
    },
  ],

  faqH2: "Contractor questions, straight answers.",
  faqs: [
    {
      q: "Is this a project-management or “jobs” app?",
      a: "No, and we're deliberate about that. Loonext is a shared texting inbox, not a jobs board or a scheduling suite. The one place it touches “tasks” is simple: any message can be marked done right in the thread, because on a job site a text like “paint the hall Hale Navy” is a task. It strikes through with a check when it's handled and syncs to the crew, but there's no separate screen, no board, no counts to maintain.",
    },
    {
      q: "So how does “mark done” actually work?",
      a: "Tap any message, whether it's the builder's address, a change request, or a sub's question, and it's marked done: the text gets a line through it, a small check shows who did it and when, and everyone's phone updates. Tap again to un-mark it. That's the whole feature: the message is the task, and done is one tap in the conversation.",
    },
    {
      q: "Can I keep the client, the subs, and my personal life separate?",
      a: "Yes. The business number handles all the job comms in the shared inbox; your personal cell goes back to being personal. Assign conversations so the right person owns each one, and use internal notes for the “this stays between us” details the client never needs to see.",
    },
    {
      q: "Where's the proof if a client disputes a change order?",
      a: "In the thread. The request, your price, and their approval are all there in writing, with names and timestamps, and because it's the business's inbox, not one person's phone, it doesn't walk off the job if someone leaves. Loonext doesn't generate the change-order paperwork, but the conversation is the record behind it.",
    },
    {
      q: "If I'm out for a day, does the whole job stall?",
      a: "Not when the conversations live in a shared inbox. Hand off the active threads by assigning them, and whoever's covering sees the full history on their own phone: the address, the spec, the open items still marked not done. The job doesn't wait on one person's texts.",
    },
    {
      q: "What do you need from our company to get the number registered?",
      a: (
        <CountryText
          us="We file the whole thing for you: a couple of minutes at signup and three things, your legal business name, address, and EIN. Operating as a sole proprietor without an EIN? There's a path for that: we text you a verification code and take care of the rest. You can receive texts immediately, and texting US numbers activates in about a week once you're cleared."
          ca="Nothing to register and no wait. You can text Canadian customers the same day you sign up."
        />
      ),
    },
  ],

  finalH2: "Get the job off your personal phone.",
  finalSub:
    "One shared inbox for the client, the GC, and the subs, where every decision lands in writing. Live in minutes.",
};

export default function ContractorsPage() {
  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Home", path: "/" },
          { name: "Contractors", path: PATH },
        ])}
      />
      <TradePage content={CONTENT} />
    </>
  );
}
