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

const POST = blogPost("how-to-text-quotes-to-customers");

export const metadata: Metadata = buildMetadata({
  title: POST.title,
  description: POST.description,
  path: blogPostPath(POST.slug),
});

export default function Page() {
  return (
    <ArticlePage post={POST}>
      <ArticleLede>
        <p>You did the walkthrough Tuesday. You measured, priced the parts, wrote up a clean estimate, and emailed it as a PDF that afternoon. It&apos;s Friday and the customer hasn&apos;t opened it. Meanwhile somebody else texted them a number Wednesday morning and got the job.</p>
        <p>That&apos;s the whole problem with quotes in a nutshell. The work of pricing a job is hard. Getting the number in front of the customer while they&apos;re still deciding should be easy, and for most service businesses it isn&apos;t, because the quote lives in an email nobody checks and the conversation lives in a text thread on somebody&apos;s personal phone.</p>
        <p>This article is the fix: what a quote text should actually say, ten templates you can copy today, a follow-up cadence that doesn&apos;t make you feel like a telemarketer, and the etiquette that separates pros from pests. None of it requires buying anything.</p>
      </ArticleLede>

        <ArticleSection id="why-texted-quotes-get-answered" heading="Why texted quotes get answered and emailed PDFs wait until later.">
          <p>People read texts almost immediately. An emailed PDF waits until the customer is back at a computer, remembers it exists, downloads it, and zooms around a page that was formatted for printer paper. On a phone, that&apos;s three chores before they even see your price.</p>
          <p>A quote by text lands in the same place the customer already talks to their family and their other contractors. They can read it at a red light, forward it to a spouse, and reply with one word. Every step you remove between &quot;sees the number&quot; and &quot;says yes&quot; is a step your competitor can&apos;t win the job in.</p>
          <p>The PDF still has a place. For a multi-page scope with exclusions and payment terms, send the document too. But the number, the one-line scope, and the ask belong in the text itself, not behind an attachment.</p>
        </ArticleSection>

        <ArticleSection id="anatomy-of-a-quote-text" heading="The anatomy of a quote text: four things, nothing else.">
          <p>A quote text needs exactly four parts. The price, stated plainly. The scope in one sentence, so there&apos;s no argument later about what the number covered. An expiry date, which gives the customer an honest reason to decide instead of letting the quote drift forever. And one clear next step, phrased as a question they can answer with a single word.</p>
          <p>Put together: &quot;Hi Maria, it&apos;s Dave from [Business name]. For the water heater replacement we looked at: $1,850, includes the new 50-gallon unit, haul-away, and permit. That price is good through the 24th. Want me to get you on the schedule?&quot;</p>
          <p>Notice what&apos;s not in there. No apology for the price, no wall of caveats, no &quot;let me know if you have any questions or concerns whatsoever.&quot; You gave a number, you defined it, you asked for the job. That reads as confidence, and confidence wins bids.</p>
        </ArticleSection>

        <ArticleSection id="ten-copy-paste-templates" heading="Ten copy-paste templates.">
          <p>Swap the brackets and send. These are written to sound like a person, not a billing system, because you&apos;re a person and the customer is deciding whether to let you into their house.</p>
          <ArticleList>
            <li>Initial quote: &quot;Hi [Name], it&apos;s [Your name] from [Business name]. For the [job] we looked at: [price], includes [one-line scope]. Good through [date]. Want me to get you on the schedule?&quot;</li>
            <li>Quote with photo: &quot;Hi [Name], [Your name] from [Business name]. Photo attached shows the section we&apos;d replace. Total is [price], parts and labor. Good through [date]. Reply yes and I&apos;ll book it.&quot;</li>
            <li>Good-better-best: &quot;Hi [Name], three options for the [job]. Patch it for now: [price A]. Replace the worn parts: [price B]. Full replacement with warranty: [price C]. Happy to walk through any of them. Which way are you leaning?&quot;</li>
            <li>Price-increase heads-up: &quot;Hi [Name], quick heads-up before your quote from [date] lapses: material costs went up, so a fresh quote would come in higher. I can hold [price] if you book by [date]. Want me to?&quot;</li>
            <li>Revision: &quot;Hi [Name], updated quote as discussed: [price], now including [change]. Everything else stays the same. Good through [date]. Want me to lock it in?&quot;</li>
            <li>Buying time after a visit: &quot;Hi [Name], thanks for walking me through the job today. I&apos;ll have your quote to you by [day]. Anything you want me to include while I&apos;m pricing it?&quot;</li>
            <li>Expiry reminder: &quot;Hi [Name], your quote for the [job] ([price]) expires [date]. No pressure either way, just didn&apos;t want it to lapse without a heads-up. Want me to extend it a week?&quot;</li>
            <li>Soft close: &quot;Hi [Name], checking in on the [job] quote. If the price is the sticking point, tell me and I&apos;ll see what I can do. If the timing&apos;s wrong, I can pencil you in for next month instead.&quot;</li>
            <li>You won: &quot;Great, you&apos;re booked for [date]. I&apos;ll text you that morning with an arrival window. Anything you need from me before then?&quot;</li>
            <li>You lost, gracefully: &quot;No problem at all, [Name]. I&apos;ll close this one out. If anything changes down the road, this number reaches me directly. Thanks for considering us.&quot;</li>
          </ArticleList>
          <p>Type these once and you shouldn&apos;t have to type them again. In Loonext, saved replies fire from a &quot;/&quot; shortcut mid-conversation, and you can tag the thread Quote sent so nothing falls through. Details at <ArticleLink href="/features/templates-and-tags">templates and tags</ArticleLink>.</p>
        </ArticleSection>

        <ArticleSection id="follow-up-cadence" heading="The follow-up cadence that isn&apos;t annoying.">
          <p>Most quotes die of silence, not rejection. The customer meant to answer, got busy, and now feels awkward. Your follow-ups should make replying easy again, and there should be exactly three of them.</p>
          <ArticleList>
            <li>Day 2, the receipt check: &quot;Hi [Name], just making sure the quote came through OK. Happy to answer anything.&quot; You&apos;re confirming delivery, not pushing. It gives a busy customer a graceful way back in.</li>
            <li>Day 5, add something: &quot;Hi [Name], one thing I forgot to mention: the warranty covers labor too, not just parts. Let me know if you have questions on the quote.&quot; Any real detail works. You&apos;re giving, not asking.</li>
            <li>Day 10, permission to close: &quot;Hi [Name], I&apos;ll assume the timing isn&apos;t right and close this one out unless I hear from you. The quote stays good through [date] if anything changes.&quot; Don&apos;t be surprised if this is the one that finally gets a reply: people hate open loops.</li>
          </ArticleList>
          <p>After day 10, stop. A fourth chase doesn&apos;t win jobs, it earns you a block. Close the thread, tag it Lost if you track that, and spend the energy on the next estimate.</p>
        </ArticleSection>

        <ArticleSection id="etiquette-the-pros-follow" heading="Etiquette the pros follow.">
          <p>Text during business hours. A quote at 9pm reads as desperate at best and rude at worst, and a first text late at night can sour the deal before they&apos;ve read the price. If you write it after dinner, send it in the morning.</p>
          <p>Name yourself every time until they clearly know you. &quot;Hi, it&apos;s Dave from [Business name]&quot; costs six words and saves the &quot;who is this?&quot; reply that stalls quote threads before they start. And text from your business number, not your personal cell, so the relationship belongs to the company. There&apos;s a whole argument for that in <ArticleLink href="/blog/stop-giving-customers-your-personal-cell-number">stop giving customers your personal cell number</ArticleLink>.</p>
          <p>Keep it to one thread. The quote, the revision, the scheduling, and the day-of confirmation should all live in the same conversation. When the customer scrolls up, they should see the entire history of the job, because you will need that history the day someone says &quot;that&apos;s not the price you told me.&quot;</p>
        </ArticleSection>

        <ArticleSection id="photos-and-long-details" heading="Photos and long details: attach or link.">
          <p>A photo of the actual problem is the strongest sales tool you own. &quot;Here&apos;s the corroded fitting we&apos;d replace&quot; turns an abstract number into an obvious decision, and it proves you looked closely at their job, not a price sheet. Attach the photo in the same message as the price whenever you can.</p>
          <p>For long scopes, don&apos;t cram ten line items into a text. Send the four-part quote text, attach or link the full document, and say &quot;full breakdown attached.&quot; The text sells, the document specifies. One practical note: some texting platforms charge extra to send photos, so check before you build your workflow around them. On Loonext, sending photos is included on every plan and receiving them is free.</p>
        </ArticleSection>

        <ArticleSection id="the-paper-trail" heading="The paper trail: quotes in a shared inbox vs trapped on three phones.">
          <p>Every quote you text is a record: the price, the scope, the date, the customer&apos;s yes. That record is only useful if the business can find it. When quotes go out from three techs&apos; personal phones, the paper trail is whatever each guy remembers, and it walks out the door when he does.</p>
          <p>A <ArticleLink href="/features/shared-inbox">shared inbox</ArticleLink> on one business number fixes that: every quote, revision, and yes sits in one searchable place, whoever sent it. Anyone in the office can pull up the thread when the customer calls, see it&apos;s tagged Quote sent, and answer without the &quot;let me check with Dave&quot; dance. If you&apos;re weighing the options, here&apos;s <ArticleLink href="/blog/shared-inbox-vs-group-text-vs-forwarding">shared inbox vs group text vs forwarding</ArticleLink> laid out honestly.</p>
        </ArticleSection>

        <ArticleSection id="compliance-footnote" heading="Compliance footnote: replying to someone who texted you is conversational.">
          <p>If the customer texted you first, replying with a quote is conversational, and both US and Canadian rules treat 1:1 conversational replies to a customer who texted you differently from marketing blasts. If they only called or filled out a form asking for an estimate, the consent rules get more specific, and it&apos;s worth knowing where the lines are before you make texting them your default.</p>
          <p>The rules still exist, though. If a customer texts STOP, that&apos;s final, even mid-quote. And keep quote follow-ups about that quote; the moment you start texting past customers about spring specials, you&apos;re in marketing territory with different consent rules. The full picture, including what counts as consent when the customer called or filled out a form, is in our <ArticleLink href="/blog/tcpa-rules-texting-customers-service-business">TCPA guide for service businesses</ArticleLink>.</p>
          <p>This article is general information, not legal advice. If you are unsure how the rules apply to your business, talk to a lawyer.</p>
        </ArticleSection>
    </ArticlePage>
  );
}
