/**
 * /for/salons (trades track). BLUEPRINT §5. Angle: front desk is one person,
 * no-shows, appointment confirmations, waitlist fills, rebooking. Honesty guard
 * (§5): confirmations and waitlist fills are things you SEND (manual, fast with
 * saved replies), never "automated reminders." Zero shared sentences with any
 * other trade page. Own metadata + BreadcrumbList JSON-LD. Static (§11.4).
 */

import type { Metadata } from "next";
import {
  CalendarHeart,
  CalendarX,
  Clock,
  Image as ImageIcon,
  ListChecks,
  Scissors,
  Sparkles,
  Users,
} from "lucide-react";

import { JsonLd } from "@/components/marketing/ui/json-ld";
import { TradePage } from "@/components/marketing/trades/trade-page";
import type { TradeContent } from "@/components/marketing/trades/trade-page";
import { TradeGraphic, TradePhoto } from "@/components/marketing/trades/trade-graphic";
import { Display } from "@/components/marketing/display";
import { Photo } from "@/components/marketing/photo";
import { SALONS_SCRIPT } from "@/components/marketing/trades/scripts";
import { breadcrumbJsonLd, buildMetadata } from "@/lib/marketing/seo";

const PATH = "/for/salons";

export const metadata: Metadata = buildMetadata({
  title: "Text messaging for salons and barbershops",
  description:
    "A shared text inbox for salons: confirm appointments to cut no-shows, fill cancellations from your waitlist, and rebook clients. Flat $29/mo.",
  path: PATH,
});

