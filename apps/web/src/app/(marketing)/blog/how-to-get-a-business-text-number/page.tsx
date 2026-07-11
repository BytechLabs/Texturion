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

const POST = blogPost("how-to-get-a-business-text-number");

export const metadata: Metadata = buildMetadata({
  title: POST.title,
  description: POST.description,
  path: blogPostPath(POST.slug),
});

export default function Page() {
  return (
    <ArticlePage post={POST}>
      <ArticleLede>
        <p>Your business already runs on texts. Customers send photos of the leak to your personal cell, your lead tech has a separate thread going with the same customer, and the quote somebody promised on Tuesday is sitting unread on a phone in a truck.</p>
        <p>What you want is simple: one local number customers can text, that the whole crew can see and answer from any phone. Getting one is cheap and fast. But there are details the signup pages skip: US carrier registration adds about a week before you can send, per-seat pricing quietly multiplies the bill, and a number wired to one person&apos;s phone just recreates the personal-cell problem with extra steps.</p>
        <p>Here&apos;s the whole picture: which kind of number to get, whether to keep the one you already have, what it really costs, and what to set up on day one.</p>
      </ArticleLede>

        <ArticleSection id="three-kinds-of-numbers" heading="The three kinds of business text numbers.">
          <p>A business can text from three types of numbers: short codes, toll-free numbers, and local ten-digit numbers. The industry calls that last one 10DLC, for &quot;10-digit long code&quot;.</p>
          <p>Short codes are the five or six digit numbers airlines and banks blast from. They cost a fortune and customers can&apos;t call them back. Toll-free numbers (800, 888, and friends) can text, but they read as a call center, not the plumber down the road.</p>
          <p>For a small service business, local wins. Customers recognize the area code, they can call it, and a reply feels like texting a person instead of a system. One thing is true for all three: carriers filter business traffic that isn&apos;t registered, so whichever route you take, registration matters. More on that below.</p>
        </ArticleSection>

        <ArticleSection id="new-port-or-text-enable" heading="Decision 1: new number, text-enable your landline, or port what you have.">
          <p>You have three paths, and the right one depends on what your current number means to your customers.</p>
          <ArticleList>
            <li>Get a new local number. The fastest path: pick a number in your area code and it&apos;s live and receiving the same day (US sending waits on registration, covered below). Right choice if you&apos;ve been running the business off a personal cell you want to reclaim.</li>
            <li>Text-enable the landline you already have. Your business line keeps ringing exactly where it rings today, and texting gets added on top, so customers text the number they already know. Here&apos;s <ArticleLink href="/blog/text-enable-your-business-landline">how text-enabling a landline works</ArticleLink>.</li>
            <li>Port your number. Move it entirely to the texting provider. It keeps working on the old carrier during the transfer and switches on a scheduled cutover date, typically 1 to 7 business days, so it never goes dark along the way.</li>
          </ArticleList>
          <p>Simple rule: if your number is on ten years of fridge magnets and truck wraps, keep it (text-enable or port). If it&apos;s your personal cell, get a fresh number and start giving that one out instead.</p>
        </ArticleSection>

        <ArticleSection id="who-answers-it" heading="Decision 2: who needs to answer it.">
          <p>This is the question most owners skip, and it&apos;s the one that decides whether the number actually helps. A business number only one phone can answer is your personal cell with a different area code. You&apos;re still the bottleneck, and when you&apos;re under a sink, nobody answers.</p>
          <p>So decide up front: does the whole crew need to see and answer these texts? For most shops with more than one person, yes. That points you at a <ArticleLink href="/features/shared-inbox">shared inbox</ArticleLink>, where every text to the business number lands in one place, anyone can reply, and everyone can see what was already said.</p>
          <p>Group texts and forwarding tricks feel free but fall apart fast: no record of who replied, customers seeing five different numbers, and threads that vanish when someone&apos;s phone dies. Whatever platform you pick, make sure adding a teammate is trivial, because a number your crew can&apos;t answer solves nothing.</p>
        </ArticleSection>

        <ArticleSection id="choosing-your-digits" heading="Choosing your digits.">
          <p>Availability is better than you might expect. Local numbers in most US and Canadian area codes can be claimed the same day: you search by area code or prefix and pick one in minutes. Dense metro codes can be picked over, in which case your region&apos;s overlay code is the honest fallback.</p>
          <p>Don&apos;t overthink memorability. Nobody dials your number from memory; they tap it on your website, save the contact, or reply to the thread. What matters is that the area code reads local, because a local code is more likely to get answered, and an out-of-region number is easy to ignore.</p>
          <p>If you serve two regions, some platforms let you run two numbers into the same inbox, so each customer texts a local code while the crew works from one screen.</p>
        </ArticleSection>

        <ArticleSection id="honest-setup-timeline" heading="The honest setup timeline: US and Canada are different.">
          <p>Here&apos;s the part most signup pages bury. In the US, carriers require A2P 10DLC registration before a business number can send texts reliably. The approval sits with the carriers&apos; registry, not your provider, and it typically takes 3 to 7 business days. A platform promising full same-day US sending is usually skipping or shortcutting the registration that keeps you off the spam filters, so ask how. The <ArticleLink href="/blog/a2p-10dlc-registration-honest-timeline">honest 10DLC timeline</ArticleLink> walks through each step.</p>
          <p>What day one should look like: your number live and receiving immediately, so you can put it on your voicemail and website right away and read every text that comes in. Sending to US customers switches on when registration clears. Loonext files the registration automatically the minute you pay and emails you the moment you&apos;re approved.</p>
          <p>Canada is simpler. A Canadian business texting Canadian customers can send the same day it signs up. No registration, no fee, no waiting for CA-to-CA texting.</p>
        </ArticleSection>

        <ArticleSection id="what-it-really-costs" heading="What it really costs.">
          <p>Check five line items on any platform: the monthly plan, a per-seat charge, the one-time US registration fee, a monthly number fee, and the overage rules. The per-seat line is the trap. A plan that looks like $25 a month becomes $125 when five people need access, and shops respond by sharing one login, which defeats the whole point of knowing who replied.</p>
          <p>For scale, Loonext prices flat per company, never per seat: Starter is $29 a month with 3 teammates and a local number included. A US shop adds the one-time $29 registration fee, so the first month is $58 and it&apos;s $29 a month after that. Texting is included under a <ArticleLink href="/legal/fair-use">fair-use policy</ArticleLink> rather than a hard cap, and receiving texts and photos is always free.</p>
          <p>For the full teardown of number fees, overage math, and the per-seat trap, see <ArticleLink href="/blog/real-cost-of-business-texting">the real cost of business texting</ArticleLink>.</p>
        </ArticleSection>

        <ArticleSection id="day-one-setup" heading="Set up these three things on day one.">
          <p>First, an after-hours auto-reply written the way you actually talk: &quot;You&apos;ve reached [Business name]. We&apos;re closed until 8am but we got your message and will reply first thing.&quot; That one message turns a missed evening text into a booked morning job instead of a customer who called the next shop on the list.</p>
          <p>Second, STOP handling. When a customer texts STOP, the opt-out has to stick, and under US rules the stakes are real: TCPA statutory damages run $500 to $1,500 per violating text. Your platform should block future sends to that number automatically the instant STOP arrives, so nobody on the crew can text them again by accident.</p>
          <p>Third, saved replies for the texts you send twenty times a week: &quot;On my way, about 30 minutes out. [Your name] from [Business name].&quot; and &quot;Hi [Customer name], it&apos;s [Your name] from [Business name]. Your quote is attached. Reply here with any questions.&quot; Load them in on day one and every reply gets faster and more consistent.</p>
        </ArticleSection>

        <ArticleSection id="faq" heading="FAQ.">
          <p>Why not just use WhatsApp or iMessage? Because you don&apos;t get to pick your customers&apos; phones. SMS reaches virtually every phone in the US and Canada with nothing to install. iMessage only works Apple to Apple, and WhatsApp adoption in North America is patchy. A plain local number is the one channel every customer already has.</p>
          <p>Can customers call the number? It&apos;s a real phone number, so yes, people will dial it, and platforms handle those calls very differently, so ask before you sign up. On Loonext, an optional $8 a month Calling module sends calls to any phone you choose, and missed callers automatically get a text back in your own words.</p>
          <p>What if I cancel? Ask any provider two questions before you start: can I take my number with me, and what does the refund look like. A business number you can&apos;t take with you was never really yours. Loonext is month to month with a 30-day money-back guarantee that refunds the full first invoice, registration fee included.</p>
        </ArticleSection>
    </ArticlePage>
  );
}
