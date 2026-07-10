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

const POST = blogPost("stop-giving-customers-your-personal-cell-number");

export const metadata: Metadata = buildMetadata({
  title: POST.title,
  description: POST.description,
  path: blogPostPath(POST.slug),
});

export default function Page() {
  return (
    <ArticlePage post={POST}>
      <ArticleLede>
        <p>It&apos;s 9:04 on a Saturday night and your phone buzzes on the couch arm. It&apos;s not your brother. It&apos;s a customer asking if you can squeeze them in Monday, and now you&apos;re standing in the kitchen typing an estimate with your thumb while your family watches the movie without you.</p>
        <p>If you run a trades or service business, you probably never decided to make your personal cell the company line. It just happened. You gave your number to your first customer back when you were the whole company, and years later that same number is on your truck, your invoices, and a few hundred fridge magnets.</p>
        <p>The good news: you can move customers to a real business number without losing a single one, and without carrying a second phone. Here&apos;s the plan, including the exact texts to send.</p>
      </ArticleLede>

        <ArticleSection id="how-your-cell-became-the-business-line" heading="How your personal cell became the business line.">
          <p>Nobody chooses this. The number spreads one job at a time: you text a customer a quote, they save you as &quot;Mike Plumber,&quot; they pass your number to their neighbor, and the neighbor passes it to theirs. Every referral makes the number more valuable to the business and more expensive to your evenings.</p>
          <p>By the time you hire your first helper, the number is load bearing. Customers don&apos;t text the company. They text you. And that&apos;s exactly the problem.</p>
        </ArticleSection>

        <ArticleSection id="what-it-actually-costs-you" heading="What it actually costs you.">
          <p>You&apos;re always on call. There&apos;s no such thing as closed when the business line lives in your pocket next to your family photos. Every buzz could be a $4,000 job or a guy asking if you price match, and you have to look either way.</p>
          <p>There&apos;s no handoff. When you&apos;re on a roof, under a sink, or finally on vacation, nobody else can answer the texts sitting on your phone. Messages wait for hours, and the customer calls the next name on Google.</p>
          <p>The history is trapped on one device. Quotes, addresses, gate codes, photos of the panel: all of it lives in one thread on one phone. If that phone dies or goes in a lake, so does the record.</p>
          <p>And if you&apos;ve been running the business off an employee&apos;s cell instead, it&apos;s worse. When they leave, the number, the customer relationships, and every conversation walk out the door with them.</p>
        </ArticleSection>

        <ArticleSection id="why-a-second-phone-does-not-fix-it" heading="Why a second phone or dual SIM doesn&apos;t fix it.">
          <p>The usual fix is a second phone or a dual SIM &quot;work number.&quot; That solves exactly one problem (your personal number stays private) and leaves the rest untouched. It still rings one person. The history still lives on one device. Nobody can hand off a conversation, and you&apos;re now charging two phones.</p>
          <p>Group texting the crew doesn&apos;t fix it either. Every customer message turns into a reply-all pile, nobody knows who owns it, and two people quote the same job differently. If you&apos;re weighing those options seriously, we compared them in <ArticleLink href="/blog/shared-inbox-vs-group-text-vs-forwarding">shared inbox vs group text vs forwarding</ArticleLink>.</p>
        </ArticleSection>

        <ArticleSection id="the-fix-one-number-the-whole-crew-answers" heading="The fix: one business number the whole crew answers.">
          <p>What actually works is a local business number that opens into a shared inbox. Every text to that number lands in one place, visible from any phone, and anyone on the crew can answer, claim the conversation, or leave an internal note the customer never sees.</p>
          <p>That gets you the things a phone number alone can&apos;t. Each conversation has an owner and a status, so &quot;did anyone get back to the deck guy&quot; has an answer. And the history belongs to the business, not to whoever&apos;s phone it happened to land on.</p>
          <p>This is the exact problem Loonext was built for: one local number, one <ArticleLink href="/features/shared-inbox">shared inbox</ArticleLink> the whole crew opens from any phone, flat price per company, nothing to install. That&apos;s the pitch. Now back to the migration.</p>
        </ArticleSection>

        <ArticleSection id="how-to-migrate-customers-off-your-cell" heading="How to move customers over without losing anyone.">
          <p>You don&apos;t need everyone to switch on day one. You need the new number working, a short announcement, and a transition period where your old cell politely redirects. Here&apos;s the sequence:</p>
          <ArticleList>
            <li>Get the new number live and make sure the whole crew can answer it before you tell a single customer.</li>
            <li>Text your active customers from the new number itself, so the announcement comes from the number you want them to save.</li>
            <li>Update everywhere the old number lives: website, Google Business Profile, invoices, email signature, and the truck lettering next time it&apos;s due anyway.</li>
            <li>Change your personal voicemail so business callers get redirected.</li>
            <li>Keep redirecting texts from your cell for 60 to 90 days, then stop giving the old number out entirely.</li>
          </ArticleList>
          <p>Copy and adapt these three templates. Keep them short and personal; they should sound like you, not like a bank.</p>
          <ArticleList>
            <li>Announcement text: &quot;Hi [First name], it&apos;s [Your name] from [Business name]. We&apos;ve set up a proper business line so you can always reach someone, not just me: [new number]. Save it, and text it exactly like you&apos;d text me. Photos work too.&quot;</li>
            <li>Reply from your old cell during the transition: &quot;Got your message! [Business name] texts now go to [new number] so the whole team can jump on it. Sending this over there now, someone will get back to you right away.&quot;</li>
            <li>Personal voicemail script: &quot;You&apos;ve reached [Your name]. If you&apos;re calling about [Business name], call or text [new number] and the team will take care of you. Otherwise, leave a message.&quot;</li>
          </ArticleList>
          <p>One habit worth keeping: send the announcement during business hours. A late-night text from a number the customer hasn&apos;t saved yet reads as spam and gets deleted.</p>
        </ArticleSection>

        <ArticleSection id="customers-who-still-text-your-old-number" heading="The customers who still text your old number.">
          <p>Some customers will text your cell for years, because that&apos;s what&apos;s saved in their phone, and that&apos;s fine. The redirect reply above takes ten seconds, and every time you send it, one more contact gets updated. Don&apos;t ghost the old number; the goal is fewer business texts on your cell, not lost jobs.</p>
          <p>If most of your business already lives on your personal number, there&apos;s a bigger lever: port it. A standard US or Canadian local number can usually be transferred to a business texting service. It keeps working on the old carrier during the move and switches on a scheduled cutover date, typically 1 to 7 business days. Then your old number becomes the business line and you get a fresh personal cell instead. Details in <ArticleLink href="/blog/port-business-number-without-going-dark">how to port your business number without going dark</ArticleLink>.</p>
        </ArticleSection>

        <ArticleSection id="what-it-costs-and-how-fast" heading="What it costs and how fast you can switch.">
          <p>Real numbers, because that&apos;s what you&apos;d ask a buddy. Loonext&apos;s Starter plan is $29 a month for the whole company, up to 3 teammates on one local number, flat, never per seat. US businesses also pay a one-time $29 carrier registration fee, so the first month is $58 and then it&apos;s $29. Full details on <ArticleLink href="/pricing">pricing</ArticleLink>.</p>
          <p>The timing is the part most providers gloss over. US carriers filter unregistered business texting, so Loonext files your A2P 10DLC registration automatically the minute you pay. Your number is live and receiving from day one, but sending to US customers activates after carrier approval, typically 3 to 7 business days, and you get an email the moment you&apos;re approved. Plan the announcement text for week two. The full story is in our <ArticleLink href="/blog/a2p-10dlc-registration-honest-timeline">honest A2P registration timeline</ArticleLink>.</p>
          <p>Canada is simpler: a Canadian business texting Canadian customers can send the same day it signs up, with no registration and no fee. Either way it&apos;s month to month with a 30-day money-back guarantee, registration fee included, so the worst case is you tried it and got your money back.</p>
        </ArticleSection>

        <ArticleSection id="faq" heading="Common questions.">
          <p>Does my personal number stay private? Yes. Customers only ever see the business number. Your cell just becomes one of the phones that opens the inbox, and nothing you send from it shows your personal number.</p>
          <p>What if two of us try to answer at once? Every conversation has an owner and a status (new, open, waiting, closed), so the crew can see who has it before anyone starts typing. Internal notes let you hand off the context without the customer ever seeing the back and forth.</p>
          <p>Can customers still text photos of the job site? Yes, and it matters more than people think. Receiving texts and photos is free and unlimited, and sending photos is included on every plan, so &quot;send me a picture of the panel&quot; works exactly like it did on your cell, except now the whole crew can see it.</p>
        </ArticleSection>
    </ArticlePage>
  );
}
