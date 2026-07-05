/**
 * /for/hvac (trades track). BLUEPRINT §5. Angle: seasonal spikes (no-heat in
 * January, no-cool in July), maintenance-plan reminders you SEND (honest,
 * reminders are manual, never "automated reminders" per §5 honesty guard),
 * quote follow-ups, filter/photo triage. Zero shared sentences with any other
 * trade page (§5 guard). Own metadata + BreadcrumbList JSON-LD. Static (§11.4).
 */

import type { Metadata } from "next";
import {
  BellRing,
  CalendarClock,
  Camera,
  ClipboardList,
  Flame,
  Snowflake,
  ThermometerSun,
  Users,
} from "lucide-react";

import { JsonLd } from "@/components/marketing/ui/json-ld";
import { TradePage } from "@/components/marketing/trades/trade-page";
import type { TradeContent } from "@/components/marketing/trades/trade-page";
import { TradeGraphic, TradePhoto } from "@/components/marketing/trades/trade-graphic";
import { Display } from "@/components/marketing/display";
import { Photo } from "@/components/marketing/photo";
import { HVAC_SCRIPT } from "@/components/marketing/trades/scripts";
import { breadcrumbJsonLd, buildMetadata } from "@/lib/marketing/seo";

const PATH = "/for/hvac";

export const metadata: Metadata = buildMetadata({
  title: "Customer texting for HVAC companies",
  description:
    "A shared text inbox for HVAC contractors: triage no-heat and no-cool calls fast, follow up on install quotes, send maintenance reminders. Flat $29/mo.",
  path: PATH,
});