const CONTENT: TradeContent = {
  slug: "salons",
  displayName: "Salons",

  eyebrow: "Business texting for salons and barbershops",
  h1: (
    <>
      The cancellation you can still fill, now{" "}
      <Display.Mark>caught</Display.Mark>.
    </>
  ),
  heroSub:
    "A no-show is an empty chair you can't get back, and a cancellation is only a loss if you can't fill it. JobText gives the front desk and every stylist one number to confirm appointments, work a waitlist, and rebook, so the chairs stay full and the “did they confirm?” guesswork ends.",
  heroTruthLine:
    "One number for the whole floor. Live in minutes. Month to month.",
  heroPhotoId: "owner-counter-phone",
  heroPhotoCaption: "Waitlist fill, caught",

  painH2: "An empty chair is money you can't earn back. A confirmation is cheap.",
  painBody: [
    "At a busy salon, the front desk is one person, and that person can't be answering the phone, checking someone out, and confirming tomorrow's column all at once. So confirmations slip, a client forgets, and at 2pm a stylist is standing at an empty chair that was booked solid a week ago. That gap is pure lost revenue, and it happens on the days you can least afford it.",
    "Cancellations aren't the problem; unfilled cancellations are. When a 3pm color cancels, there's almost always someone on a waitlist who'd take it, if you can reach them in the next ten minutes. JobText puts the whole floor on one inbox: confirm the day's appointments with a couple of taps, text the waitlist the moment a slot opens, and rebook a client before they've left the chair.",
  ],
  painVisual: (
    <TradePhoto
      photoId="salon-stylist"
      caption="A stylist can't work the chair and chase confirmations at once. The whole floor shares one inbox, so the schedule stays full."
    />
  ),

  threadH2: "A color appointment, confirmed and leveled-up.",
  threadLede:
    "A client texts to confirm Saturday and mentions she wants to go lighter. The desk flags the bigger lift for her stylist, who blocks extra time, adds a bond treatment, and sets the price expectation up front, so Saturday runs on schedule and there's no sticker shock at the chair.",
  script: SALONS_SCRIPT,
  supportingGraphic: (
    <TradeGraphic
      caption="One number for the whole floor, the front desk and every stylist see the same conversations, so a confirmation never depends on who's at the desk."
    >
      <Photo
        id="salon-cut"
        className="overflow-hidden rounded-xl"
        imgClassName="aspect-[4/3] object-cover"
        sizes="(min-width: 1024px) 28rem, 100vw"
      />
    </TradeGraphic>
  ),

  useCasesH2: "Where texting earns its keep in a salon.",
  useCases: [
    {
      icon: CalendarX,
      title: "Confirm appointments to cut no-shows.",
      body: "The day before, send each client a quick “confirming your 2pm with Jess tomorrow” with a saved reply. A client who taps back “yes” is a client who shows, and the whole team can see who's confirmed and who to chase, so it's not all on the front desk.",
    },
    {
      icon: Clock,
      title: "Fill a cancellation from the waitlist.",
      body: "A 3pm cancels; you text the two people who wanted that window and give it to whoever answers first. You're not automating a blast, you're sending a real, personal text in seconds, and turning a hole in the day back into revenue.",
    },
    {
      icon: CalendarHeart,
      title: "Rebook before they leave the chair.",
      body: "The best time to book the next visit is right after this one. A quick “want me to hold your usual slot in six weeks?” by text, from the shared number, keeps regulars on the calendar without the front desk playing phone tag.",
    },
    {
      icon: ImageIcon,
      title: "Talk through the look before the appointment.",
      body: "Clients text inspo photos ahead of a color or cut. The stylist sees it in the thread, flags a bigger-than-expected change, and sets time and price up front, fewer surprises in the chair, happier clients out the door.",
    },
  ],

  savedRepliesH2: "Six texts every salon sends. Steal these.",
  savedRepliesIntro:
    "Ready-to-edit saved replies for salons and barbershops, the confirmation, the waitlist offer, the rebook nudge, in a warm, on-brand voice your clients will recognize.",
  savedReplies: [
    {
      name: "Appointment confirmation",
      text: "Hi {name}! Confirming your {service} with {stylist} tomorrow at {time}. Reply YES to confirm, or let us know if you need to change it. Can't wait to see you!",
    },
    {
      name: "Waitlist offer",
      text: "Good news, a {time} spot with {stylist} just opened up {day}. Want it? First to reply gets it. Let me know and I'll lock it in.",
    },
    {
      name: "Rebook reminder",
      text: "It's been about six weeks, want me to book your next {service} with {stylist}? I can hold your usual day and time. Just reply and you're set.",
    },
    {
      name: "Running behind",
      text: "So sorry, {stylist} is running about 15 minutes behind. No need to rush over, we'll text you the moment we're ready for you.",
    },
    {
      name: "Consult ask",
      text: "Love that look! Before your appointment, could you text a photo or two so {stylist} can plan the time and give you an accurate price? It helps us give you exactly what you want.",
    },
    {
      name: "Thank you + review",
      text: "Thank you for coming in today! If you loved your {service}, a quick review really helps our little salon: {link}. See you next time!",
    },
  ],

  featuresH2: "Built for how a salon actually runs.",
  features: [
    {
      icon: Users,
      title: "The whole floor, one number.",
      body: "Front desk and every stylist see the same conversations, so a confirmation or a waitlist fill doesn't depend on who's standing at the desk.",
    },
    {
      icon: Scissors,
      title: "Assign a client to their stylist.",
      body: "Each conversation has one owner, so the color question reaches the colorist and nothing gets answered twice or not at all.",
    },
    {
      icon: Sparkles,
      title: "Notes only the team sees.",
      body: "“Sensitive scalp, always books the 2pm, big lift last time”, internal notes on the client that never get sent as a text.",
    },
    {
      icon: ListChecks,
      title: "No app, no learning curve.",
      body: "It works like texting on the phone your team already carries, open a link and you're in. Push notifications when a client replies to a confirmation.",
    },
  ],

  pricingH2: "$29 a month for the whole salon.",
  pricingBody:
    "Starter covers 3 people, 1 local number, and 500 texts a month, enough to confirm a full book and work a waitlist (a plain confirmation is one text; the composer shows the count as you type). More chairs, or a second location? Pro is $79 for up to 10 people and gives you a second number to keep two shops separate. Month to month, receiving always free, and for US salons a one-time $29 to register with the phone companies, so it's $58 your first month, then $29 every month after.",

  faqH2: "Salon questions, straight answers.",
  faqs: [
    {
      q: "Will JobText send appointment reminders on its own?",
      a: "No, you send them, and that's on purpose. Pull up tomorrow's column and text each client a confirmation with a saved reply; it takes a couple of taps per client and keeps a real person in the loop (the phone companies don't allow unsolicited blasts, and we won't fake “automated”). What you get is one shared inbox where the whole team sees who's confirmed and who hasn't.",
    },
    {
      q: "How does texting actually reduce no-shows?",
      a: "A client who's tapped “yes” to a confirmation is far more likely to show than one who booked a week ago and forgot. Because the confirmations live in a shared inbox, anyone on the team can send them and see who still needs a nudge, it doesn't all fall on the front desk on a busy morning.",
    },
    {
      q: "Can we fill a last-minute cancellation from a waitlist?",
      a: "Yes, that's one of the best uses. When a slot opens, text the clients who wanted that window and give it to whoever replies first. It's a personal, one-to-one text sent in seconds, not an automated blast, so it stays warm and stays compliant.",
    },
    {
      q: "Every stylist has their own clients. Can they each see their own?",
      a: "Assign each conversation to the right stylist and it has one clear owner, while the front desk still sees everything to help confirm and rebook. One number, one inbox, but never a free-for-all where two people answer the same client.",
    },
    {
      q: "Do confirmation texts eat up our 500?",
      a: "A plain confirmation counts as one text, so 500 covers a lot of “see you tomorrow” messages; the composer shows the count before you send. Go over on a big week and it's 3¢ each up to a cap you control, no surprise bill.",
    },
    {
      q: "What does it take to get our salon set up to text?",
      a: "Just a couple of minutes at signup: your salon's legal name, address, and EIN. Booth renter or sole proprietor without an EIN? We'll verify you with a texted code instead. We take care of registering you with the phone companies. You'll be receiving texts right away, and texting US clients begins about a week later once you're approved.",
    },
  ],

  finalH2: "Keep the chairs full.",
  finalSub:
    "Confirm appointments, fill cancellations from your waitlist, and rebook, all from one number the whole floor shares. Live in minutes.",
};

export default function SalonsPage() {
  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Home", path: "/" },
          { name: "Who it's for", path: "/#trades" },
          { name: "Salons", path: PATH },
        ])}
      />
      <TradePage content={CONTENT} />
    </>
  );
}
