/**
 * /for/plumbers (trades track) — BLUEPRINT §5, anchored on COPY §P (the master
 * trade-page copy) and expanded. Every sentence is plumbing-specific; nothing
 * is shared with the other five trade pages (§5 scaled-content guard).
 *
 * Renders the shared <TradePage> template driven by a plumbing-only content
 * object. Its own buildMetadata + BreadcrumbList JSON-LD (per the track SEO
 * contract). Fully static (§11.4). Internal links to /features/shared-inbox and
 * /pricing live inside the template.
 */

import type { Metadata } from "next";
import {
  Camera,
  ClipboardCheck,
  Clock,
  MessageSquareText,
  MoonStar,
  Users,
  Wrench,
} from "lucide-react";

import { JsonLd } from "@/components/marketing/ui/json-ld";
import { TradePage } from "@/components/marketing/trades/trade-page";
import type { TradeContent } from "@/components/marketing/trades/trade-page";
import { TradeGraphic, TradePhoto } from "@/components/marketing/trades/trade-graphic";
import { Photo } from "@/components/marketing/photo";
import { PLUMBERS_SCRIPT } from "@/components/marketing/trades/scripts";
import { breadcrumbJsonLd, buildMetadata } from "@/lib/marketing/seo";

const PATH = "/for/plumbers";

export const metadata: Metadata = buildMetadata({
  title: "Texting software for plumbers",
  description:
    "A shared text inbox for your plumbing crew: customers text photos of the problem, anyone replies, nothing gets missed. Local number, flat $29/mo.",
  path: PATH,
});

