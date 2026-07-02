/**
 * /for/landscapers (trades track) — BLUEPRINT §5. Angle: seasonal quote volume,
 * crews spread across sites, photo-of-the-yard quotes, recurring maintenance.
 * Zero sentences shared with any other trade page (§5 guard). Own metadata +
 * BreadcrumbList JSON-LD. Fully static (§11.4).
 */

import type { Metadata } from "next";
import {
  CalendarClock,
  CloudRain,
  Image as ImageIcon,
  MapPin,
  Repeat,
  Sprout,
  Truck,
  Users,
} from "lucide-react";

import { JsonLd } from "@/components/marketing/ui/json-ld";
import { TradePage } from "@/components/marketing/trades/trade-page";
import type { TradeContent } from "@/components/marketing/trades/trade-page";
import { LANDSCAPERS_SCRIPT } from "@/components/marketing/trades/scripts";
import { breadcrumbJsonLd, buildMetadata } from "@/lib/marketing/seo";

const PATH = "/for/landscapers";

export const metadata: Metadata = buildMetadata({
  title: "Texting software for landscaping businesses",
  description:
    "A shared text inbox for landscaping and lawn-care crews: quote from a yard photo, keep every property address in one place, confirm recurring visits, and reschedule around the weather. Local number, flat $29/mo.",
  path: PATH,
});

