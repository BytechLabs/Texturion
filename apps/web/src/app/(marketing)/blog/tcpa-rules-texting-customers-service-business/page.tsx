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

const POST = blogPost("tcpa-rules-texting-customers-service-business");

export const metadata: Metadata = buildMetadata({
  title: POST.title,
  description: POST.description,
  path: blogPostPath(POST.slug),
});

export default function Page() {
  return (
    <ArticlePage post={POST}>
      <ArticleLede>
        <p>A customer texts your business number: &quot;Hey, can you come look at my furnace this week?&quot; You text back a time. Somewhere between that reply and your first &quot;we&apos;re running a spring tune-up special&quot; message, you cross from a normal conversation into territory covered by the TCPA, the US law behind the $500-per-text lawsuit headlines.</p>
        <p>Most TCPA advice online is aimed at companies sending bulk promotional blasts. That&apos;s not you. You&apos;re a plumber, a cleaner, a salon owner answering people who texted you first, and the law treats that very differently. The honest news is mostly good.</p>
        <p>This guide covers what actually applies to a small service business texting real customers one at a time: what a reply can say, when you need explicit permission, what changed in 2025, and what has to happen the instant someone texts STOP.</p>
      </ArticleLede>

        <ArticleSection id="conversational-vs-marketing" heading="The one distinction that decides everything.">
          <p>The TCPA doesn&apos;t treat all texts the same. The line that matters is informational versus marketing. A message that answers a question the customer asked, confirms an appointment, delivers the quote they requested, or updates them on a job is informational. A message that tries to sell them something new is marketing, and marketing is where the strict consent rules and the lawsuits live.</p>
          <p>The test is simple enough to run in your head before you hit send: did this person ask for this message, or am I promoting something? &quot;Your tech is 20 minutes out&quot; is the first kind. &quot;20% off duct cleaning this month&quot; is the second, even if you send it to a happy repeat customer.</p>
        </ArticleSection>

        <ArticleSection id="when-the-customer-texts-first" heading="If the customer texts you first, you can text back.">
          <p>When someone texts your business number about a leaky water heater, they&apos;ve given you permission to text them back about the leaky water heater. Replying to their inquiry, scheduling the visit, <ArticleLink href="/blog/how-to-text-quotes-to-customers">sending the quote</ArticleLink>, asking follow-up questions, sending the invoice: all of that is responding to a conversation they started, and as of mid-2026 it is not what TCPA plaintiffs go after.</p>
          <p>That consent is scoped to the matter at hand, though. It covers the job and reasonably related follow-up, like &quot;did the fix hold?&quot; a week later. It is not permanent permission to market to them. The customer who texted you about a furnace repair in January did not sign up for your promo list.</p>
          <p>One caution: consent belongs to the person, not the phone number. Numbers get reassigned, so if a text comes back &quot;wrong number,&quot; stop texting it and update your contact record.</p>
        </ArticleSection>

        <ArticleSection id="when-you-need-express-consent" heading="When you do need express consent, and how to ask without being weird.">
          <p>Promos, seasonal offers, &quot;we miss you&quot; messages, and (to be safe) review requests should all be treated as marketing. For marketing texts, the standard is prior express written consent. As of mid-2026, a text reply can count as written consent under federal e-signature rules, as long as your ask spells out what they are agreeing to. The clean way to collect it is to just ask, right after a job goes well, in plain words that say what they&apos;re agreeing to.</p>
          <ArticleList>
            <li>&quot;Thanks again for having us out, [First name]. Want a text when we run our fall tune-up special? Reply YES to join. Reply STOP anytime to leave.&quot;</li>
            <li>&quot;We start booking spring cleanups in March. OK if we text you when the schedule opens? Reply YES and you&apos;re on the list.&quot;</li>
            <li>On paper: a line on your invoice or intake form that says what texts they&apos;ll get and roughly how often, with a box the customer checks themselves.</li>
          </ArticleList>
          <p>Then keep a record: who agreed, what they agreed to, and the date. If a dispute ever comes up, that record is the whole ballgame. A yes you can&apos;t prove is worth very little.</p>
        </ArticleSection>

        <ArticleSection id="the-2025-revocation-changes" heading="The 2025 changes: opting out got much broader.">
          <p>FCC rule changes that took effect in 2025 made two things explicit. First, customers can revoke consent by any reasonable method, not just the word STOP. &quot;Please stop texting me,&quot; &quot;unsubscribe,&quot; &quot;no more,&quot; or &quot;take me off the list&quot; all count. Second, revocations must be honored within 10 business days.</p>
          <p>The practical takeaway for a small shop: treat any plain-English opt-out exactly like STOP, and don&apos;t use the 10 days. Honor it the moment you see it. The grace period exists for enterprises with clunky systems, not for a three-person crew reading every message anyway.</p>
        </ArticleSection>

        <ArticleSection id="quiet-hours-identity-content" heading="Quiet hours, identifying yourself, and banned content.">
          <p>Three smaller rules, quickly. Timing: as of mid-2026, federal telemarketing rules bar marketing contact before 8am or after 9pm in the recipient&apos;s local time, and some states are stricter. Replying at 9:30pm to a customer who just texted you is fine. Starting a promotional conversation at 9:30pm is not. Keep anything marketing-flavored inside business hours and you&apos;ll never think about this again.</p>
          <p>Identity: say who you are the first time you text someone. &quot;Hi, it&apos;s [Your name] from [Business name]&quot; costs six words and removes both a legal question and the &quot;who is this?&quot; reply. Content: carriers filter business texting on their own, blocking unregistered traffic entirely apart from the TCPA, so even a legal message can silently fail if your number isn&apos;t properly registered.</p>
        </ArticleSection>

        <ArticleSection id="what-stop-must-trigger" heading="What STOP should trigger, instantly and automatically.">
          <p>When a customer texts STOP, future texts to that number have to stop, and the law gives you at most 10 business days to make that happen. The right way to run a shop is to stop them the moment the message lands, not after the current job wraps up and not whenever someone remembers to update the spreadsheet. A single message confirming the opt-out is generally considered acceptable; beyond that, nothing until they opt back in themselves.</p>
          <p>The dangerous version of this in a shared shop is human memory: the customer texted STOP to whoever had the phone on Tuesday, and someone else texts them Thursday. This is a job for software, not discipline. Loonext honors STOP instantly and blocks all future sends to that contact automatically, no matter who on the crew tries. We wrote up the full playbook in <ArticleLink href="/blog/customer-texted-stop-now-what">a customer texted STOP, now what?</ArticleLink></p>
        </ArticleSection>

        <ArticleSection id="what-the-penalties-mean" heading="The realistic risk: what $500 to $1,500 per text means.">
          <p>TCPA statutory damages run $500 to $1,500 per violating text, and the customer doesn&apos;t have to prove any actual harm. Do the math on a blast: one promo sent to a 300-number list without provable consent is $150,000 to $450,000 in theoretical exposure. For a three-person shop, one bad afternoon with a bought list is a business-ending event, and, as of mid-2026, TCPA litigation has a well-known cottage industry of repeat plaintiffs.</p>
          <p>Now flip it. Texting one customer at a time, about the job they contacted you about, with opt-outs honored instantly, is about the lowest-risk business messaging there is. As of mid-2026, the suits that make headlines mostly involve three behaviors: purchased phone lists, mass blasts without consent records, and ignored opt-outs. Avoid those three and the scary number mostly stops applying to you.</p>
        </ArticleSection>

        <ArticleSection id="compliance-checklist" heading="A checklist you can finish this afternoon.">
          <ArticleList>
            <li>Only text numbers that contacted you first or were given to you for this purpose. Never buy a list.</li>
            <li>Before any promotional text, get a clear yes, and write down who said it and when.</li>
            <li>Treat STOP, &quot;unsubscribe,&quot; and any plain-English opt-out the same way: block the number from future sends immediately.</li>
            <li>Keep marketing texts inside business hours in the customer&apos;s time zone.</li>
            <li>Open first contacts with your name and business name.</li>
            <li>Keep every conversation in one searchable place, not scattered across three personal phones, so you can prove what was said and when.</li>
          </ArticleList>
          <p>The last mile is what your platform should do without you thinking about it: record consent with a name and date when you start a conversation, block opted-out numbers instantly, and warn you before you start a conversation late at night. Loonext does all three, sends messages exactly as you typed them with no auto-appended footer, and has no blast feature at all, which removes the highest-risk category by design. The details are on the <ArticleLink href="/features/compliance">compliance features page</ArticleLink>.</p>
          <p>If you serve Canadian customers, a separate law applies on top of all this. See <ArticleLink href="/blog/casl-text-message-rules-canada">CASL text message rules for Canada</ArticleLink>.</p>
          <p>This article is general information, not legal advice. If you are unsure how the rules apply to your business, talk to a lawyer.</p>
        </ArticleSection>
    </ArticlePage>
  );
}
