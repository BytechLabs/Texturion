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

const POST = blogPost("customer-texted-stop-now-what");

export const metadata: Metadata = buildMetadata({
  title: POST.title,
  description: POST.description,
  path: blogPostPath(POST.slug),
});

export default function Page() {
  return (
    <ArticlePage post={POST}>
      <ArticleLede>
        <p>You sent a customer a perfectly normal message, maybe a reminder about tomorrow&apos;s appointment, and the reply came back as one word: STOP. Now the conversation looks locked in your texting app, there&apos;s a warning banner you&apos;ve never seen before, and you&apos;re not sure whether you just lost a customer or broke a law.</p>
        <p>Take a breath. One STOP is not a lawsuit, and most of the time it isn&apos;t even anger. But what you do in the next few minutes matters, because the fastest way to turn a routine opt-out into genuine legal exposure is to try to work around it.</p>
        <p>Here&apos;s what actually happened the moment they hit send, what you&apos;re allowed to do next, and how to make sure nobody on your crew texts that number again by accident.</p>
      </ArticleLede>

        <ArticleSection id="what-happens-the-moment-they-text-stop" heading="What technically happens the moment someone texts STOP">
          <p>STOP is a reserved keyword in business texting. When a customer sends it to a business number, a well-built platform flags that number as opted out and blocks future outbound texts to it. Most platforms also send one final automated confirmation, something like &quot;You have been unsubscribed. No more messages will be sent.&quot; That confirmation is standard practice: as of mid-2026, a single immediate confirmation with no marketing in it is treated as part of the opt-out, not a new message.</p>
          <p>The important part: this happens at the system level, not in your app&apos;s settings. You didn&apos;t do it, and on most platforms you can&apos;t undo it yourself, which is by design. If yours lets you, don&apos;t. The block is the system protecting you from accidentally texting someone who just revoked consent.</p>
          <p>Why so strict? In the US, texting someone after they&apos;ve opted out is exactly where <ArticleLink href="/blog/tcpa-rules-texting-customers-service-business">TCPA</ArticleLink> statutory damages live: $500 to $1,500 per violating text, and every text after the STOP is potentially its own violation. Since the FCC&apos;s 2025 rule changes, consumers can revoke consent by any reasonable method and revocations must be honored within 10 business days. STOP is the clearest possible revocation, so platforms built for business texting treat it as immediate.</p>
        </ArticleSection>

        <ArticleSection id="mistakes-that-turn-one-stop-into-a-lawsuit" heading="The mistakes that turn one STOP into a lawsuit">
          <p>A single STOP costs you nothing. The damage comes from what people do next, usually with good intentions. These are the moves to avoid:</p>
          <ArticleList>
            <li>Texting them from another number. Your personal cell, a second business line, a teammate&apos;s phone. Treat the opt-out as covering your business, not just the number they texted. &quot;Sorry to bother you, just confirming Thursday&quot; from your personal phone is still a business text to someone who said stop.</li>
            <li>Manually adding them back. If your platform lets you clear the block yourself, don&apos;t. Opting back in has to come from them (more on that below).</li>
            <li>Sending one last message to apologize or explain. The confirmation the system already sent is the last message. Yours would be a new one, after revocation.</li>
            <li>Calling repeatedly to ask why or to talk them back into texts. One polite call about an existing job is normal business. A pressure campaign to undo an opt-out looks terrible and defeats the point of honoring it.</li>
          </ArticleList>
          <p>The pattern behind all four: treating STOP as an obstacle to route around instead of an instruction to follow. Texts after a documented opt-out make an easy case, because the revocation is timestamped and the violation is on paper.</p>
        </ArticleSection>

        <ArticleSection id="was-it-even-meant-for-you" heading="Was it even meant for you?">
          <p>Here&apos;s the scenario that trips up service businesses: the customer texted STOP, but they still want the appointment. Maybe they were clearing out reminder texts from every business at once. Maybe a kid had the phone. Maybe they thought STOP only killed the marketing messages, not the conversation with you.</p>
          <p>It doesn&apos;t matter. STOP applies to the number, not to what they meant. Keep the job on the schedule, show up as planned, and honor the block in the meantime. Don&apos;t cancel work because of an opt-out, and don&apos;t text to double-check the appointment either. If you genuinely need to confirm something, call once, or email if you have an address.</p>
          <p>If they mention it when you see them (&quot;why did your reminders stop?&quot;), that&apos;s your opening. Tell them what happened and how to turn texts back on. Which brings us to the next part.</p>
        </ArticleSection>

        <ArticleSection id="how-opting-back-in-works" heading="How opting back in actually works">
          <p>Only the customer should lift the block, and they do it by texting a keyword, usually START (some systems also accept UNSTOP or YES), to the same number they opted out from. That single text tells the platform they&apos;ve re-consented, and normal messaging resumes.</p>
          <p>Even if your tool lets you clear the block yourself, don&apos;t. The whole value of the keyword system is that consent and revocation are recorded actions taken by the customer, with timestamps, not notes in your CRM that say &quot;Dave said it was fine.&quot;</p>
          <p>So when a customer says in person or on the phone that they want texts again, the script is simple: &quot;No problem. Text START to this number and it&apos;ll switch back on.&quot; If they&apos;d rather you kick things off, hold the line; the block should stay until their START arrives. Once it does, you&apos;re back to normal.</p>
        </ArticleSection>

        <ArticleSection id="handling-stop-in-a-shared-inbox" heading="Handling it operationally so nobody on the crew texts them again">
          <p>In a one-person shop, STOP is easy: you saw it, you&apos;ll remember. In a three-person crew it&apos;s a landmine. The office honored the opt-out, but a tech who has the customer&apos;s number saved texts &quot;on my way&quot; <ArticleLink href="/blog/stop-giving-customers-your-personal-cell-number">from his personal cell</ArticleLink> the next morning. Now you have a post-revocation text and no record of why it seemed fine.</p>
          <p>The fix is structural, not a memo. All customer texting goes through one business number and one system, so the block is enforced by software instead of memory. When a STOP comes in, close the conversation with a short internal note (&quot;opted out 7/10, keep Thursday appointment, call if needed&quot;) so the next person who opens it knows the situation in five seconds.</p>
          <p>If your crew is still texting customers from a mix of personal phones, this is the strongest single argument for stopping: opt-outs simply cannot be honored reliably across four separate phones.</p>
        </ArticleSection>

        <ArticleSection id="us-vs-canada" heading="US vs Canada, briefly">
          <p>In the US, the TCPA is the hammer: $500 to $1,500 in statutory damages per violating text, and as of the 2025 FCC changes, any reasonable revocation method must be honored within 10 business days. STOP is the cleanest version, honored immediately in practice.</p>
          <p>In Canada, <ArticleLink href="/blog/casl-text-message-rules-canada">CASL</ArticleLink> governs commercial messages. It requires an unsubscribe mechanism, and consent can be implied for limited windows (roughly two years after a purchase, six months after an inquiry). Both regimes treat conversational one-to-one replies to a customer who texted you differently from marketing blasts, but neither tolerates messaging someone who has clearly said stop.</p>
          <p>Operationally, run one policy on both sides of the border: STOP means no more outbound texts until they text START, full stop.</p>
        </ArticleSection>

        <ArticleSection id="what-your-platform-should-do-automatically" heading="What your platform should do automatically">
          <p>You should not be maintaining a do-not-text list in a spreadsheet. A platform built for business texting should block the number the instant STOP arrives, keep it blocked for everyone on the team, accept START without you touching anything, and keep a record of consent so you can show when and how a conversation started.</p>
          <p>Loonext covers the core of that out of the box: STOP is honored instantly, future sends to that number are blocked, and consent (name and date) is recorded when you start a conversation. Details are on the <ArticleLink href="/features/compliance">compliance page</ArticleLink>. Whatever tool you use, verify it accepts START automatically and does the rest before you trust it with customer texting.</p>
          <p>The short version of this whole article: STOP is not an emergency, it&apos;s an instruction. Honor it, note it, keep the job, and let START come from them.</p>
          <p>This article is general information, not legal advice. If you are unsure how the rules apply to your business, talk to a lawyer.</p>
        </ArticleSection>
    </ArticlePage>
  );
}