const CONTENT: TradeContent = {
  slug: "landscapers",
  displayName: "Landscapers",

  eyebrow: "Business texting for landscaping crews",
  h1: "The shared inbox for landscaping and lawn care.",
  heroSub:
    "Spring hits and the quote requests come in faster than one phone can hold. Customers text a photo of the yard; whoever's at the desk quotes it, books it, and dispatches the crew — all from one number the whole company shares.",
  heroTruthLine:
    "One number for every property. Live in minutes. Cancel any time — no busy-season lock-in.",

  painH2: "In April, the quotes come in faster than one phone can hold them.",
  painBody: [
    "Landscaping runs in waves. The first warm week, everyone wants a spring cleanup, a mulch estimate, a mowing quote — all at once, all by text, all to the number printed on the truck. If that number is the owner's cell, the owner spends the busiest month of the year as a full-time receptionist instead of running crews.",
    "And the work is spread out. One crew's at the Alvarez place, another's across town, and the addresses, gate notes, and “which corner did they want re-mulched” live in a hundred separate text threads on separate phones. JobText puts every property conversation in one inbox, so the person quoting and the crew doing the work see the same photos, the same address, the same notes.",
  ],

  threadH2: "A spring cleanup, quoted from a photo.",
  threadLede:
    "A homeowner texts the worst corner of the front beds. The office recognizes the street, checks which crew is nearby, quotes the mulch and edging, and folds them into Thursday's route — then the customer asks about seasonal mowing, and that's the next job.",
  script: LANDSCAPERS_SCRIPT,

  useCasesH2: "Where texting earns its keep in a landscaping business.",
  useCases: [
    {
      icon: ImageIcon,
      title: "Quote from a yard photo, not a site visit.",
      body: "Most cleanup, mulch, and planting quotes can be scoped from two photos and a few questions. Customers text the pictures, you text back a number — and you've saved a truck roll and a half-day of driving to give estimates you could've priced from the office.",
    },
    {
      icon: CloudRain,
      title: "Reschedule a whole day when the weather turns.",
      body: "Rain moves the route. Instead of a chain of individual calls, pull up the day's conversations and text each customer the new time — with a saved reply, it's a few taps per stop, and everyone knows before they wonder where the crew is.",
    },
    {
      icon: Truck,
      title: "Dispatch the crew that's already nearby.",
      body: "Assign the conversation to whichever crew lead is closest, drop an internal note with the gate code and the mulch count, and they've got the address and the scope on their own phone — no radio call, no “which house was it again?”",
    },
    {
      icon: Repeat,
      title: "Keep recurring maintenance clients close.",
      body: "Biweekly mowing, seasonal pruning, fall cleanup — the whole history of a property lives in one thread. When it's time to renew for the season, you're texting a customer you already have a relationship with, not a cold quote.",
    },
  ],

  savedRepliesH2: "Six texts every landscaping crew sends. Steal these.",
  savedRepliesIntro:
    "Ready-to-edit saved replies written for lawn-care and landscaping companies — the photo ask, the weather bump, the season renewal, in words a homeowner actually reads.",
  savedReplies: [
    {
      name: "Photo request",
      text: "Happy to quote that. Could you text me a couple photos of the area and let me know the rough size? I can usually get you a price without a site visit.",
    },
    {
      name: "Quote sent",
      text: "Here's your estimate for the spring cleanup and mulch: {amount}. That includes bed edging and cleanup of the clippings. Want me to pencil you in?",
    },
    {
      name: "Weather reschedule",
      text: "Heads up — rain's moving in, so we're bumping your service from {day} to {day}. Same crew, same scope. Let me know if that doesn't work.",
    },
    {
      name: "On the way",
      text: "The crew's heading your way now — they'll be there within the hour. No need to be home; we'll text you a photo when it's done.",
    },
    {
      name: "Season renewal",
      text: "It's almost mowing season again. Want us to put you back on the every-other-week rotation at last year's rate? Just reply yes and you're set.",
    },
    {
      name: "Job done",
      text: "All wrapped up — beds edged, mulched, and cleaned up. Photos attached. Anything you'd like tweaked, just text us here.",
    },
  ],

  featuresH2: "Built for how a landscaping company actually works.",
  features: [
    {
      icon: MapPin,
      title: "Every property in one place.",
      body: "Addresses, gate codes, and “re-mulch the front only” notes live on the contact — not scattered across five crew members' phones.",
    },
    {
      icon: Users,
      title: "Assign to the closest crew.",
      body: "One owner per conversation, so the right crew gets the job and nobody double-books the same street.",
    },
    {
      icon: CalendarClock,
      title: "Handle the whole season from one inbox.",
      body: "Quote season, recurring visits, and end-of-season renewals all in one shared history — no per-user fee as you add seasonal help.",
    },
    {
      icon: Sprout,
      title: "Photos in and out, free to receive.",
      body: "Customers send the before, you send the after. Every image sits in the conversation the whole company can see.",
    },
  ],

  pricingH2: "$29 a month, flat — even in your busiest month.",
  pricingBody:
    "Starter is 3 people, 1 local number, and 500 texts a month. In April you'll send more; that's fine — extra texts are 3¢ each with a cap you control, and the composer shows the count as you type (photos count as three). Add seasonal crew on Pro at $79 for 10 people and 2 numbers, and drop back to Starter when the season winds down. Month to month, so you're never paying for winter capacity in July.",

  faqH2: "Landscaper questions, straight answers.",
  faqs: [
    {
      q: "Can I quote a job from photos instead of driving out?",
      a: "Yes — that's most of the point. Customers text photos of the yard or beds, receiving them is free, and they sit in the conversation so whoever's quoting and whoever's doing the work both see them. You save the truck rolls for jobs that truly need a walk-through.",
    },
    {
      q: "We add crew for the season — do we pay per person?",
      a: "No per-user fee, ever. Starter covers 3 people for $29; when you scale up for the busy months, Pro is $79 for up to 10. Drop back down between seasons — it's month to month.",
    },
    {
      q: "Can the whole crew see a property's address and gate code?",
      a: "Yes. Save it once to the contact or drop it as an internal note in the thread, and every crew member sees it on their own phone. No more texting the code around before every visit.",
    },
    {
      q: "The weather changes our schedule constantly. Does texting help?",
      a: "It's the fastest way to reschedule. Pull up the day's conversations, send each affected customer the new time with a saved reply, and everyone knows before the crew doesn't show. JobText doesn't reschedule for you — but it makes sending 15 updates a two-minute job.",
    },
    {
      q: "Our customers are seasonal — will they remember us next spring?",
      a: "The whole conversation history stays in the inbox, so next season you're texting a familiar name, not starting cold. A quick “want back on the rotation?” to last year's clients is often the easiest work you'll book all year.",
    },
    {
      q: "How much of our time does the texting registration take?",
      a: "About two minutes when you sign up. You'll give us your legal business name, address, and EIN; if you run the crew as a sole proprietor with no EIN, we verify you with a texted code instead. From there we file everything with the phone companies. You can receive texts right away, and sending to US customers turns on within a week or so once you're cleared.",
    },
  ],

  finalH2: "One number for every property you service.",
  finalSub:
    "Quote from a photo, dispatch the nearest crew, keep every address in one shared inbox. Live in minutes.",
};

export default function LandscapersPage() {
  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Home", path: "/" },
          { name: "Who it's for", path: "/#trades" },
          { name: "Landscapers", path: PATH },
        ])}
      />
      <TradePage content={CONTENT} />
    </>
  );
}
