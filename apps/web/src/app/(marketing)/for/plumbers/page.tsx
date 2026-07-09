/**
 * /for/plumbers (trades crew), v4 "FIRST RESPONSE". COPY-DECK v2
 * §/for/plumbers (the master §P trade page): dateline 9:04 PM · BASEMENT
 * DRAIN, H1 "The text inbox for plumbing crews.", the deck's scripted thread
 * with Dale's dash-free outbound, the saved-replies pack in the product's
 * template picker, and the deck's exact use-case 2 and 4 bodies. Every
 * sentence is plumbing-specific; nothing is shared with the other five trade
 * pages. Fully static; own metadata + BreadcrumbList JSON-LD.
 */

import type { Metadata } from "next";

import { CountryText } from "@/components/marketing/country";
import { JsonLd } from "@/components/marketing/ui/json-ld";
import { TradePage } from "@/components/marketing/trades/trade-page";
import type { TradeContent } from "@/components/marketing/trades/trade-page";
import { PLUMBERS_SCRIPT } from "@/components/marketing/trades/scripts";
import { breadcrumbJsonLd, buildMetadata } from "@/lib/marketing/seo";

const PATH = "/for/plumbers";

export const metadata: Metadata = buildMetadata({
  title: "Texting software for plumbers",
  description:
    "A shared text inbox for your plumbing crew: customers text photos of the problem, anyone on the team replies, nothing gets missed. Local number, flat $29/mo, live in minutes.",
  path: PATH,
});

