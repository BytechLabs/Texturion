/**
 * /for/contractors (trades track) — BLUEPRINT §5. Angle: GC/subs/clients on one
 * personal cell, change orders, and the builder-sends-address-and-paint-color
 * scenario made concrete via D14 mark-done — EACH text is a task the crew works
 * through and checks off in the thread (DECISIONS D14: the message itself is the
 * task; there is NO jobs feature, and this page never implies one). Zero shared
 * sentences with any other trade page (§5 guard). Own metadata + BreadcrumbList
 * JSON-LD. Static (§11.4).
 */

import type { Metadata } from "next";
import {
  CheckCircle2,
  FileDiff,
  HardHat,
  Image as ImageIcon,
  Layers,
  PhoneOff,
  StickyNote,
  Users,
} from "lucide-react";

import { Container } from "@/components/marketing/ui/container";
import { Reveal } from "@/components/marketing/ui/reveal";
import { Section } from "@/components/marketing/ui/section";
import { JsonLd } from "@/components/marketing/ui/json-ld";
import { TradePage } from "@/components/marketing/trades/trade-page";
import type { TradeContent } from "@/components/marketing/trades/trade-page";
import { TradeGraphic } from "@/components/marketing/trades/trade-graphic";
import { TradeThread } from "@/components/marketing/trades/trade-thread";
import { OneNumberManyPeople } from "@/components/marketing/art";
import {
  CONTRACTORS_DONE_IDS,
  CONTRACTORS_DONE_LABELS,
  CONTRACTORS_SCRIPT,
} from "@/components/marketing/trades/scripts";
import { breadcrumbJsonLd, buildMetadata } from "@/lib/marketing/seo";

const PATH = "/for/contractors";

export const metadata: Metadata = buildMetadata({
  title: "Texting app for contractors and builders",
  description:
    "A shared text inbox for contractors: every message becomes a task the crew works through and marks done, off your personal cell. Flat $29/mo.",
  path: PATH,
});

/**
 * The D14 mark-done illustration (BLUEPRINT §5 contractors row + DECISIONS D14).
 * The GC's address/paint spec and the crew's confirmation are marked done
 * (line-through + petrol check badge); the live change-order turn is left open —
 * a new task, not yet worked. This is the "each text is a task" story shown, not
 * asserted, and it explicitly is NOT a jobs feature: no board, no list, no
 * counts — just a message you check off in the thread.
 */
function MarkDoneSection() {
  return (
    <Section>
      <Container>
        <div className="mx-auto grid max-w-5xl gap-10 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:items-center lg:gap-16">
          <div>
            <h2 className="display-h2 text-foreground">
              Every text is a task. Check it off when it&apos;s handled.
            </h2>
            <p className="mt-5 text-lg leading-relaxed text-muted-foreground">
              The builder texts the address, the lockbox code, and the paint
              colors. That&apos;s not a message to skim — it&apos;s a job to work
              through. So tap it done once the crew is briefed and the paint is
              loaded, and the whole team sees it&apos;s handled.
            </p>
            <p className="mt-4 text-[15px] leading-relaxed text-muted-foreground">
              There&apos;s no separate to-do app and no “jobs” screen to keep in
              sync — the message itself is the task. Mark any text done (or not
              done) right in the thread; it strikes through, gets a small check
              with who did it and when, and syncs to everyone&apos;s phone. When
              the change order comes in the next morning, it&apos;s the one thing
              still open — impossible to miss.
            </p>
          </div>
          <Reveal>
            <TradeThread
              script={CONTRACTORS_SCRIPT}
              framing="desktop"
              doneIds={CONTRACTORS_DONE_IDS}
              doneLabels={CONTRACTORS_DONE_LABELS}
              bodyClassName="min-h-[360px]"
            />
          </Reveal>
        </div>
      </Container>
    </Section>
  );
}

