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

const POST = blogPost("a2p-10dlc-registration-honest-timeline");

export const metadata: Metadata = buildMetadata({
  title: POST.title,
  description: POST.description,
  path: blogPostPath(POST.slug),
});

export default function Page() {
  return (
    <ArticlePage post={POST}>
      <ArticleLede>
        <p>You signed up for a business texting service, picked out a local number, and hit a wall: a notice that says something like &quot;pending carrier registration.&quot; You have quotes to send and customers waiting, and nobody told you about this step before you pulled out your card.</p>
        <p>That step is A2P 10DLC registration, and it applies to pretty much every US business that texts customers from a local number, whether you&apos;re a two-truck plumbing outfit or a six-chair salon. It is not your provider stalling and it is not a scam. It&apos;s the US carriers checking that a real business is behind the number before they let your texts through.</p>
        <p>Here&apos;s the honest version of what it is, how long it actually takes, what it costs, and what you can get done while you wait.</p>
      </ArticleLede>

        <ArticleSection id="why-you-cant-just-text" heading="Why you can&apos;t just buy a number and start texting anymore">
          <p>A few years ago you could buy a local number online and start texting customers the same afternoon. Spammers did exactly that, at industrial scale, and the US carriers responded with a crackdown: any business texting from software now has to register who they are and what they send.</p>
          <p>The enforcement is real. Carriers filter unregistered application-to-person (A2P) traffic, which means texts from an unregistered business number can be delayed or silently dropped. Your platform says &quot;sent,&quot; your customer never sees it, and you&apos;re left wondering why nobody confirmed the appointment.</p>
          <p>There are three main types of business texting numbers: short codes, toll-free numbers, and local 10 digit numbers (that&apos;s the &quot;10DLC&quot;, ten digit long code). For a local service business that wants to look local, 10DLC is almost always the right lane, and it&apos;s the one this registration covers. If you&apos;re still choosing a number, start with <ArticleLink href="/features/business-number">how business numbers work</ArticleLink>.</p>
        </ArticleSection>

        <ArticleSection id="what-registration-actually-is" heading="What registration actually is: your identity and your use case, reviewed">
          <p>Registration has two parts. First, your business identity: legal business name, address, and tax ID, checked against public records to confirm you&apos;re a real company. Second, your use case: a short description of what you&apos;ll text about, usually with a sample message or two.</p>
          <p>Both parts get reviewed before US carriers will deliver your outbound texts at full trust. This is an industry-wide requirement, not something any one platform invented, so switching providers doesn&apos;t let you skip it.</p>
          <p>One thing worth knowing up front: this is a US carrier requirement. A Canadian business texting Canadian customers doesn&apos;t go through it at all. More on that below.</p>
        </ArticleSection>

        <ArticleSection id="the-honest-timeline" heading="The honest timeline: receiving works day one, sending takes about a week">
          <p>Here&apos;s the part most sales pages bury. The day you sign up, your number is live and receiving. Customers can text it, and those messages land in your inbox immediately. What waits on approval is sending to US customers.</p>
          <p>Approval typically takes 3 to 7 business days. Call it about a week. Some registrations clear faster, some take longer, and no provider controls the review queue, so plan around the full week rather than the best case. Be skeptical of any pitch that promises same-day US sending from a fresh local number: nobody gets to skip that queue.</p>
          <p>The Canadian exception is genuinely different: a Canadian business texting Canadian customers can send the same day it signs up, with no registration, no fee, and no waiting for CA-to-CA traffic. If that&apos;s you, see <ArticleLink href="/canada">Loonext for Canadian businesses</ArticleLink>.</p>
        </ArticleSection>

        <ArticleSection id="what-reviewers-check" heading="What reviewers check, and the mistakes that get small businesses rejected">
          <p>Rejections are usually less dramatic than they sound. The mistakes to avoid are paperwork mismatches and vague wording, and they look like this:</p>
          <ArticleList>
            <li>Legal name mismatch: you register as &quot;Mike&apos;s Plumbing&quot; but your tax records say &quot;MJP Services LLC.&quot; Use the exact legal name on your tax paperwork, not your sign or your DBA.</li>
            <li>Wrong or mistyped tax ID: an EIN that doesn&apos;t match the legal name is an automatic problem.</li>
            <li>A vague use case: &quot;customer communication&quot; or &quot;business texting&quot; tells the reviewer nothing. Say what you actually send: appointment confirmations, quotes, job updates, replies to inbound questions.</li>
            <li>Sample messages that read like marketing blasts when your stated use case is customer service. Keep the samples honest and conversational.</li>
          </ArticleList>
          <p>A plain, specific use-case description gives the reviewer what they need, something like: &quot;We text existing customers about appointments, estimates, and job status. Example: &apos;Hi [First name], it&apos;s [Your name] from [Business name]. Your estimate is ready, want me to text it over?&apos;&quot;</p>
        </ArticleSection>

        <ArticleSection id="while-you-wait" heading="What you can and cannot do while you wait">
          <p>You cannot send texts to US customers until approval lands. You can do almost everything else, and the week goes by faster if you use it.</p>
          <ArticleList>
            <li>Put the new number on your website, Google Business Profile, invoices, and voicemail greeting. Receiving works day one, so inbound texts start landing right away.</li>
            <li>Import your contacts so names show up when customers text in.</li>
            <li>Write your saved replies now: the quote follow-up, the &quot;on my way&quot; message, the job-complete wrap-up. You&apos;ll send them the hour you&apos;re approved.</li>
            <li>Agree with your crew on how you&apos;ll use statuses and tags so conversations don&apos;t fall through the cracks.</li>
          </ArticleList>
          <p>If you&apos;re switching platforms or moving an existing number, sequence it so you&apos;re never dark: get registration filed on the new platform before you cancel the old one, and remember number porting is its own separate timeline. Here&apos;s <ArticleLink href="/blog/port-business-number-without-going-dark">how to port a business number without going dark</ArticleLink>.</p>
        </ArticleSection>

        <ArticleSection id="what-it-costs" heading="What registration costs, itemized honestly">
          <p>How registration shows up on your bill varies by platform, so read the order page carefully before you buy: some fold it into the subscription, some pass through carrier fees as separate line items.</p>
          <p>Loonext keeps it to one line: a one-time $29 registration fee, charged once ever, for US businesses (and Canadian businesses that turn on US texting). So a US shop on the Starter plan pays $58 the first month, then $29 a month after that. Canadian businesses texting only Canadian customers pay no registration fee at all. Full details are on the <ArticleLink href="/pricing">pricing page</ArticleLink>.</p>
          <p>The 30-day money-back guarantee covers the registration fee too: if you refund your first invoice, the $29 comes back with it. You&apos;re not gambling the fee on whether the product fits.</p>
        </ArticleSection>

        <ArticleSection id="how-loonext-handles-it" heading="How Loonext handles the filing, and what it can&apos;t speed up">
          <p>Loonext files your registration automatically the minute you pay and emails you the moment the carriers approve you. There&apos;s nothing extra to file yourself. Your number receives from day one, and US sending activates once carrier approval lands.</p>
          <p>What Loonext can&apos;t do is jump the carrier review queue. Nobody can. The honest promise is filing immediately, telling you the truth about the wait, and turning sending on as soon as you clear.</p>
          <p>If you&apos;re planning a launch, book the math backwards: sign up about a week before you need to send your first US text, spend the wait setting up your inbox, and you&apos;ll hit the ground with a number that&apos;s already been receiving customer texts for days.</p>
        </ArticleSection>
    </ArticlePage>
  );
}