const CONTENT: TradeContent = {
  slug: "plumbers",
  displayName: "Plumbers",

  dateline: "9:04 PM · BASEMENT DRAIN",
  h1: "The text inbox for plumbing crews.",
  heroSub:
    "Customers text a photo of the leak. Whoever's free answers. The owner's personal cell goes back to being a personal cell. One local number, one shared inbox, $29 a month for the whole crew.",
  heroTruth:
    "Works on the phones your techs already carry · Live in minutes · Month to month",

  painH2: "You can't quote a water heater with your hands in a drain.",
  painBody: [
    "Every plumber knows the cycle: you're mid-job, the phone buzzes, and it's either a new customer you can't answer or a scheduled one asking where you are. Voicemail fills up. Callbacks slip. And every quote, address, and “yes please book me” lives on one personal phone that goes home with one person.",
    "Texting fixes half of that on its own. Customers would rather text than call anyway. Loonext fixes the other half: the texts stop belonging to one phone and start belonging to the business, so the tech in the crawlspace and the one at the supply house are looking at the same conversation.",
  ],

  threadH2: "A Tuesday, in texts.",
  threadLede:
    "A backed-up floor drain at 9:04 on a Tuesday night. A photo, a note to bring the auger, an assignment, a price, a booking. The whole call-out handled in the shared inbox, and nobody's dinner got ruined.",
  script: PLUMBERS_SCRIPT,
  threadAriaLabel:
    "A Reyes Plumbing conversation: a backed-up basement floor drain reported at 9:04 PM, assigned to Dale and booked for 8am",

  useCasesH2: "Where texting earns its keep in a plumbing business.",
  useCases: [
    {
      title: "Photo triage before you roll a truck.",
      body: "“Send me a picture of the shutoff” saves more wasted trips than any scheduling app. Photos land right in the conversation, free to receive, visible to the whole crew, so the tech who shows up has already seen the job.",
    },
    {
      title: "On-my-way texts, in two taps.",
      body: "Save it once: “On my way. Should be there in about 20 minutes.” Type “/”, tap, sent.",
    },
    {
      title: "Quote follow-ups that actually happen.",
      body: "Tag a conversation “Quote sent” and it stays visible until someone closes it. Monday morning, open the Quote sent list and follow up on the water heater swap instead of losing the job to whoever texted back first.",
    },
    {
      title: "After-hours texts, without the after-hours phone.",
      body: "A 9pm “no hot water” text waits safely in the inbox instead of ruining someone's dinner. Whoever opens up in the morning sees it, replies, and books it. If you do want evening pings, push notifications are per person, so only the on-call tech gets buzzed.",
    },
  ],

  savedRepliesH2: "Six texts every plumbing crew sends. Steal these.",
  savedRepliesIntro:
    "Six saved replies worth setting up on day one: the on-my-way, the photo request, the quote nudge, written the way a plumber actually talks. Save each one once and it's two taps forever.",
  savedReplies: [
    {
      name: "On my way",
      text: "On my way. Should be with you in about 20 minutes.",
    },
    {
      name: "Photo request",
      text: "Can you text us a photo of the problem, and one of the shutoff valve if you can find it? It helps us bring the right parts.",
    },
    {
      name: "Quote follow-up",
      text: "Hi, just checking you received our quote. Happy to answer any questions, and if the timing's not right, no pressure.",
    },
    {
      name: "Booking confirmation",
      text: "You're booked for Thursday between 9 and 11. We'll text you when we're on the way.",
    },
    {
      name: "Job done",
      text: "All done. We've cleared the line and tested it, so you're good to run the washer. Any issues in the next 30 days, text us here.",
    },
    {
      name: "Review ask",
      text: "Glad we could help, {first_name}. If you have a minute, a Google review goes a long way for a small shop like ours.",
    },
  ],
  savedRepliesCaption:
    "The plumbing pack in the composer: type / and the on-my-way is two taps from sent.",

  featuresH2: "Built for how a plumbing crew actually works.",
  features: [
    {
      title: "One number on the trucks.",
      body: "A local number that belongs to the business. Techs come and go; the number and every conversation stay.",
    },
    {
      title: "Assign jobs to techs.",
      body: "Every conversation has one owner, so two techs never book the same drain and no customer waits on “I thought you had it.”",
    },
    {
      title: "Notes the customer never sees.",
      body: "“Gate code 4482, dog is friendly, quote high, last visit ran long.” Right in the thread, marked internal, never sent.",
    },
    {
      title: "Works from the crawlspace.",
      body: "Any phone, no app to install, one-handed. Dark mode for the 6am starts, push notifications when a customer texts.",
    },
  ],

  pricingH2: "$29 a month. The whole crew.",
  pricingBody:
    "Starter covers 3 people, 1 local number, and 500 texts a month. That's roughly 20 to 25 plain texts a working day, enough for most 2 or 3 person shops, and the composer shows the count before you send. Bigger crew? Pro runs $79, fits up to 15 people, and adds a second number. Month to month, no contracts.",

  faqH2: "Plumber questions, straight answers.",
  faqs: [
    {
      q: "Can customers text us photos of the job?",
      a: "Yes. Photos of the drip, the drain, and the mystery valve all land in the conversation, free to receive. Your crew sees them before anyone rolls a truck.",
    },
    {
      q: "My techs aren't tech people. Will they use it?",
      a: "If they can text, they can use Loonext. It looks like texting. They open a link on their own phone, and they're in. Nothing to install, no training day.",
    },
    {
      q: "What about texts that come in at night?",
      a: "They wait in the inbox. Nothing gets lost and nobody's dinner gets ruined. Notifications are per person, so an on-call tech can get the evening buzz while everyone else sleeps.",
    },
    {
      q: "We're two guys and a van. Is this overkill?",
      a: "Starter is $29 for up to 3 people. It's built for exactly two guys and a van. You get the business number, the shared history, and the saved replies; when you hire, they're in with a link.",
    },
    {
      q: "Do “on my way” texts eat up the 500?",
      a: "Each plain on-my-way text counts as one, so 500 covers roughly 20 to 25 plain texts a working day, and the composer shows the count as you type. Go over and it's 3¢ a text, with alerts and a spending cap so there are no surprise bills.",
    },
    {
      q: "We're a licensed plumbing company. What's the registration process?",
      a: (
        <CountryText
          us="We file it all for you. It's about two minutes of plain questions at signup: your legal business name, address, and your EIN. Don't have an EIN? There's a sole proprietor path, where we text you a verification code and handle the rest. You can receive texts right away, and texting US customers turns on once the phone companies clear you, usually 3 to 7 business days."
          ca="Nothing to register and no wait. You start texting Canadian customers the same day your number is active, usually a minute or two after signup."
        />
      ),
    },
  ],

  finalH2: "Get the texts off your personal cell.",
  finalSub:
    "A local number and a shared inbox for the whole crew, live in minutes.",
};

export default function PlumbersPage() {
  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Home", path: "/" },
          { name: "Plumbers", path: PATH },
        ])}
      />
      <TradePage content={CONTENT} />
    </>
  );
}
