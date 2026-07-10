import type { Metadata } from "next";

import { ConsentPreferences } from "@/components/marketing/consent";
import {
  LegalLink,
  LegalPage,
  LegalSectionBlock,
} from "@/components/marketing/legal/legal-page";
import { SUPPORT_EMAIL } from "@/lib/marketing/business";
import { buildMetadata } from "@/lib/marketing/seo";

const PATH = "/legal/cookies";
const LAST_UPDATED = "July 10, 2026";

export const metadata: Metadata = buildMetadata({
  title: "Cookie policy",
  description:
    "Loonext sets a few essential, first-party cookies: one to keep you signed in, one to remember which workspace you're viewing, one to remember your cookie choice. On our marketing pages, analytics or advertising cookies are set only if you say yes to the consent banner; say no and none are set. Our product analytics is cookieless.",
  path: PATH,
});

const sections = [
  { id: "short", number: "1", heading: "The short version" },
  { id: "essential", number: "2", heading: "Essential cookies we set" },
  { id: "consent", number: "3", heading: "Tracking cookies only if you say yes" },
  { id: "analytics", number: "4", heading: "Analytics, without cookies" },
  { id: "storage", number: "5", heading: "Local storage, which is not a cookie" },
  { id: "choices", number: "6", heading: "Your choices" },
  { id: "contact", number: "7", heading: "Contact" },
];

export default function CookiesPage() {
  return (
    <LegalPage
      title="Cookie policy"
      summary="Loonext sets only a small number of essential, first-party cookies: one keeps you signed in, one remembers which workspace you are viewing, and one remembers your answer to the cookie banner. On the public marketing pages we use Google Tag Manager, and it may set analytics or advertising cookies only if you say yes to that banner; say no, or say nothing, and it sets none. The signed-in app never uses tracking cookies, we do not sell data, and our product analytics is cookieless (it stores anonymous, event-level usage in your browser's local storage, never message content, names, or phone numbers)."
      lastUpdated={LAST_UPDATED}
      lastUpdatedIso="2026-07-10"
      breadcrumbLabel="Cookies"
      path={PATH}
      sections={sections}
    >
      <LegalSectionBlock id="short" number="1" heading="The short version">
        <p>
          A cookie is a small piece of text a website stores in your browser.
          Loonext uses essential cookies for exactly three jobs, all
          first-party (set by us, not a third party): keeping you signed in,
          remembering which of your workspaces you are looking at, and
          remembering how you answered our cookie banner. Beyond those, the
          public marketing pages ask before setting anything: a banner offers a
          plain yes or no, and analytics or advertising cookies exist only
          after a yes. We never sell your data, and the signed-in app never
          uses tracking cookies at all. Everything else we store in your
          browser is either cookieless or a plain local-storage convenience,
          described below. This page sits next to our{" "}
          <LegalLink href="/legal/privacy">privacy policy</LegalLink>.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock
        id="essential"
        number="2"
        heading="Essential cookies we set"
      >
        <p>
          Three first-party cookies do necessary jobs. They carry no
          advertising identifiers and are readable only by Loonext:
        </p>
        <ul>
          <li>
            <strong>Your session.</strong> When you sign in, an authentication
            cookie keeps you signed in as you move between pages, so you are not
            asked for your password on every screen. Sign out and it is cleared.
          </li>
          <li>
            <strong>Your workspace.</strong> A single cookie remembers which
            workspace you last had open, so the app opens on the right one. It
            holds only that workspace&apos;s internal id, no personal details,
            and expires after a year (sooner if you clear it).
          </li>
          <li>
            <strong>Your cookie choice.</strong> One cookie
            (<code>loonext.consent</code>) remembers how you answered the
            banner on our marketing pages, so we do not ask again on every
            visit, and so a &quot;no&quot; stays a no. It holds only the word
            &quot;granted&quot; or &quot;denied&quot; and expires after 180
            days, after which we simply ask again.
          </li>
        </ul>
        <p>
          These are strictly necessary: the first two are how staying signed in
          works, and the third is how we remember not to track you. We set no
          other cookie without asking first.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock
        id="consent"
        number="3"
        heading="Tracking cookies only if you say yes"
      >
        <p>
          Our public marketing pages load Google Tag Manager, a tool that lets
          us measure which pages bring people in and, if we run ads, whether
          those ads are honest about what works. It starts in a
          denied-by-default state (Google calls this consent mode): until you
          answer the banner with a yes, tags that would set analytics or
          advertising cookies set nothing. Say no, or ignore the banner
          entirely, and no analytics or advertising cookie is ever set. With
          JavaScript turned off, the tag manager does not load at all. None of
          this applies to the signed-in app, which loads no tag manager and no
          advertising code on any screen.
        </p>
        <p>
          We run no ad networks on the site itself, we do not embed
          social-media trackers, and we never sell or rent your data. The
          third parties in the product are the sub-processors that make it run
          (the phone carrier, payments, hosting, email, and error and analytics
          tooling), each listed on our{" "}
          <LegalLink href="/legal/subprocessors">sub-processors page</LegalLink>{" "}
          and limited to what its job requires.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="analytics" number="4" heading="Analytics, without cookies">
        <p>
          Separately from the optional measurement above, we track which
          product features get used so we can improve them. That product
          analytics is configured to be cookieless: it stores its state in your
          browser&apos;s local storage rather than a cookie, records
          event-level usage only (page views, feature clicks, counts), and is
          stripped of message content, names, addresses, and phone numbers
          before anything is sent. Marketing traffic stays anonymous; a profile
          exists only once a workspace signs in, and it is keyed to the
          workspace&apos;s internal id, never to you as a person. The tooling
          is named on our{" "}
          <LegalLink href="/legal/subprocessors">sub-processors page</LegalLink>.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock
        id="storage"
        number="5"
        heading="Local storage, which is not a cookie"
      >
        <p>
          Some conveniences live in your browser&apos;s local storage, which
          stays on your device and is never sent to us as a cookie: your country
          choice on the marketing pages, an in-progress signup so a refresh does
          not lose your place, and the cookieless analytics state above. Clearing
          your browser&apos;s site data removes all of it. None of it contains
          message content or contact details.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="choices" number="6" heading="Your choices">
        <p>
          You are in control, and changing your mind is one tap. Your current
          choice for the optional cookies, changeable right here any time:
        </p>
        <ConsentPreferences />
        <noscript>
          <p>
            With JavaScript off there is nothing to switch: the tag manager
            never loads, so no optional cookie is ever set.
          </p>
        </noscript>
        <p>
          Your browser can also block or clear cookies and local storage at any
          time, per site or across the board. Blocking the essential cookies
          means you will not be able to stay signed in to the app; the public
          marketing pages work either way.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="contact" number="7" heading="Contact">
        <p>
          Questions about what we store, or a request about your data? Write to{" "}
          <LegalLink href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</LegalLink>,
          and see the <LegalLink href="/legal/privacy">privacy policy</LegalLink>{" "}
          for how we handle personal data overall.
        </p>
      </LegalSectionBlock>
    </LegalPage>
  );
}
