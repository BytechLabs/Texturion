import type { Metadata } from "next";

import {
  LegalLink,
  LegalPage,
  LegalSectionBlock,
} from "@/components/marketing/legal/legal-page";
import { SUPPORT_EMAIL } from "@/lib/marketing/business";
import { buildMetadata } from "@/lib/marketing/seo";

const PATH = "/legal/cookies";
const LAST_UPDATED = "July 9, 2026";

export const metadata: Metadata = buildMetadata({
  title: "Cookie policy",
  description:
    "Loonext uses only a few essential, first-party cookies: one to keep you signed in, one to remember which workspace you're viewing. We set no advertising or cross-site tracking cookies, and our product analytics is cookieless. Because nothing here is non-essential, there is no consent banner to click.",
  path: PATH,
});

const sections = [
  { id: "short", number: "1", heading: "The short version" },
  { id: "essential", number: "2", heading: "Essential cookies we set" },
  { id: "no-tracking", number: "3", heading: "No tracking or advertising cookies" },
  { id: "analytics", number: "4", heading: "Analytics, without cookies" },
  { id: "storage", number: "5", heading: "Local storage, which is not a cookie" },
  { id: "choices", number: "6", heading: "Your choices" },
  { id: "contact", number: "7", heading: "Contact" },
];

export default function CookiesPage() {
  return (
    <LegalPage
      title="Cookie policy"
      summary="Loonext sets only a small number of essential, first-party cookies: one keeps you signed in, and one remembers which workspace you are viewing. We set no advertising or cross-site tracking cookies, we do not sell data, and our product analytics is cookieless (it stores anonymous, event-level usage in your browser's local storage, never message content, names, or phone numbers). Because none of this is non-essential, there is no consent banner to click through, and blocking the essential cookies simply means you cannot stay signed in."
      lastUpdated={LAST_UPDATED}
      lastUpdatedIso="2026-07-09"
      breadcrumbLabel="Cookies"
      path={PATH}
      sections={sections}
    >
      <LegalSectionBlock id="short" number="1" heading="The short version">
        <p>
          A cookie is a small piece of text a website stores in your browser.
          Loonext uses cookies for exactly two jobs, both essential and both
          first-party (set by us, not a third party): keeping you signed in, and
          remembering which of your workspaces you are looking at. We do not use
          cookies to advertise to you, to follow you around the web, or to build
          a profile of you, and we never sell your data. Everything else we store
          in your browser is either cookieless or a plain local-storage
          convenience, described below. This page sits next to our{" "}
          <LegalLink href="/legal/privacy">privacy policy</LegalLink>.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock
        id="essential"
        number="2"
        heading="Essential cookies we set"
      >
        <p>
          Two first-party cookies make the signed-in app work. They carry no
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
        </ul>
        <p>
          These are strictly necessary: with them blocked, you cannot stay
          signed in, so there is nothing to ask consent for. We do not set any
          cookie that is optional.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock
        id="no-tracking"
        number="3"
        heading="No tracking or advertising cookies"
      >
        <p>
          Loonext runs no ad networks, no third-party advertising pixels, and no
          cross-site tracking cookies. We do not embed social-media trackers, and
          we do not sell or rent your data to anyone. The only third parties in
          the product are the sub-processors that make it run (the phone carrier,
          payments, hosting, email, and error and analytics tooling), each listed
          on our{" "}
          <LegalLink href="/legal/subprocessors">sub-processors page</LegalLink>{" "}
          and limited to what its job requires.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="analytics" number="4" heading="Analytics, without cookies">
        <p>
          We measure which features get used and how new customers find us, so we
          can improve the product. Our analytics is configured to be cookieless:
          it stores its state in your browser&apos;s local storage rather than a
          cookie, records event-level usage only (page views, feature clicks,
          counts), and is stripped of message content, names, addresses, and
          phone numbers before anything is sent. Marketing traffic stays
          anonymous; a profile exists only once a workspace signs in, and it is
          keyed to the workspace&apos;s internal id, never to you as a person.
          The tooling is named on our{" "}
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
          You are in control. Your browser can block or clear cookies and local
          storage at any time, per site or across the board. Blocking the
          essential cookies means you will not be able to stay signed in to the
          app. The public marketing pages work either way. Because we set no
          non-essential cookies, there is nothing extra to opt out of, and no
          banner stands between you and the site.
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
