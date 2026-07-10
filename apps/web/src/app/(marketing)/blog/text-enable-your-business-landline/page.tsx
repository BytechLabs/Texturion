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

const POST = blogPost("text-enable-your-business-landline");

export const metadata: Metadata = buildMetadata({
  title: POST.title,
  description: POST.description,
  path: blogPostPath(POST.slug),
});

export default function Page() {
  return (
    <ArticlePage post={POST}>
      <ArticleLede>
        <p>Your business number is on the truck, the invoices, the website, and ten years of fridge magnets. Customers know it by heart. And some of them are already texting it, because to a customer, a phone number is a phone number.</p>
        <p>If that number is a landline, those texts usually go nowhere. Often there&apos;s no error on the customer&apos;s end and no notification on yours. They think you saw the message and ignored it, so they call the next company on the list.</p>
        <p>Here&apos;s the part most vendors leave vague: you can add texting to the number you already have without changing your phone service, your carrier, or your call routing. It&apos;s called text-enabling, and it&apos;s simpler than it sounds.</p>
      </ArticleLede>

        <ArticleSection id="what-happens-today" heading="What happens today when someone texts your landline.">
          <p>Most landlines have voice service and nothing else. When a customer texts one, the message has nowhere to land. Depending on the carrier, the sender might get a failure notice, but often the text just disappears without a trace on either side.</p>
          <p>From the customer&apos;s point of view, they reached out and you went silent. They don&apos;t know your number can&apos;t receive texts. They just know the plumber down the road texted back in five minutes and you didn&apos;t.</p>
          <p>That&apos;s the real cost of an un-textable number: not the messages you see and skip, but the ones you never knew arrived.</p>
        </ArticleSection>

        <ArticleSection id="how-text-enabling-works" heading="How text-enabling works: your calls don&apos;t move.">
          <p>Every phone number has two separate jobs: routing calls and routing messages. Your landline has always done the first. Text-enabling registers the second, so texts sent to your number finally have somewhere to go.</p>
          <p>The process is paperwork, not rewiring. You prove you own the number (usually a recent phone bill and a signed authorization form), and the texting provider registers your number for messaging. Your carrier, your desk phones, and your call flow stay exactly as they are. Calls never touch the texting provider.</p>
          <p>The texts land in whatever inbox your texting provider gives you. Whatever tool you pick, make sure more than one person can see and answer the messages. That&apos;s the whole case for a <ArticleLink href="/features/shared-inbox">shared inbox</ArticleLink>: one number the entire crew can cover from any phone, instead of messages stuck on a single device.</p>
        </ArticleSection>

        <ArticleSection id="which-numbers-qualify" heading="Which numbers qualify.">
          <p>Most local 10-digit business numbers in the US and Canada can be text-enabled. That covers:</p>
          <ArticleList>
            <li>Traditional landlines from major and regional carriers</li>
            <li>VoIP numbers from cable or internet phone providers</li>
            <li>The main line of a phone system (individual extensions can&apos;t be enabled, only real numbers)</li>
          </ArticleList>
          <p>What doesn&apos;t work: a personal cell number, because it already has texting through the mobile carrier, and any number you can&apos;t prove you own. Toll-free numbers follow a different process, so check with your provider if that&apos;s what you have. If your number is a local line you pay a bill for, odds are good it qualifies.</p>
        </ArticleSection>

        <ArticleSection id="the-honest-timeline" heading="The honest timeline, including US carrier registration.">
          <p>How long does the enabling step take? Timing varies by carrier and by how fast your ownership paperwork clears, so ask your provider to show you where things stand. For US businesses there&apos;s a second step nobody should gloss over: carrier registration, known as A2P 10DLC. US carriers filter business texting from unregistered numbers, so registration isn&apos;t optional if you want your messages delivered.</p>
          <p>In practice, receiving works right away: the moment your number is enabled, customer texts start arriving. Sending to US customers activates after carrier approval, typically 3 to 7 business days. Your provider should file the registration for you and email you the moment you&apos;re approved (Loonext does, and the fee is a one-time $29, charged once ever). The full story is in our <ArticleLink href="/blog/a2p-10dlc-registration-honest-timeline">honest A2P 10DLC timeline</ArticleLink>.</p>
          <p>Canadian businesses texting Canadian customers skip all of this. No registration, no fee, sending works the same day.</p>
        </ArticleSection>

        <ArticleSection id="text-enable-vs-port-vs-new" heading="Text-enable vs port vs new number: how to decide.">
          <p>Text-enabling is one of three ways to get a textable business number, and the right one depends on how attached you are to your current phone setup.</p>
          <p>Text-enable when you&apos;re happy with your phone service and just want texting added on top. Calls stay with your carrier, your bill for voice doesn&apos;t change, and customers keep the number they know.</p>
          <p>Port when you want to move the whole number, calls and texts, to a new provider. Done right, your number keeps working on the old carrier during the transfer and switches over on a scheduled cutover date, typically 1 to 7 business days. We wrote up <ArticleLink href="/blog/port-business-number-without-going-dark">how to port without going dark</ArticleLink> if you&apos;re weighing that path.</p>
          <p>Get a new number when speed matters more than recognition: a new location, a dedicated dispatch line, or a business that&apos;s just starting out. It&apos;s receiving texts immediately, though for US businesses sending still waits on the same carrier registration described above. And nobody knows the number yet, so you&apos;ll be printing it on everything from scratch.</p>
        </ArticleSection>

        <ArticleSection id="set-it-up-with-the-crew" heading="Set it up right before the first text arrives.">
          <p>The day texting goes live, your landline becomes an inbox, and inboxes need owners. Decide up front who answers first, who covers when they&apos;re on a job, and what happens after hours. A shared inbox where each conversation has an assigned owner beats forwarding texts around a group chat, because everyone can see what&apos;s been answered and what&apos;s still waiting.</p>
          <p>Set an after-hours auto-reply in your own words so a 9pm text doesn&apos;t sit in silence until morning. Then build a few saved replies for the messages you&apos;ll send twenty times a week:</p>
          <ArticleList>
            <li>&quot;Thanks for texting [Business name]! Can you send your address and a photo of the problem? We&apos;ll get back to you with a time.&quot;</li>
            <li>&quot;You&apos;re on the schedule for [day] between [time] and [time]. Reply here if anything changes.&quot;</li>
            <li>&quot;Hi [Name], it&apos;s [Your name] from [Business name]. Your quote is ready. Want me to text it over?&quot;</li>
          </ArticleList>
          <p>Look for a tool with saved replies, a status on every conversation (new, open, waiting, closed), and internal notes the crew can use without the customer ever seeing them. Loonext has all three. Whatever tool you use, get these habits in place before the volume shows up, not after.</p>
        </ArticleSection>

        <ArticleSection id="faq" heading="FAQ: your phone bill, undoing it, and switching providers.">
          <p>Does this affect my phone bill? No. You keep paying your current carrier for voice exactly as before, and texting is billed separately by whichever texting provider you choose. Ask up front whether they charge per company or per seat, and see <ArticleLink href="/blog/real-cost-of-business-texting">the real cost of business texting</ArticleLink> for what the numbers look like.</p>
          <p>Can I undo it? Yes. Text-enabling can be released, which returns your number to voice-only. Since your calls never moved in the first place, there&apos;s nothing to unwind on the phone side.</p>
          <p>What if I switch phone providers later? A voice-carrier change can affect your texting setup, so tell your texting provider before you switch and ask what they need to keep messaging intact. Don&apos;t assume the texting side follows along on its own.</p>
          <p>The bottom line: the number your customers already know is your best texting asset. Text-enabling lets it do one more job without touching the job it already does.</p>
        </ArticleSection>
    </ArticlePage>
  );
}
