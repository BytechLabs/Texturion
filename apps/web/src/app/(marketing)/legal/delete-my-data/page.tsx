import type { Metadata } from "next";

import {
  LegalLink,
  LegalPage,
  LegalSectionBlock,
} from "@/components/marketing/legal/legal-page";
import { PRIVACY_EMAIL } from "@/lib/marketing/business";
import { buildMetadata } from "@/lib/marketing/seo";
import { DELETION_GAPS } from "@loonext/shared";

/**
 * #227: the public deletion URL.
 *
 * Google Play's Data Safety form requires a **web-accessible** deletion URL for
 * any app with accounts, reachable without signing in and independent of any
 * in-app flow. That is why this lives on the marketing site rather than behind
 * the app: a reviewer, or someone who has already lost access to their account,
 * has to be able to read it.
 *
 * The path is STABLE. It is filed with Google and printed in the privacy
 * policy; renaming it silently breaks a store declaration.
 */
const PATH = "/legal/delete-my-data";
const LAST_UPDATED = "July 26, 2026";

export const metadata: Metadata = buildMetadata({
  title: "Delete your data",
  description:
    "How to delete your Loonext account or close your workspace, what happens to your data when you do, what we are required to keep, and for how long.",
  path: PATH,
});

const sections = [
  { id: "account", number: "1", heading: "Delete your account" },
  { id: "workspace", number: "2", heading: "Close a workspace" },
  { id: "what-goes", number: "3", heading: "What is deleted" },
  { id: "what-stays", number: "4", heading: "What we have to keep" },
  { id: "when", number: "5", heading: "When it happens" },
  { id: "boundary", number: "6", heading: "What closing a workspace does not reach" },
  { id: "help", number: "7", heading: "If you cannot sign in" },
];

export default function DeleteMyDataPage() {
  return (
    <LegalPage
      title="Delete your data"
      summary="You can delete your own account, or close a whole workspace, from inside Loonext. No email to us, and no waiting on support. Deleting your account signs you out everywhere and takes your name off the product. Closing a workspace ends it for everyone on it, releases the phone number, stops billing, and erases everything in it after 30 days. Two things outlive both, and we say plainly why: anyone who replied STOP stays on the do-not-text list, and a stripped record that consent existed is kept for three years because the law requires it."
      lastUpdated={LAST_UPDATED}
      lastUpdatedIso="2026-07-26"
      breadcrumbLabel="Delete your data"
      path={PATH}
      sections={sections}
    >
      <LegalSectionBlock id="account" number="1" heading="Delete your account">
        <p>
          In Loonext, go to <strong>Settings → Account → Delete your account</strong>.
          It is in the same place in the web app, the iPhone app and the Android
          app. You will see exactly what will happen, and you type{" "}
          <strong>delete</strong> to confirm.
        </p>
        <p>
          If you own a workspace you will be asked to hand it to someone else or
          close it first. A workspace cannot be left with nobody in charge of
          it: the phone number, the billing and the customer history all belong
          to somebody.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="workspace" number="2" heading="Close a workspace">
        <p>
          The owner of a workspace can close it from{" "}
          <strong>Settings → Workspace → Close this workspace</strong> in the web
          app. It ends the account for everyone on it, so it is deliberately the
          owner&apos;s decision alone, and you type the workspace name to confirm.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="what-goes" number="3" heading="What is deleted">
        <p>
          Deleting your <strong>account</strong> removes your name, your
          notification settings, everything that sends alerts to your devices,
          and your ability to sign in. You are signed out everywhere
          immediately.
        </p>
        <p>
          Closing a <strong>workspace</strong> erases everything in it: messages
          and their photos, voicemail recordings, contacts, tasks, notes, call
          history and saved replies, along with the files behind them and the
          billing record at our payment processor. The phone number is released
          straight away: it returns to the phone company and can be reassigned to
          another business, so anyone who still has it saved will eventually reach
          someone else. We cannot get it back for you. If you want to keep the
          number, port it out to another carrier before you close.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="what-stays" number="4" heading="What we have to keep">
        <p>
          Two things survive, and we would rather say so than imply an erasure
          we cannot perform.
        </p>
        <p>
          <strong>Do-not-text records.</strong> If someone replied STOP to a
          business using Loonext, that record stays. It belongs to the person who
          sent it, not to the business that received it. Deleting it would let the
          same business text them again from a new account. It contains their
          phone number and the date, and nothing else.
        </p>
        <p>
          <strong>Proof that consent existed.</strong> Canadian anti-spam law
          requires us to be able to show that a business had permission to text
          someone, for three years. We keep the minimum that proves it (a phone
          number, a date, and how consent was given) and erase everything around
          it: names, email addresses, street addresses, message contents,
          photos, and voicemail audio.
        </p>
        <p>
          Your own work is not kept as personal data, but it does stay with the
          business you did it for. Texts you sent to customers, jobs you logged
          and notes you wrote belong to that business&apos;s records, and after
          you delete your account they no longer carry your name.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="when" number="5" heading="When it happens">
        <p>
          <strong>Account deletion is immediate.</strong> There is no waiting
          period and no way to undo it.
        </p>
        <p>
          <strong>Closing a workspace takes effect immediately and finishes in
          30 days.</strong> Access ends, the number is released and billing stops
          the moment you confirm. The erasing itself happens 30 days later, which
          is deliberate: it is a window in which a workspace closed by mistake
          can still be recovered by contacting us. Once that window passes,
          nobody can undo it, including us.
        </p>
      </LegalSectionBlock>

      {/* #357: "A published page must not imply either is handled." The two
          gaps that issue named have both since closed — account deletion
          shipped, and the contact form's messages got their own retention — so
          what is left is a boundary rather than a gap. It is still worth
          saying: something held outside your workspace is not removed by
          closing your workspace, and a reader deserves to know where to ask. */}
      <LegalSectionBlock
        id="boundary"
        number="6"
        heading="What closing a workspace does not reach"
      >
        <p>
          Closing a workspace erases what is in it. One thing sits outside every
          workspace, so it is worth naming rather than leaving to be discovered.
        </p>
        <ul>
          {DELETION_GAPS.map((gap) => (
            <li key={gap}>{gap}</li>
          ))}
        </ul>
      </LegalSectionBlock>

      <LegalSectionBlock id="help" number="7" heading="If you cannot sign in">
        <p>
          If you have lost access to your account and cannot use the in-app
          controls, email{" "}
          <LegalLink href={`mailto:${PRIVACY_EMAIL}`}>{PRIVACY_EMAIL}</LegalLink>{" "}
          from the address on the account and we will handle it. Under PIPEDA and
          Quebec Law 25 we respond within the timelines the law sets.
        </p>
        <p>
          If you are a <em>customer</em> of a business that uses Loonext rather
          than a Loonext user, meaning you received a text from one of our
          customers, then that business controls your information, and we will route your request
          to them. To stop the texts immediately, reply <strong>STOP</strong> to
          any message from them.
        </p>
      </LegalSectionBlock>
    </LegalPage>
  );
}