const CONTENT: TradeContent = {
  slug: "hvac",
  displayName: "HVAC",

  eyebrow: "Business texting for HVAC contractors",
  h1: (
    <>
      The no-heat text that never reaches voicemail, now{" "}
      <Display.Mark>caught</Display.Mark>.
    </>
  ),
  heroSub:
    "The first cold snap, the first heat wave, the calls all come at once, and every one of them is urgent. Loonext turns the pile-up into a triaged queue your whole team can work: read the fault, assign the tech, send the window, keep the install quotes from going cold.",
  heroTruthLine:
    "Triage the surge from one inbox. Live in minutes. No busy-season contract.",
  heroPhotoId: "tools-wall",
  heroPhotoCaption: "No-heat call, caught",

  painH2: "When it's -18 out, everyone calls at once, and no-heat can't go to voicemail.",
  painBody: [
    "HVAC demand doesn't trickle in; it spikes. The morning a cold front lands, a dozen no-heat calls hit before 8am, and the same thing happens in reverse the first 30-degree week of summer. Route all of that through one owner's cell and you get a full voicemail box, a stressed dispatcher, and customers calling the next company because nobody picked up.",
    "The rest of the year is a different problem: the slow bleed. An install quote you sent three weeks ago that never got a follow-up. A maintenance-plan customer whose tune-up you meant to remind them about. Those are real dollars, and they slip because the follow-up lives on a sticky note. Loonext keeps the surge triaged and the follow-ups visible, the whole team working one inbox instead of one phone.",
  ],
  painVisual: (
    <TradePhoto
      photoId="crew-rooftop"
      caption="Techs on the roof, the dispatcher on the phone, the whole crew reads the same triaged queue, so no-heat never sits in voicemail."
    />
  ),

  threadH2: "A no-heat call in a cold snap.",
  threadLede:
    "A customer texts a photo of the flashing furnace light at 6:41am. The office reads the fault code, drops a note about the likely part, bumps the customer up the cold-snap list, and a tech texts a window and a diagnostic price, before the customer has finished their coffee.",
  script: HVAC_SCRIPT,
  supportingGraphic: (
    <TradeGraphic
      caption="The number goes on the vans, and every no-heat text lands in one shared inbox the whole team can triage, not a full voicemail box on one phone."
    >
      <Photo
        id="hvac-tech"
        className="overflow-hidden rounded-xl"
        imgClassName="aspect-[4/3] object-cover"
        sizes="(min-width: 1024px) 28rem, 100vw"
      />
    </TradeGraphic>
  ),

  useCasesH2: "Where texting earns its keep in an HVAC business.",
  useCases: [
    {
      icon: Snowflake,
      title: "Triage the surge instead of drowning in it.",
      body: "When the cold-snap calls pile up, the shared inbox is a queue: read the fault, note the likely part, assign the tech with the right stock on the van, and send a window. Nothing sits in a voicemail box while a house freezes.",
    },
    {
      icon: Camera,
      title: "Read the fault before you dispatch.",
      body: "Ask for a photo of the furnace status light or the model plate. Three flashes versus four changes what part rides on the truck, and a photo in the thread means the tech rolls up with the induced-draft motor already loaded.",
    },
    {
      icon: ClipboardList,
      title: "Follow up on install quotes before they go cold.",
      body: "A new furnace or AC quote is a big decision that rarely closes same-day. Tag it “Quote sent,” and it stays on the list until someone checks back in, “still thinking it over? happy to walk through financing”, instead of the job quietly going to whoever called them back.",
    },
    {
      icon: BellRing,
      title: "Send maintenance-plan reminders yourself, on time.",
      body: "Twice a year, text your plan customers to book their tune-up, you send it, with a saved reply, so it's fast but it's real (Loonext doesn't blast on its own). The whole team sees who's been reminded and who's booked.",
    },
  ],

  savedRepliesH2: "Six texts every HVAC company sends. Steal these.",
  savedRepliesIntro:
    "Ready-to-edit saved replies for heating and cooling contractors, the diagnostic window, the fault-photo ask, the tune-up reminder, in the plain, reassuring tone a cold customer needs.",
  savedReplies: [
    {
      name: "Diagnostic window",
      text: "We can have a tech out to you between {time} and {time} today. The diagnostic is {amount} and it applies toward the repair. Want us to head over?",
    },
    {
      name: "Fault-photo ask",
      text: "Can you text a photo of the status light on the unit and how many times it's flashing? It helps us bring the right part the first time.",
    },
    {
      name: "Safety hold",
      text: "In the meantime, please leave the system off and don't keep resetting it, resetting a locked-out unit can make things worse. We'll be there soon.",
    },
    {
      name: "Quote follow-up",
      text: "Just checking in on the {system} quote we sent. Happy to answer questions or walk through financing options, no rush, and no pressure.",
    },
    {
      name: "Tune-up reminder",
      text: "It's about time for your seasonal tune-up under your maintenance plan. Want me to get you on the schedule this month? Reply with a day that works.",
    },
    {
      name: "Filter reminder",
      text: "Quick reminder to swap your filter this month, it keeps the system efficient and the warranty happy. Need us to drop off the right size? Just say the word.",
    },
  ],

  featuresH2: "Built for how an HVAC company actually works.",
  features: [
    {
      icon: Users,
      title: "A dispatch queue the whole team shares.",
      body: "Assign each call to a tech, and the surge becomes an ordered list with one owner per job, no two techs rolling to the same house.",
    },
    {
      icon: ThermometerSun,
      title: "Seasonal, without seasonal lock-in.",
      body: "Add techs on Pro for the busy season and drop back when it slows. Flat pricing, month to month, you're never paying for July capacity in October.",
    },
    {
      icon: CalendarClock,
      title: "Follow-ups that stay visible.",
      body: "Tag the install quotes and tune-up reminders; they sit on the list until they're closed, so the money doesn't leak while everyone's busy.",
    },
    {
      icon: Flame,
      title: "Works from the mechanical room.",
      body: "Any phone, one-handed, no app to install, push notifications for a new no-heat call. Dark mode for the pre-dawn cold-snap starts.",
    },
  ],

  pricingH2: "$29 a month, flat, cold snap or slow week.",
  pricingBody:
    "Starter covers 3 people, 1 local number, and 500 texts a month. A surge week will send more, that's fine, extra texts are 3¢ each up to a cap you set, and the composer shows the count as you type (photos of fault codes count as three). Running a bigger shop, or want to split your service line from your install line? Pro is $79, covers up to 10 people, and includes a second number for exactly that. Month to month, receiving always free, and for US companies a one-time $29 to register with the phone companies, $58 your first month, $29 after.",

  faqH2: "HVAC questions, straight answers.",
  faqs: [
    {
      q: "Does Loonext send maintenance reminders automatically?",
      a: "No, and we won't pretend it does. Reminders are something you send, fast, with a saved reply: pull up your plan customers and text the tune-up nudge in a couple of taps. That keeps it honest with the phone companies (no unsolicited blasts) and keeps a real person deciding who to contact. What Loonext gives you is the shared inbox where the whole team sees who's been reminded and who's booked.",
    },
    {
      q: "The calls all hit at once in a cold snap. How does a shared inbox help?",
      a: "It turns the pile-up into a queue. Every no-heat text becomes a conversation the whole team can triage, read the fault, note the likely part, assign the closest tech, send a window, so nothing rots in a voicemail box while a furnace is down.",
    },
    {
      q: "Can customers text photos of the fault code or model plate?",
      a: "Yes, and it's free to receive. A photo of the flashing status light or the data plate often tells you the part before anyone drives out, so the right motor or board is already on the van.",
    },
    {
      q: "We add techs for the busy season. Do we pay per person?",
      a: "No per-user fees. Starter is $29 for 3 people; scale to Pro at $79 for up to 10 during the surge, then drop back when it quiets down. It's month to month.",
    },
    {
      q: "How do we keep install quotes from going cold?",
      a: "Tag the conversation “Quote sent.” It stays on the list until someone closes it, so a big furnace or AC quote gets a real follow-up instead of slipping while everyone's chasing service calls.",
    },
    {
      q: "What do you need from our HVAC company to get us texting-approved?",
      a: "Two minutes at signup and your legal business name, address, and EIN. No EIN because you run as a sole proprietor? We'll verify you with a texted code instead and handle it. We submit the registration for you, receiving texts is live from the start, and texting US customers comes online in roughly a week once the phone companies sign off.",
    },
  ],

  finalH2: "Turn the cold-snap pile-up into a queue.",
  finalSub:
    "One shared inbox to triage the surge, read the fault, and keep the follow-ups from leaking. Live in minutes.",
};

export default function HvacPage() {
  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Home", path: "/" },
          { name: "Who it's for", path: "/#trades" },
          { name: "HVAC", path: PATH },
        ])}
      />
      <TradePage content={CONTENT} />
    </>
  );
}
