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

const POST = blogPost("casl-text-message-rules-canada");

export const metadata: Metadata = buildMetadata({
  title: POST.title,
  description: POST.description,
  path: blogPostPath(POST.slug),
});

export default function Page() {
  return (
    <ArticlePage post={POST}>
      <ArticleLede>
        <p>You run a plumbing outfit in Mississauga, or a salon in Halifax, and you want to text customers because nobody answers calls anymore. Then someone mentions CASL, you search for the rules, and you land on page after page written for American marketers about American laws. Almost none of it tells you what a Canadian shop texting its own customers is actually allowed to do.</p>
        <p>Here is the honest picture. CASL (Canada&apos;s Anti-Spam Legislation) is a real law with real teeth, but it was written to stop unsolicited commercial blasts, not to stop a contractor from texting a quote to someone who asked for one. For a small service business doing one-to-one texting, staying onside is mostly about a few habits, not paperwork.</p>
        <p>This guide covers what CASL requires, the difference between express and implied consent, why conversational replies barely touch the law, and how to set up your texting so you never have to think about it twice.</p>
      </ArticleLede>

        <ArticleSection id="casl-three-obligations" heading="CASL in plain English: three obligations">
          <p>CASL applies to commercial electronic messages, which the law calls CEMs. A CEM is any electronic message, texts included, that encourages participation in a commercial activity: a promotion, an offer, a nudge to book more work. If a text qualifies as a CEM, CASL asks three things of you.</p>
          <p>One, you need consent to send it, either express or implied. Two, you have to identify who is sending it. Three, you have to give the recipient a working way to unsubscribe. That is the whole framework. Everything else in this article is just those three obligations applied to real texting.</p>
          <p>Notice what is not on the list: no government registration, no filing, no fee to text Canadians. That part matters, and we will come back to it.</p>
        </ArticleSection>

        <ArticleSection id="express-vs-implied-consent" heading="Express vs implied consent, and why implied carries most service businesses">
          <p>Express consent means the person clearly agreed to receive commercial messages from you: they checked a box, signed a form, or told you in writing. It is the gold standard because it does not expire on its own.</p>
          <p>Implied consent comes from an existing business relationship, and it is where most service-business texting lives. Under CASL, buying something from you implies consent for roughly two years afterward, and making an inquiry implies consent for roughly six months. So the homeowner who called for a furnace quote last month, and the customer whose deck you built last summer, are both people you can text.</p>
          <p>The catch is that implied consent has a clock, and if a regulator ever asks, the burden of showing consent is on you. Keep a record of where each contact came from: the job, the inquiry, the date. A texting platform should do this without you thinking about it. Loonext records consent, with a name and date, whenever you start a conversation, as part of its <ArticleLink href="/features/compliance">compliance features</ArticleLink>.</p>
        </ArticleSection>

        <ArticleSection id="conversational-vs-commercial" heading="Conversational replies: when CASL barely touches you">
          <p>Here is the part the US-centric guides never explain. When a customer texts you first and you reply about their job, that is a one-to-one conversation, not a marketing blast, and both Canadian and US regimes treat it differently. Replying &quot;yes, we can be there Thursday between 9 and 11&quot; is not what CASL was built to police.</p>
          <p>The same goes for texts a customer specifically asked for: the quote they requested, the appointment confirmation, the photo of the finished work. These are transactional or responsive messages, and they are the bulk of what a plumber, cleaner, or salon actually sends.</p>
          <p>The line to watch is the message you initiate to drum up business. &quot;It&apos;s been a year since your last furnace tune-up, want to book?&quot; is a commercial message, and it deserves the full treatment: consent you can point to, identification, and an opt-out. It is usually fine to send, because that customer sits inside the two-year purchase window. Just treat it as the CEM it is.</p>
        </ArticleSection>

        <ArticleSection id="identification-and-unsubscribe" heading="Identification and unsubscribe mechanics that fit in a text">
          <p>CASL requires that a commercial message identify the sender and give a way to reach them. Opening with &quot;Hi, it&apos;s Dave from [Business name]&quot; from your consistent business number goes a long way: the customer knows who you are and can reply or call the same number.</p>
          <p>The formal identification rules ask for more than a friendly intro, though. CASL&apos;s regulations expect contact information, including a mailing address plus a phone number, email address, or web address, and CRTC guidance accepts a clearly and prominently linked page carrying that information when a text is too short to hold it all. The practical habit: keep your full contact details, mailing address included, on your website, so everything CASL wants is one link away from any promotional text you send.</p>
          <p>The unsubscribe mechanism also fits in a few words. For any promotional text you initiate, end with &quot;Text STOP to opt out.&quot; It has to be free and easy for the customer to use, and a reply keyword is both.</p>
          <p>You do not need to bolt that line onto every conversational reply. A back-and-forth about Thursday&apos;s appointment does not read as a CEM, and stuffing opt-out boilerplate into every message just makes you sound like a robot. Save it for the messages that are genuinely promotional.</p>
        </ArticleSection>

        <ArticleSection id="stop-handling-in-canada" heading="STOP means stop, starting now">
          <p>When someone texts STOP, or &quot;please stop texting me,&quot; or anything that plainly means the same thing, honor it. CASL allows a short window to process an unsubscribe, but there is no good reason to use it: the safe habit, and the respectful one, is that the very next promotional text they would have gotten never sends.</p>
          <p>This is one place where software should carry the load, because the failure mode is human: a teammate who did not see the opt-out texts the customer three weeks later. Loonext honors STOP instantly and blocks future sends to that contact automatically. For the fuller playbook, including what to do when the customer texts STOP and then texts you a question, see <ArticleLink href="/blog/customer-texted-stop-now-what">a customer texted STOP, now what</ArticleLink>.</p>
        </ArticleSection>

        <ArticleSection id="canada-vs-us-sending" heading="How Canadian sending differs from the US, and why it is faster">
          <p>In the US, carriers require businesses to register their traffic under a system called A2P 10DLC before local-number texting is delivered reliably, and they filter unregistered senders. Registration takes real time: on Loonext it means a one-time $29 fee and typically 3 to 7 business days before sending to US customers activates.</p>
          <p>Canada-to-Canada texting has no equivalent registration regime. A Canadian business texting Canadian customers on Loonext sends the same day it signs up: no registration, no fee, no waiting. If you later take on US customers, you can enable US texting and go through registration then. Details on the Canadian setup are at <ArticleLink href="/canada">Loonext for Canadian businesses</ArticleLink>, and the US timeline is covered honestly in <ArticleLink href="/blog/a2p-10dlc-registration-honest-timeline">the A2P 10DLC registration timeline</ArticleLink>.</p>
        </ArticleSection>

        <ArticleSection id="casl-safe-setup-checklist" heading="A CASL-safe setup checklist">
          <p>None of this requires a lawyer on retainer. It requires a handful of habits, set up once.</p>
          <ArticleList>
            <li>Text from one business number, not personal cells, so every message and consent record lives in one place.</li>
            <li>Open conversations you initiate with who you are: your name and the business name.</li>
            <li>Know which bucket each contact is in: they texted you first, they inquired (about 6 months), or they bought (about 2 years), and note the date.</li>
            <li>Add &quot;Text STOP to opt out&quot; to any promotional text you start.</li>
            <li>Honor STOP immediately, and make sure it stays honored across the whole crew.</li>
            <li>Do not start conversations late at night. A text at 10pm from a business reads badly even where it is legal.</li>
          </ArticleList>
          <p>A few reusable examples, worth saving as templates:</p>
          <ArticleList>
            <li>Quote follow-up: &quot;Hi [First name], it&apos;s [Your name] from [Business name]. Following up on the quote we sent Tuesday. Any questions? Text STOP to opt out.&quot;</li>
            <li>Seasonal reminder: &quot;Hi [First name], [Business name] here. It&apos;s been about a year since your last furnace tune-up. Want us to book you in? Text STOP to opt out.&quot;</li>
            <li>Reply to an inbound text: &quot;Yes, we can be there Thursday between 9 and 11. Reply here to confirm. [Your name], [Business name].&quot;</li>
          </ArticleList>
        </ArticleSection>

        <ArticleSection id="what-gets-businesses-in-trouble" heading="What actually gets small businesses in trouble">
          <p>Publicly reported CASL enforcement, as of mid-2026, has focused on mass senders: bought contact lists, promotional blasts to people with no business relationship, ignored unsubscribe requests. It has not, so far as public cases show, targeted the landscaper who texted a customer about Thursday&apos;s visit. Penalties for businesses can run into the millions, so the ceiling is high even if the typical target is not a three-person crew.</p>
          <p>The good news is that the safe zone is exactly where a service business naturally operates: real customers, one conversation at a time, about their own jobs. Keep your records, identify yourself, honor STOP, and let your texting platform enforce the boring parts automatically.</p>
          <p>This article is general information, not legal advice. If you are unsure how the rules apply to your business, talk to a lawyer.</p>
        </ArticleSection>
    </ArticlePage>
  );
}
