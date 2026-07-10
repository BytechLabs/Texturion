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

const POST = blogPost("real-cost-of-business-texting");

export const metadata: Metadata = buildMetadata({
  title: POST.title,
  description: POST.description,
  path: blogPostPath(POST.slug),
});

export default function Page() {
  return (
    <ArticlePage post={POST}>
      <ArticleLede>
        <p>You searched &quot;business texting pricing,&quot; opened five tabs, and every one of them says something like &quot;from $15 per user per month&quot; with an asterisk. The asterisk is where the real bill lives. Number fees, carrier fees, registration fees, overage fees: none of them show up on the pricing page headline, and all of them show up on your invoice.</p>
        <p>If you run a small service business, your situation is probably simple. You have somewhere between three and ten people, you want one business number, and you want customer texts answered by whoever is free. You did not sign up to learn telecom billing. But if you pick a platform without understanding the fee anatomy, you will pay for that education one line item at a time.</p>
        <p>This article itemizes every cost you can hit, in plain language. Where I use concrete dollar amounts for a platform, they are Loonext&apos;s published prices, because those are the ones I can vouch for. Competitor pricing is described by structure, not by number, because vendor prices change and you should check the current page anyway.</p>
      </ArticleLede>

        <ArticleSection id="the-five-layers-of-cost" heading="The five layers of cost.">
          <p>Almost every business texting bill is built from the same five layers. Once you can name them, no pricing page can surprise you.</p>
          <p>Layer one is the platform fee: the base software subscription. Layer two is seats: many vendors charge that base fee per user, so the price scales with headcount. Layer three is numbers: some platforms include one phone number and charge monthly for each additional one. Layer four is carrier passthrough: per-message fees and surcharges that carriers charge platforms, which some platforms pass on to you as separate line items. Layer five is registration: the one-time (and sometimes recurring) fees around US carrier registration, which every legitimate platform has to deal with one way or another.</p>
          <p>A pricing page that only shows layer one is not lying, exactly. It is just showing you the smallest number in the stack. Your job when comparison shopping is to get a written answer on all five.</p>
        </ArticleSection>

        <ArticleSection id="the-per-seat-trap" heading="The per-seat trap.">
          <p>&quot;From $15 per user per month&quot; sounds cheap because you read it as $15. But you do not have one user. Run the arithmetic for a six-person crew: 6 people times $15 is $90 a month, which is $1,080 a year, before numbers, carrier fees, or registration. Hire a seventh tech in the spring and the bill quietly steps up again.</p>
          <p>Per-seat pricing also creates a bad incentive: you start rationing logins. The new apprentice shares the office manager&apos;s account, nobody knows who replied to the customer, and you have recreated the exact confusion you were paying to fix. For a texting inbox, everyone on the crew needs to be in it, or it does not work.</p>
          <p>Loonext charges flat per company instead: $29 a month covers 3 teammates, $79 covers 15, and the bill never steps up per hire; the price only changes if you outgrow your plan&apos;s teammate count. Full details are on the <ArticleLink href="/pricing">pricing page</ArticleLink>. Whatever platform you pick, insist on knowing the total for your actual headcount, not the starting price.</p>
        </ArticleSection>

        <ArticleSection id="one-time-costs-nobody-mentions" heading="One-time costs nobody mentions.">
          <p>US carrier registration (called A2P 10DLC) is the big one. US carriers filter business traffic from unregistered numbers, so any platform sending texts for a US business has to register you. Some platforms bury the fee, some pass it through as separate registration and campaign line items, and some leave you to figure out the forms yourself. Ask exactly what you will pay and who files the paperwork.</p>
          <p>Loonext files it automatically the minute you pay, for a one-time $29 fee, charged once ever. The <ArticleLink href="/blog/a2p-10dlc-registration-honest-timeline">honest registration timeline</ArticleLink> covers what happens while you wait for carrier approval, typically 3 to 7 business days.</p>
          <p>Verification is a related cost on some setups: toll-free numbers, for example, generally go through their own verification process, and vendors handle and charge for it differently. If a vendor pushes you toward a toll-free number, ask what verification costs and how long it takes.</p>
          <p>Porting is the third one-timer. If you already have a business number you want to keep, some vendors charge a porting fee or make you email support to start it. Porting a US or Canadian local number to Loonext is free and self-serve, and your number keeps working on the old carrier until the scheduled cutover, so you <ArticleLink href="/blog/port-business-number-without-going-dark">never go dark mid-transfer</ArticleLink>.</p>
        </ArticleSection>

        <ArticleSection id="unlimited-texting-is-not" heading="&quot;Unlimited&quot; texting is not.">
          <p>Every platform that says &quot;unlimited&quot; has a paragraph somewhere that walks it back, because carriers charge platforms per message and no business can absorb genuinely unlimited sending. The walk-back takes a few shapes: a hard cap where sending just stops, silent throttling, an automatic overage charge at a rate you have to hunt for, or a fair-use policy.</p>
          <p>None of these are scandalous. The scandal is when the policy is vague, the overage rate is unpublished, and the first you hear about it is the invoice. Before you sign up anywhere, find the actual included-usage numbers in writing. If you cannot find them, that is your answer.</p>
          <p>Loonext&apos;s version: texting is included under an automated fair-use policy, not a hard cap. If a month runs hot, extra texts bill at a small per-text rate, but only up to a spending cap you control, with email alerts at 80% and 100% first. Receiving texts and photos is always free and unlimited, sending photos is included on every plan, and storage is free with no caps. The concrete numbers are published at <ArticleLink href="/legal/fair-use">the fair-use policy</ArticleLink>, which is exactly where you should expect any honest vendor to keep theirs.</p>
        </ArticleSection>

        <ArticleSection id="what-contact-us-pricing-means" heading="What &quot;contact us&quot; pricing usually means.">
          <p>A contact-sales tier is not automatically a ripoff. It usually means the price depends on volume, the vendor wants an annual contract, and the number is negotiable. For a big operation that can be fine. For a five-person shop, it mostly means a sales call, a quote you cannot compare in a browser tab, and a renewal conversation every year.</p>
          <p>If you do get on that call, ask these and get the answers in writing:</p>
          <ArticleList>
            <li>What is the all-in monthly total for my exact headcount, including numbers and carrier fees?</li>
            <li>What one-time fees will appear on my first invoice: registration, verification, setup, porting?</li>
            <li>What happens when I go over the included message volume, and at what per-message rate?</li>
            <li>Is this month to month, or am I signing an annual contract? What does cancelling cost?</li>
            <li>If I leave, can I port my number out, and is there a fee for that?</li>
          </ArticleList>
          <p>A vendor that answers all five quickly is probably fine. A vendor that gets fuzzy on question two or three is telling you where the margin lives.</p>
        </ArticleSection>

        <ArticleSection id="a-realistic-monthly-bill" heading="A realistic monthly bill for a 3-person and a 10-person shop.">
          <p>Here is what flat pricing looks like in practice, using Loonext&apos;s numbers since they are published and I can state them exactly. A 3-person US shop pays $58 the first month ($29 for Starter plus the one-time $29 registration fee) and $29 a month after that, with 1 local number included. A 10-person US shop on Pro pays $108 the first month and $79 after, with 15 teammate slots and 2 numbers, so there is room to hire without touching the bill. Billing is in USD, month to month, with a 30-day money-back guarantee that refunds the full first invoice, registration fee included.</p>
          <p>A Canadian business texting Canadian customers skips registration entirely: no fee, no waiting, sending works the same day you sign up. So the Canadian versions of those bills are just $29 and $79 flat from month one.</p>
          <p>Now hold that against the per-seat structure. Ten people at a hypothetical $15 per seat is $150 a month before any of the other four layers, roughly double a flat $79, and the gap widens with every hire. Per-seat pricing is a fine deal for a solo operator. It is a tax on growth for a crew.</p>
        </ArticleSection>

        <ArticleSection id="when-cheap-is-expensive" heading="When cheap is expensive.">
          <p>The bottom of the market is free or nearly free: texting from a personal cell, a bare virtual number app, a group text with the crew. The sticker price is unbeatable. What you give up is invisible until it costs you.</p>
          <p>Deliverability is the first casualty. US carriers filter unregistered business traffic, so a cheap unregistered setup can silently drop your quotes and confirmations. Compliance is the second: TCPA statutory damages run $500 to $1,500 per violating text, so a tool with no STOP handling and no consent records is a liability wearing a low price tag. And coordination is the third: with a group text or forwarding chain, two people answer the same customer or nobody does. The <ArticleLink href="/blog/shared-inbox-vs-group-text-vs-forwarding">shared inbox vs group text vs forwarding</ArticleLink> comparison walks through that failure mode in detail.</p>
          <p>One missed job usually outweighs a year of the price difference between the cheapest option and a proper one. Cheap is only cheap if it works.</p>
        </ArticleSection>

        <ArticleSection id="comparison-shop-in-20-minutes" heading="How to comparison-shop in 20 minutes.">
          <p>You do not need a spreadsheet weekend. For each vendor on your shortlist, spend five minutes finding written answers to one checklist:</p>
          <ArticleList>
            <li>Total monthly price for your real headcount, not the &quot;from&quot; price.</li>
            <li>How many phone numbers are included, and the monthly cost of extras.</li>
            <li>Every one-time fee on the first invoice: registration, verification, setup, porting.</li>
            <li>The included-usage policy in writing, with the actual numbers and the overage rate.</li>
            <li>Contract terms: month to month or annual, and the cost of leaving, including porting your number out.</li>
            <li>Compliance basics included: automatic STOP handling, consent records, quiet-hours awareness.</li>
          </ArticleList>
          <p>Any vendor that makes all six easy to find is treating you like an adult. If you have to open a chat widget to learn what your own bill will be, believe what that tells you and move on to the next tab.</p>
          <p>That is the whole anatomy: platform, seats, numbers, carrier passthrough, registration, plus the fine print on &quot;unlimited.&quot; Price the stack, not the headline, and the right choice for your crew usually becomes obvious in one sitting.</p>
        </ArticleSection>
    </ArticlePage>
  );
}