const CONTENT: TradeContent = {
  slug: "contractors",
  displayName: "Contractors",

  eyebrow: "Business texting for contractors and builders",
  h1: "The shared inbox for contractors.",
  heroSub:
    "The GC, the subs, the client, and the supply house all text the same number — yours. JobText gets those conversations off your personal cell and into one inbox the crew shares, where every message is a task you can hand off, note, and check off when it's done.",
  heroTruthLine:
    "Job comms off your personal phone. Live in minutes. Month to month.",

  painH2: "The GC, the subs, and the client all text one phone — yours.",
  painBody: [
    "On a job site, everything runs through the person whose number is on the estimate. The builder texts the address and the paint spec, the electrician texts a question about the panel location, the client texts a change they want, and the supplier texts that the tile's in — all to one personal cell, in between the kid's soccer schedule and the group chat. Miss one and you're repainting a room the wrong color or holding up a sub for a day.",
    "The stakes are higher than a missed reply, too. When the job lives in one person's texts, nobody else can cover — take a day off and the whole job stalls. And when it's time to reconcile a change order, the “proof” is a text thread on a phone that walks out the door if that person does. JobText makes the number the business's, the conversation the crew's, and every message a task the team can see, hand off, and mark done.",
  ],

  threadH2: "A paint spec from the builder, worked like a punch list.",
  threadLede:
    "The GC texts the address, the lockbox code, and the paint colors for each room. The crew lead reads it out, loads the paint, and confirms the plan — then the next morning a change order lands. One inbox, one owner, and a written record of exactly what was asked for.",
  script: CONTRACTORS_SCRIPT,
  supportingGraphic: (
    <TradeGraphic
      caption="The number on the estimate is the business's, and every site text — the GC, the subs, the client — lands in one inbox the crew shares, off your personal cell."
    >
      <OneNumberManyPeople
        className="w-full"
        title="One business number feeding a shared inbox the whole crew works from."
      />
    </TradeGraphic>
  ),

  afterThread: <MarkDoneSection />,

  useCasesH2: "Where texting earns its keep on a job site.",
  useCases: [
    {
      icon: PhoneOff,
      title: "Get job comms off your personal cell.",
      body: "The number goes on the estimate and the truck, not your personal phone. Site texts land in the business inbox, the whole crew can pick them up, and your evenings stop belonging to the job.",
    },
    {
      icon: Layers,
      title: "Coordinate subs without being the bottleneck.",
      body: "Loop the electrician's question to the crew lead, note the answer in the thread, and it's handled whether or not you're the one holding the phone. Assign each conversation an owner so nothing waits on you personally.",
    },
    {
      icon: FileDiff,
      title: "Keep change orders on the record.",
      body: "“Client wants the hall in Hale Navy too — that's an extra $140.” In writing, in the thread, with a time and a name. When it's time to invoice the change, the conversation is the proof.",
    },
    {
      icon: ImageIcon,
      title: "Document the work with photos.",
      body: "Progress shots, the finished cut-in, the thing the client needs to approve before you proceed — all sitting in the conversation, free to receive, visible to whoever picks the job back up tomorrow.",
    },
  ],

  savedRepliesH2: "Six texts every contractor sends. Steal these.",
  savedRepliesIntro:
    "Ready-to-edit saved replies for builders and remodelers — the site-access confirm, the change-order write-up, the client progress update, in a straight, professional voice.",
  savedReplies: [
    {
      name: "Site access confirmed",
      text: "Got it — {address}, lockbox {code}. Crew will be on site {day} at {time}. I'll text you a photo once we're rolling.",
    },
    {
      name: "Change order",
      text: "That change is doable. It adds {amount} and about {time} to the schedule. Reply “approved” and I'll write it up as a change order and get it moving.",
    },
    {
      name: "Client progress update",
      text: "Quick update on your project: {milestone} is done and we're on to {next}. Photos attached. On track for {date} — I'll flag you the moment anything shifts.",
    },
    {
      name: "Sub coordination",
      text: "{Trade}, we'll be ready for you {day}. Rough-in's complete and the area's cleared. Text me here if the timing moves on your end.",
    },
    {
      name: "Need a decision",
      text: "Before we go further we need your call on {item}. Here are the options and costs: {options}. Whenever you're ready — we'll hold this spot in the schedule.",
    },
    {
      name: "Walkthrough / punch list",
      text: "We're wrapping up. Want to do a walkthrough {day} to build the punch list together? Anything you spot, we'll knock out before final.",
    },
  ],

  featuresH2: "Built for how a contractor actually works.",
  features: [
    {
      icon: CheckCircle2,
      title: "Mark any message done.",
      body: "The address text, the paint spec, the “need a decision” — tap it done in the thread when it's handled. Strikethrough, a check with who and when, synced to the crew. No jobs board, no second app.",
    },
    {
      icon: Users,
      title: "Hand off without dropping the ball.",
      body: "Assign a conversation to whoever's covering that trade or that day. One owner per thread, so a sub's question never sits unanswered because “I thought you had it.”",
    },
    {
      icon: StickyNote,
      title: "Notes the client never sees.",
      body: "“Change orders through me, not the client” or “this sub runs late” — internal notes on the conversation, visible to the crew, never sent out.",
    },
    {
      icon: HardHat,
      title: "The number is the business's.",
      body: "A local number on the estimate that stays with the company. When a crew member moves on, the conversations and contacts don't leave with their phone.",
    },
  ],

  pricingH2: "$29 a month for the whole crew.",
  pricingBody:
    "Starter covers 3 people, 1 local number, and 500 texts a month — enough for a small crew running a couple of jobs (a plain text is one; photos of progress count as three; the composer shows the count as you type). Running multiple jobs or a bigger crew with subs? Pro is $79 for 10 people and 2 numbers — one for the office, one for the field, if you want to split them. Month to month, receiving always free, and for US companies a one-time $29 to register with the phone companies ($58 first month, $29 after).",

  faqH2: "Contractor questions, straight answers.",
  faqs: [
    {
      q: "Is this a project-management or “jobs” app?",
      a: "No — and we're deliberate about that. JobText is a shared texting inbox, not a jobs board or a scheduling suite. The one place it touches “tasks” is simple: any message can be marked done right in the thread, because on a job site a text like “paint the hall Hale Navy” is a task. It strikes through with a check when it's handled and syncs to the crew — but there's no separate screen, no board, no counts to maintain.",
    },
    {
      q: "So how does “mark done” actually work?",
      a: "Tap any message — the builder's address, a change request, a sub's question — and it's marked done: the text gets a line through it, a small check showing who did it and when, and everyone's phone updates. Tap again to un-mark it. That's the whole feature: the message is the task, and “done” is one tap in the conversation.",
    },
    {
      q: "Can I keep the client, the subs, and my personal life separate?",
      a: "Yes. The business number handles all the job comms in the shared inbox; your personal cell goes back to being personal. Assign conversations so the right person owns each one, and use internal notes for the “this stays between us” details the client never needs to see.",
    },
    {
      q: "Where's the proof if a client disputes a change order?",
      a: "In the thread. The request, your price, and their approval are all there in writing, with names and timestamps — and because it's the business's inbox, not one person's phone, it doesn't walk off the job if someone leaves. JobText doesn't generate the change-order paperwork, but the conversation is the record behind it.",
    },
    {
      q: "If I'm out for a day, does the whole job stall?",
      a: "Not when the conversations live in a shared inbox. Hand off the active threads by assigning them, and whoever's covering sees the full history — the address, the spec, the open items marked not-done — on their own phone. The job doesn't wait on one person's texts.",
    },
    {
      q: "What do you need from our company to get the number registered?",
      a: "A couple of minutes at signup and three things: your legal business name, address, and EIN. Operating as a sole proprietor without an EIN? There's a path for that — we text you a verification code and take care of the rest. We file the whole registration for you; you can receive texts immediately, and texting US numbers activates in about a week once you're cleared.",
    },
  ],

  finalH2: "Get the job off your personal phone.",
  finalSub:
    "One shared inbox for the GC, the subs, and the client — where every message is a task the crew can hand off and check off. Live in minutes.",
};

export default function ContractorsPage() {
  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Home", path: "/" },
          { name: "Who it's for", path: "/#trades" },
          { name: "Contractors", path: PATH },
        ])}
      />
      <TradePage content={CONTENT} />
    </>
  );
}