const CONTENT: TradeContent = {
  slug: "plumbers",
  displayName: "Plumbers",

  eyebrow: "Business texting for plumbing crews",
  h1: "The text inbox for plumbing crews.",
  heroSub:
    "Customers text a photo of the leak. Whoever's free answers. The owner's personal cell goes back to being a personal cell. One local number, one shared inbox, $29 a month for the whole crew.",
  heroTruthLine:
    "Works on the phones your techs already carry. Live in minutes. Month to month.",

  painH2: "You can't quote a water heater with your hands in a drain.",
  painBody: [
    "Every plumber knows the cycle: you're mid-job, the phone buzzes, and it's either a new customer you can't answer or a scheduled one asking where you are. Voicemail fills up. Callbacks slip. And every quote, address, and “yes please book me” lives on one personal phone that goes home with one person.",
    "Texting fixes half of that on its own — customers would rather text than call anyway. JobText fixes the other half: the texts stop belonging to one phone and start belonging to the business, so the tech in the crawlspace and the one at the supply house are looking at the same conversation.",
  ],
  painVisual: (
    <TradePhoto
      photoId="plumber-heater"
      caption="Hands full on a water-heater call — nobody's free to grab a ringing phone. A shared text inbox catches the customer instead of voicemail."
    />
  ),

  threadH2: "A Tuesday, in texts.",
  threadLede:
    "A backed-up floor drain, a photo, a note to bring the auger, an assignment, a price, a booking. The whole call-out handled in the shared inbox — no voicemail, no “who's got this one?”",
  script: PLUMBERS_SCRIPT,
  supportingGraphic: (
    <TradeGraphic
      caption="The number lives on the truck, not on a tech's personal cell — so every customer text lands in the shared inbox."
    >
      <Photo
        id="plumber-pipe"
        className="overflow-hidden rounded-xl"
        imgClassName="aspect-[4/3] object-cover"
        sizes="(min-width: 1024px) 28rem, 100vw"
      />
    </TradeGraphic>
  ),

  useCasesH2: "Where texting earns its keep in a plumbing business.",
  useCases: [
    {
      icon: Camera,
      title: "Photo triage before you roll a truck.",
      body: "“Send me a picture of the shutoff” saves more wasted trips than any scheduling app. Photos land right in the conversation, free to receive, visible to the whole crew — so the tech who shows up has already seen the job.",
    },
    {
      icon: MessageSquareText,
      title: "On-my-way texts, in two taps.",
      body: "Save it once: “On my way — should be there in about 20 minutes.” Type “/”, tap, sent. Your customers stop wondering and your techs stop typing the same sentence forty times a week.",
    },
    {
      icon: ClipboardCheck,
      title: "Quote follow-ups that actually happen.",
      body: "Tag a conversation “Quote sent” and it stays visible until someone closes it. Monday morning, open the Quote sent list and follow up on the water-heater swap instead of losing the job to whoever texted back first.",
    },
    {
      icon: MoonStar,
      title: "After-hours texts, without the after-hours phone.",
      body: "A 9pm “no hot water” text waits safely in the inbox instead of ruining someone's dinner. Whoever opens up sees it, replies, and books it — and push notifications are per-person, so only the on-call tech gets buzzed.",
    },
  ],

  savedRepliesH2: "Six texts every plumbing crew sends. Steal these.",
  savedRepliesIntro:
    "These ship as ready-to-edit saved replies for plumbing companies — the on-my-way, the photo request, the quote nudge, written the way a plumber actually talks.",
  savedReplies: [
    {
      name: "On my way",
      text: "On my way — should be with you in about 20 minutes.",
    },
    {
      name: "Photo request",
      text: "Can you text us a photo of the problem, and one of the shutoff valve if you can find it? It helps us bring the right parts.",
    },
    {
      name: "Quote follow-up",
      text: "Hi, just checking you received our quote. Happy to answer any questions — and if the timing's not right, no pressure.",
    },
    {
      name: "Booking confirmation",
      text: "You're booked for {day} between {time} and {time}. We'll text you when we're on the way.",
    },
    {
      name: "Job done",
      text: "All done. We've cleared the line and tested it — you're good to run the washer. Any issues in the next 30 days, text us here.",
    },
    {
      name: "Review ask",
      text: "Glad we could help. If you have a minute, a Google review goes a long way for a small shop like ours: {link}",
    },
  ],

  featuresH2: "Built for how a plumbing crew actually works.",
  features: [
    {
      icon: Wrench,
      title: "One number on the trucks.",
      body: "A local number that belongs to the business. Techs come and go; the number and every conversation stay.",
    },
    {
      icon: Users,
      title: "Assign jobs to techs.",
      body: "Every conversation has one owner, so two techs never book the same drain and no customer waits on “I thought you had it.”",
    },
    {
      icon: ClipboardCheck,
      title: "Notes the customer never sees.",
      body: "“Gate code 4482, dog is friendly, quote high — last visit ran long” — right in the thread, marked internal.",
    },
    {
      icon: Clock,
      title: "Works from the crawlspace.",
      body: "Any phone, no app to install, one-handed. Dark mode for the 6am starts, push notifications when a customer texts.",
    },
  ],

  pricingH2: "$29 a month. The whole crew.",
  pricingBody:
    "Starter covers 3 people, 1 local number, and 500 texts a month — roughly 20 to 25 plain texts a working day, enough for most 2–3 person shops (photos count as three each, so a photo-heavy week goes faster; the composer shows the count as you type). Bigger crew? Pro runs $79, fits up to 10 people, and throws in a second number. Month to month, and for US shops the only other cost is a one-time $29 to register with the phone companies — so your first month is $58, every month after is $29.",

  faqH2: "Plumber questions, straight answers.",
  faqs: [
    {
      q: "Can customers text us photos of the job?",
      a: "Yes — photos and videos of the drip, the drain, the mystery valve all land in the conversation, free to receive. Your crew sees them before anyone rolls a truck.",
    },
    {
      q: "My techs aren't tech people. Will they use it?",
      a: "If they can text, they can use JobText — it looks like texting. They open a link on their own phone, and they're in. Nothing to install, no training day.",
    },
    {
      q: "What about texts that come in at night?",
      a: "They wait in the inbox — nothing gets lost, nobody's dinner gets ruined. Notifications are per-person, so an on-call tech can get the evening buzz while everyone else sleeps.",
    },
    {
      q: "We're two guys and a van. Is this overkill?",
      a: "Starter is $29 for up to 3 people — it's built for exactly two guys and a van. You get the business number, the shared history, and the saved replies; when you hire, they're in with a link.",
    },
    {
      q: "Do “on my way” texts eat up the 500?",
      a: "Each plain on-my-way text counts as one, so 500 covers more than 20 plain texts every working day — the composer shows the count as you type. Photos count as three each. Go over and it's 3¢ a text, with alerts and a spending cap so there are no surprise bills.",
    },
    {
      q: "We're a licensed plumbing company — what's the registration process?",
      a: "About two minutes of plain questions at signup: legal business name, address, and your EIN. Don't have an EIN? There's a sole-proprietor path — we'll text you a verification code and handle the rest. We file it all for you.",
    },
  ],

  finalH2: "Get the texts off your personal cell.",
  finalSub: "A local number and a shared inbox for the whole crew, live in minutes.",
};

export default function PlumbersPage() {
  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Home", path: "/" },
          { name: "Who it's for", path: "/#trades" },
          { name: "Plumbers", path: PATH },
        ])}
      />
      <TradePage content={CONTENT} />
    </>
  );
}
