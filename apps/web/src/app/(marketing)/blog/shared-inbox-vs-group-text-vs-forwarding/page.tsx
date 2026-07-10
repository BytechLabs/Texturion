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

const POST = blogPost("shared-inbox-vs-group-text-vs-forwarding");

export const metadata: Metadata = buildMetadata({
  title: POST.title,
  description: POST.description,
  path: blogPostPath(POST.slug),
});

export default function Page() {
  return (
    <ArticlePage post={POST}>
      <ArticleLede>
        <p>Somewhere between hire number two and hire number five, every service business hits the same wall. Customers text one number: the one on the trucks, the website, and the invoices. But those texts land on exactly one phone, and whoever holds that phone becomes a human switchboard.</p>
        <p>So you improvise. Maybe the owner screenshots customer texts into the crew group chat and relays answers back. Maybe every message forwards to three phones and whoever is fastest replies. It works, sort of, until two people quote the same job at different prices, or nobody replies because everyone assumed someone else had it.</p>
        <p>This guide walks through the five workarounds small crews actually use, exactly where each one falls over, and what a shared inbox does differently. None of the workarounds are dumb. They are free and they buy you time. The trick is knowing when you have outgrown them.</p>
      </ArticleLede>

        <ArticleSection id="five-hacks-crews-try-first" heading="The five hacks every small crew tries first.">
          <p>If you run a 3 to 8 person crew, you have probably tried at least two of these. They all answer the same question: how can my team share one phone number for texting without paying for anything new?</p>
          <ArticleList>
            <li>The group thread. Customers text the owner&apos;s phone, the owner screenshots messages into the crew chat, and answers flow back through the owner.</li>
            <li>Forward everything. Texts and calls to the business number get pushed to two or three personal cells, and whoever grabs one first handles it.</li>
            <li>Pass the shop phone. One physical phone holds the business number, and whoever is on call takes it home.</li>
            <li>The shared login. One free texting or VoIP account, one password, everyone signs in as the same user.</li>
            <li>The free second-number app. A free VoIP number on the owner&apos;s phone, with the owner relaying everything by hand.</li>
          </ArticleList>
          <p>Each of these genuinely works for a while. A two-person shop can run on a group thread for years. The problems start when volume grows, people rotate, and one missed message finally costs you a real job.</p>
        </ArticleSection>

        <ArticleSection id="where-each-one-breaks" heading="Where each one breaks.">
          <p>The group thread has one fatal flaw: the customer&apos;s actual conversation lives on one phone. Everyone else sees screenshots. If the owner is on a ladder, at the bank, or on vacation, replies stop. And the relay adds lag in both directions, which customers read as being ignored.</p>
          <p>Forwarding creates the opposite problem: too many repliers. Two techs answer the same customer within a minute of each other, sometimes with different prices. Worse, replies go out from personal cells, so the customer now has three numbers for your business and starts texting a tech directly. That is how you end up <ArticleLink href="/blog/stop-giving-customers-your-personal-cell-number">giving customers your personal cell number</ArticleLink> without ever deciding to.</p>
          <p>The shop phone is a single point of failure that lives in a truck, a crawl space, or a back pocket near a full bathtub. The shared login is quieter but nastier: you cannot tell who said what, some apps fight simultaneous sign-ins, and when someone quits you have to rotate a password half the crew has saved.</p>
          <p>And every one of these hacks shares the worst failure mode: when a tech leaves, the conversation history leaves with them. Months of quotes, addresses, and promises, sitting on a personal phone you no longer control.</p>
        </ArticleSection>

        <ArticleSection id="what-a-shared-inbox-is" heading="What a shared inbox actually is.">
          <p>A shared inbox flips the model. Instead of copying messages between phones, every text to your business number lands in one place, and everyone on the crew opens that same place from their own phone. Replies go out from the business number, no matter who typed them.</p>
          <p>The customer experience does not change at all. They text the number on the truck and get an answer. They never know, and never need to know, whether the owner or the newest hire replied.</p>
          <p>The business gets the part the hacks can never deliver: the history belongs to the company. When a tech moves on, every conversation they handled stays in the inbox, readable by whoever takes over.</p>
        </ArticleSection>

        <ArticleSection id="features-that-matter" heading="The features a 3 to 8 person crew actually needs.">
          <p>Team texting tools love long feature lists. For a small crew, most of it is noise. What you use every day is small and boring: a way to see who owns each conversation so two people never reply to the same customer, statuses like open and waiting and closed so nothing rots unanswered, and internal notes so &quot;told him $450, he&apos;s thinking about it&quot; lives next to the thread instead of in someone&apos;s head.</p>
          <p>Add saved replies for the ten messages you type every week, search that covers every message you have ever sent or received, and an after-hours auto-reply so a 10pm text gets acknowledged. That is the whole list.</p>
          <p>You can skip the enterprise tier. Chatbots, drip campaign builders, SLA dashboards, round-robin routing rules, and CRM integrations were built for 50-agent support desks, not a plumbing crew. Loonext&apos;s <ArticleLink href="/features/shared-inbox">shared inbox</ArticleLink> covers the short list above. There is no campaign builder or blast tooling, on purpose.</p>
        </ArticleSection>

        <ArticleSection id="per-seat-pricing-trap" heading="The pricing trap: per-seat billing punishes you for hiring.">
          <p>A lot of business texting tools charge per user, per month. That sounds fair until you notice what it does to a small crew: adding your new apprentice to the inbox has a monthly price tag, so owners quietly leave half the crew out. Then the left-out half is back to screenshots, and you are paying for software plus keeping the old hack.</p>
          <p>Flat pricing changes the decision. Loonext charges per company, not per seat: <ArticleLink href="/pricing">$29 a month</ArticleLink> covers a crew of 3 on one local number, and $79 covers up to 15 people, month to month with a 30-day money-back guarantee. Whatever tool you pick, run the math at the crew size you will be next year, not the one you are today.</p>
        </ArticleSection>

        <ArticleSection id="one-emergency-two-ways" heading="The same after-hours emergency, handled two ways.">
          <p>It is 9:40 on a Friday night and a customer texts the business number: &quot;Water heater is leaking through the ceiling. Can anyone come tonight?&quot;</p>
          <p>On the group-thread system, that message sits on the owner&apos;s phone, which is face down at a restaurant. At 10:25 the owner sees it, screenshots it into the crew chat, and asks who is closest. The on-call tech answers in the chat, the owner relays it to the customer, and every follow-up question makes the same round trip. The customer, meanwhile, texted two other plumbers at 9:55.</p>
          <p>On a shared inbox, the after-hours auto-reply answers automatically, in your own words: &quot;Thanks for reaching out to [Business name]. We&apos;re closed until 8am, but if this is urgent, reply URGENT and our on-call tech will get back to you tonight.&quot; The on-call tech gets the notification, opens the inbox on his own phone, takes the conversation, and replies from the business number. In the morning the whole exchange is right there for whoever runs dispatch.</p>
          <p>Same crew, same emergency, same number. The difference is 45 minutes and, some nights, the job itself.</p>
        </ArticleSection>

        <ArticleSection id="switching-without-confusing-customers" heading="Switching without confusing customers.">
          <p>The good news about moving to a shared inbox: your customers do not have to learn anything. The number on the trucks stays the number on the trucks. Porting a US or Canadian local number into Loonext is free and self-serve, the number keeps working on your old carrier during the transfer, and the switch happens on a scheduled cutover date, typically 1 to 7 business days. The <ArticleLink href="/blog/port-business-number-without-going-dark">porting walkthrough</ArticleLink> covers the whole process step by step.</p>
          <p>If your main number is a landline, you may not need to port at all. Landlines can often be text-enabled so they keep taking calls exactly as before and start receiving texts too; the <ArticleLink href="/blog/text-enable-your-business-landline">text-enabling guide</ArticleLink> covers when that beats porting.</p>
          <p>One honest caveat for US businesses: carriers require A2P 10DLC registration before a business number can send texts reliably. Expect receiving to work on day one and sending to US customers to activate after carrier approval, typically 3 to 7 business days. Canadian businesses texting Canadian customers skip registration entirely and can send the same day they sign up.</p>
          <p>However you get there, the goal is simple: one number the customer already knows, and a whole crew who can answer it.</p>
        </ArticleSection>
    </ArticlePage>
  );
}
