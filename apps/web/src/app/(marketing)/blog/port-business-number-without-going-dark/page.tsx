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

const POST = blogPost("port-business-number-without-going-dark");

export const metadata: Metadata = buildMetadata({
  title: POST.title,
  description: POST.description,
  path: blogPostPath(POST.slug),
});

export default function Page() {
  return (
    <ArticlePage post={POST}>
      <ArticleLede>
        <p>Your number is on the truck, the invoices, the yard signs, the Google listing, and a couple hundred fridge magnets. You have had it for ten or fifteen years, and every repeat customer in town knows it by heart. So when someone says &quot;just port it over,&quot; what you hear is &quot;gamble the phone number your whole business runs on.&quot;</p>
        <p>That fear is reasonable, but it is mostly aimed at the wrong thing. Porting itself is routine and regulated. You own the right to your number, and carriers move numbers between providers every day. The horror stories almost always trace back to two avoidable mistakes: paperwork that does not match what the old carrier has on file, and cancelling the old service before the port finishes.</p>
        <p>This guide covers both, plus the one gotcha almost nobody warns you about: voice and texting do not always switch over on the same clock.</p>
      </ArticleLede>

        <ArticleSection id="porting-in-one-paragraph" heading="Porting in one paragraph: the number goes with you, and carriers must release it.">
          <p>In both the US and Canada, number portability is the rule, not a favor. When you submit a valid port request through your new provider, your old carrier is required to release the number. They cannot hold it hostage because you are switching to a competitor, and in the US an unpaid balance is not a valid reason to block the port either (you still owe the money, they just cannot use the number as leverage).</p>
          <p>The mechanics are simple: you sign up with the new provider, hand them your account details from the old carrier, and they file the request on your behalf. You never talk to the losing carrier about the port itself. Your job is to get the paperwork right and then not touch anything until the transfer completes.</p>
        </ArticleSection>

        <ArticleSection id="voice-and-texting-run-on-different-clocks" heading="The gotcha nobody warns you about: voice and texting can complete on different clocks.">
          <p>A phone number is really two things wearing one set of digits: a voice route and a texting route. They live in different systems, and when a number moves, they do not always update at the same moment. It is possible for calls to be flowing through your new provider while texts are still pointed at the old one for a stretch, or the reverse.</p>
          <p>The gap is often brief or nonexistent, but plan for it instead of discovering it. Three habits cover you: schedule the cutover for a slow day rather than your busiest morning, tell your new provider explicitly that the number needs to send and receive texts (not every provider enables texting on ported numbers by default), and test both directions the day it flips. Call the number from your cell, then text it, then reply from the new inbox.</p>
          <p>One more wrinkle for US businesses: even after the texting route moves, sending texts to US customers depends on carrier registration, which is a third clock entirely. More on that below.</p>
        </ArticleSection>

        <ArticleSection id="pre-port-checklist" heading="The pre port checklist that prevents most rejections.">
          <p>The classic reason ports get rejected is a mismatch between what you submit and what the losing carrier has on file. The fix is boring: before you submit anything, call your old carrier (or log into their portal) and read back exactly what they have. Then gather these:</p>
          <ArticleList>
            <li>Your account number with the old carrier. This is not your phone number. It is on your bill or in the account portal.</li>
            <li>Your port out PIN or passcode. Wireless and many VoIP providers require one, and some make you generate it in a security settings page right before the port.</li>
            <li>The service address exactly as the old carrier has it, down to &quot;Ste&quot; versus &quot;Suite&quot;. A typo here is a rejection.</li>
            <li>The exact legal name on the account. If the account is under &quot;Smith Plumbing LLC&quot; and you write &quot;Smith Plumbing,&quot; expect a bounce.</li>
            <li>A recent bill or customer service record as backup, in case the new provider asks for proof.</li>
          </ArticleList>
          <p>A rejected port is not a disaster. Nothing happens to your number, the request just bounces back for correction and the clock restarts. But every bounce costs you days, so it is worth ten minutes on the phone to get it right the first time.</p>
        </ArticleSection>

        <ArticleSection id="sequence-us-registration-around-the-port" heading="Sequencing it right: handle US carrier registration around the port, not after it.">
          <p>If you are a US business (or a Canadian one texting US customers), your number needs A2P 10DLC carrier registration before it can send texts to US customers at full strength. Carriers filter unregistered business traffic, so skipping this step means your texts may quietly stop arriving. Registration approval typically takes several business days, which is roughly the same window as the port itself.</p>
          <p>That overlap is your friend. Start registration the same day you start the port and the two clocks run in parallel instead of back to back. Do them in sequence and you can add a week of texting downtime for no reason. The full paperwork and timeline is its own topic, covered in our <ArticleLink href="/blog/a2p-10dlc-registration-honest-timeline">honest guide to A2P 10DLC registration</ArticleLink>.</p>
          <p>On Loonext this sequencing is handled for you: registration is filed automatically the minute you pay (a one time $29 fee for US texting), the number receives texts from day one, and sending to US customers activates when carriers approve, typically 3 to 7 business days. You get an email the moment it clears. Canadian businesses texting Canadian customers skip all of this: no registration, no fee, sending works the same day.</p>
        </ArticleSection>

        <ArticleSection id="a-realistic-timeline" heading="A realistic timeline, start to finish.">
          <p>Day zero: you gather the checklist items and submit the port request. Days one through seven (business days): the carriers process it. Local US and Canadian numbers usually land in that 1 to 7 business day range, with clean requests often on the faster end. Then there is a scheduled cutover date, and the number flips.</p>
          <p>The part that should lower your blood pressure: your number keeps working on the old carrier the entire time. Porting is not a blackout followed by a relaunch. It is a scheduled handoff, and until the cutover moment your calls and texts flow exactly as they do today.</p>
          <p>On Loonext, porting is free and self serve for US and Canadian local numbers: you enter the details, Loonext handles the carrier paperwork, and you watch live port status instead of wondering. If you want to start texting before the port completes, there is an optional temporary <ArticleLink href="/features/business-number">Loonext number</ArticleLink> you can use in the meantime (it is off by default, so nothing texts from a number you did not choose).</p>
        </ArticleSection>

        <ArticleSection id="porting-from-a-texting-app" heading="Porting from a texting app or VoIP service.">
          <p>Numbers that live on texting apps and VoIP services are portable too, and these ports can be quick. The checklist is the same, but the details hide in different places: the account number is usually in the app&apos;s settings or billing page, and some services make you flip a &quot;port out&quot; or &quot;number lock&quot; setting before they will release the number.</p>
          <p>Two extra rules for this case. First, export your message history before the cutover. The number moves, the conversations do not, and once your old subscription lapses that history may be gone. Second, keep the old subscription active until the port completes. Cancelling early can release the number back into the carrier pool, and that is the one way to genuinely lose it.</p>
        </ArticleSection>

        <ArticleSection id="port-vs-text-enable-vs-new-number" heading="Port vs text enable vs new number: pick the right move.">
          <p>Porting is not always the answer, and it is worth thirty seconds to check you are solving the right problem.</p>
          <ArticleList>
            <li>Port when you want calls and texts handled by the new provider, in one place, on the number everyone already knows.</li>
            <li>Text enable when you are happy with your current phone or landline service and just want that same number to send and receive texts. Voice stays exactly where it is, nothing ports. Here is <ArticleLink href="/blog/text-enable-your-business-landline">how text enabling a landline works</ArticleLink>.</li>
            <li>Get a new local number when you are starting fresh or want a separate line for texting. It is the fastest option, live and receiving the same day, though sending to US customers still waits on the carrier registration covered above. The trade-off is starting with zero recognition.</li>
          </ArticleList>
          <p>Plenty of shops start by text enabling or grabbing a new number, then port later once they trust the platform. There is no penalty for doing it in stages.</p>
        </ArticleSection>

        <ArticleSection id="porting-faq" heading="Porting FAQ: the questions everyone asks.">
          <p>&quot;Can my old carrier refuse to release my number?&quot; Not because you are leaving, and not to punish you for switching. They can bounce a request over mismatched details, and they can charge whatever early termination fee your contract allows, but a valid port request for a portable number goes through.</p>
          <p>&quot;Should I cancel my old service first?&quot; Never; this is the golden rule of porting. Cancelling first can release your number back to the carrier&apos;s pool before the port grabs it, and recovering a released number ranges from painful to impossible. Port first. The old service either ends automatically at cutover or you cancel it yourself the day after you confirm everything works.</p>
          <p>&quot;Will I miss calls during the switch?&quot; The old service works until the scheduled cutover, and the flip itself is typically quick. Schedule it for a quiet stretch and test immediately, and you are unlikely to notice a gap.</p>
          <p>&quot;Do I need to update my Google listing or website?&quot; No. That is the whole point of porting: the digits do not change, so every truck decal, invoice, and listing keeps working. And once the number is in a shared inbox, the whole crew can answer it instead of whoever&apos;s pocket it used to ring in. If you are still weighing platforms, start with <ArticleLink href="/blog/how-to-get-a-business-text-number">how to get a business text number</ArticleLink> and work forward from there.</p>
        </ArticleSection>
    </ArticlePage>
  );
}
