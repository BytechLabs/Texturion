import type { Metadata } from "next";

import {
  ArticleLede,
  ArticlePage,
  ArticleSection,
  ArticleLink,
  ArticleList,
} from "@/components/marketing/blog/article-page";
import { blogPost, blogPostPath } from "@/lib/marketing/blog";
import { buildMetadata } from "@/lib/marketing/seo";

const POST = blogPost("missed-calls-lost-jobs-text-back-playbook");

export const metadata: Metadata = buildMetadata({
  title: POST.title,
  description: POST.description,
  path: blogPostPath(POST.slug),
});

export default function Page() {
  return (
    <ArticlePage post={POST}>
      <ArticleLede>
        <p>You&apos;re under a sink with both hands on a wrench when the phone buzzes in your pocket. By the time you crawl out, wipe off, and call back, forty minutes have passed. The caller didn&apos;t wait forty minutes. They hung up, tapped the next result, and someone else picked up.</p>
        <p>That&apos;s not a discipline problem. It&apos;s physics. You can&apos;t answer a phone from a ladder, a crawlspace, or the middle of a color treatment, and the hours when you&apos;re busiest are exactly the hours when new work calls in. The fix isn&apos;t answering more calls. It&apos;s making sure every call you miss gets a text back within about a minute.</p>
        <p>This playbook covers the math, why voicemail doesn&apos;t save you, copy and paste text-back templates by trade, what to do when the customer replies, and how to follow up when a quote goes quiet.</p>
      </ArticleLede>

        <ArticleSection id="the-math-on-one-missed-call" heading="The math on one missed call.">
          <p>Run your own numbers, not somebody&apos;s marketing statistic. Take your average job value. Now guess how many calls you miss in a week while you&apos;re on a roof, in a basement, or with a client. If even one of those callers a week books with the next company on the list, multiply that job value by 52 and look at the annual number. For most trades it&apos;s an uncomfortable figure.</p>
          <p>The callers most likely to bail are also the most valuable ones. A homeowner with water on the floor or a dead furnace in January isn&apos;t leaving a voicemail and waiting politely. They&apos;re working down the search results until a human responds, and the first company to respond usually gets the job.</p>
          <p>Worst of all, missed calls cluster at your busiest moments. The week you&apos;re slammed is the week you miss the most new work, which is exactly backwards from how you&apos;d want it.</p>
        </ArticleSection>

        <ArticleSection id="why-voicemail-loses-the-lead" heading="Why voicemail is where leads go to die.">
          <p>Plenty of people won&apos;t leave a voicemail for a business they&apos;ve never used. There&apos;s no relationship yet, and calling the next number costs them nothing. The ones who do leave a message usually keep shopping while they wait, so even a callback an hour later often lands after they&apos;ve booked elsewhere.</p>
          <p>A text back within a minute changes the dynamic. The caller now knows a real business saw them, knows roughly when they&apos;ll hear back, and has something easy to do in the meantime: reply. Replying to a text takes ten seconds and doesn&apos;t require them to stop what they&apos;re doing, which is why people answer texts from businesses they&apos;d never pick up a call from.</p>
          <p>It also quietly takes them off the market. Someone who has an open text thread going with you feels less need to keep dialing competitors. You bought yourself the hour you needed to finish the job you were on, without pretending you weren&apos;t busy.</p>
        </ArticleSection>

        <ArticleSection id="text-back-templates-by-trade" heading="Text-back templates by trade.">
          <p>A good text back does four things: names a real person, names the business, gives an honest timeline, and asks one question that moves the job forward. Skip links and promo language. It should read like a busy human typed it, because the version customers respond to is the one that sounds like you. Steal these and edit them into your own voice.</p>
          <ArticleList>
            <li>Emergency plumbing: &quot;This is [Your name] at [Business name]. Sorry I missed you, I&apos;m on a job. If water is actively leaking, shut off the valve under the fixture or at the main. Text me a photo of what&apos;s going on and I&apos;ll call you within the hour.&quot;</li>
            <li>HVAC quote: &quot;Hi, it&apos;s [Your name] from [Business name]. I missed your call while up on a unit. Are you after a repair or a replacement quote? Text me the make and model from the sticker on the unit and I can give you a ballpark today.&quot;</li>
            <li>Salon booking: &quot;Hey, it&apos;s [Business name]! We&apos;re with clients right now. Text us the service you&apos;re after and a couple of days that work for you and we&apos;ll get you booked, usually within the hour.&quot;</li>
            <li>Landscaping estimate: &quot;This is [Your name] with [Business name]. Sorry I missed your call, I&apos;m out on a property. Text me your address and what you&apos;d like done and I&apos;ll come by for a free estimate this week.&quot;</li>
            <li>Cleaning inquiry: &quot;Hi, this is [Business name]. We missed you while out at a job. Text us the size of your place and how often you&apos;re thinking (one time, weekly, biweekly) and we&apos;ll send you a price today.&quot;</li>
          </ArticleList>
        </ArticleSection>

        <ArticleSection id="what-happens-after-they-reply" heading="What happens after they reply.">
          <p>The text back solves minute one. Minute five is when the customer replies with a photo of the leak and a question, and somebody on your side has to answer. If those replies land on the owner&apos;s personal cell, you haven&apos;t fixed the bottleneck, you&apos;ve just moved it. The owner is still under a sink somewhere.</p>
          <p>The routing that actually works is a <ArticleLink href="/features/shared-inbox">shared inbox</ArticleLink> on the business number: every reply lands in one place the whole crew can open, whoever is free claims the conversation, and everyone else can see it&apos;s handled. In Loonext each conversation has an owner and a status, and internal notes let the office manager write &quot;quoted him $450 last fall&quot; without the customer ever seeing it.</p>
          <p>The alternative, forwarding texts to one person&apos;s phone or running a group chat, falls apart the first week someone goes on vacation. If you&apos;ve lived that, you already know why <ArticleLink href="/blog/stop-giving-customers-your-personal-cell-number">your personal cell shouldn&apos;t be the business number</ArticleLink>.</p>
        </ArticleSection>

        <ArticleSection id="setting-it-up" heading="Setting it up: business hours, after hours, and the compliance footnote.">
          <p>Write two versions. The business-hours version says you&apos;re on a job and gives a same-day window: &quot;back to you within the hour.&quot; The after-hours version sets tomorrow&apos;s expectation and gives emergencies an escape hatch: &quot;We&apos;re closed for the day and will reply first thing at 8am. If this is an emergency, reply EMERGENCY and we&apos;ll call you.&quot; Honest timelines beat fast ones you won&apos;t hit.</p>
          <p>On the compliance side, both TCPA in the US and CASL in Canada draw a line between marketing blasts and one-to-one conversational replies to a customer who contacted you, and a one-to-one reply to someone who just reached out to you about a job is generally treated as conversational rather than marketing, as of mid-2026. Keep it that way: no coupon links, no upsells, just a reply to their request. And if anyone ever texts STOP, <ArticleLink href="/blog/customer-texted-stop-now-what">stop immediately</ArticleLink>.</p>
          <p>Tooling wise, your platform should do the after-hours part automatically. Loonext includes an after-hours auto-reply in your own words, sent at most once per burst of messages in a conversation so nobody gets robot-spammed, and calling is included on every plan: calls forward to a phone you choose and missed callers automatically get a text back. Plans are flat per company, not per seat, on the <ArticleLink href="/pricing">pricing page</ArticleLink>.</p>
        </ArticleSection>

        <ArticleSection id="following-up-on-quiet-quotes" heading="Following up on quotes that went quiet.">
          <p>The missed call you rescued often turns into a quote, and quotes go quiet. Silence usually isn&apos;t a no. It&apos;s a homeowner who got busy, is waiting on a spouse, or lost your number in their call log. Two short follow-ups, one a couple of days after the quote and one about a week later, recover jobs you&apos;d otherwise write off.</p>
          <ArticleList>
            <li>Day 2 or 3: &quot;Hi [Name], it&apos;s [Your name] from [Business name]. Just making sure the quote for [job] came through okay. Happy to answer any questions on it.&quot;</li>
            <li>About a week: &quot;Hi [Name], following up one last time on the [job] quote. If the timing isn&apos;t right, no problem at all, just let me know either way so I can plan the schedule.&quot;</li>
          </ArticleList>
          <p>Keep both short and pressure free. The &quot;let me know either way&quot; line matters: it gives people permission to say no, which is how you get answers instead of silence. Tags like &quot;Quote sent&quot; and a weekly ten-minute sweep of open quotes make this a habit instead of a memory test. There&apos;s a full script breakdown in <ArticleLink href="/blog/how-to-text-quotes-to-customers">how to text quotes to customers</ArticleLink>.</p>
        </ArticleSection>

        <ArticleSection id="start-with-the-next-missed-call" heading="Start with the next missed call.">
          <p>You don&apos;t need a system overhaul to start. Today: write your business-hours and after-hours texts in your own words. This week: get a text-back firing automatically on every missed call (if your tool supports separate business-hours and after-hours messages, load both), and pick where replies land so anyone free can answer. This month: add the two-touch quote follow-up.</p>
          <p>None of it makes you answer more calls. It just makes sure that when you can&apos;t, the caller hears from you before they hear from your competitor.</p>
        </ArticleSection>
    </ArticlePage>
  );
}
