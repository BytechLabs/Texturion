import { ConvRow, NoteRow, TagChip } from "@/components/marketing/night/kit";
import { Reveal, RevealGroup } from "@/components/marketing/ui/reveal";
import { Section } from "@/components/marketing/ui/section";

/**
 * S2 — "What you miss after dark" (v3 "Quiet daylight" spec §6 S2, copy deck S2).
 *
 * White ground, H2 + kicker line, three white panel-cards. Each card: H3, two
 * body sentences, then a small light-styled kit fragment proving the fix
 * exists, with a one-line caption. The old dark band, the unlit-phone SVG and
 * the nxa- CSS are gone.
 *
 * Motion: <Reveal> only (the shared RevealActivator drives it). Server
 * component, zero JS of its own. The card-3 unread dot stays steady here:
 * nx-unread pulses only under an armed [data-anim] ancestor (the hero).
 */

/**
 * One problem card: H3 + two body sentences, then the docked proof fragment +
 * its caption. Fragments dock at the card foot so the three captions align.
 */
function ProblemCard({
  title,
  body,
  fragment,
  caption,
}: {
  title: string;
  body: string;
  fragment: React.ReactNode;
  caption: React.ReactNode;
}) {
  return (
    <article className="panel-card flex h-full flex-col rounded-xl p-5 sm:p-6">
      <h3 className="display-h3">{title}</h3>
      <p className="mt-2.5 text-base leading-[1.65] text-[color:var(--ink-70)]">{body}</p>
      <div className="mt-auto pt-5">
        {fragment}
        <p className="mt-2.5 text-sm leading-[1.5] text-[color:var(--ink-55)]">{caption}</p>
      </div>
    </article>
  );
}

/** Hairline frame for fragments with no boundary of their own (bare ConvRows),
 *  so they read as a piece of UI, not stray text. Same 1px card hairline. */
function FragmentFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-[rgba(11,43,38,0.08)] p-1">{children}</div>
  );
}

export function AfterDark() {
  return (
    <Section id="after-dark" defer intrinsic={960} className="bg-white">
      <Reveal className="max-w-2xl">
        <h2 className="display-h2">You never hear the text you missed.</h2>
        <p className="font-body-mkt mt-3 text-[0.8125rem] font-semibold text-[color:var(--ink-55)]">
          Leads don’t die loudly. They just sit unread.
        </p>
      </Reveal>

      <RevealGroup className="mt-10 grid gap-4 sm:mt-12 md:grid-cols-3 md:gap-5">
        <ProblemCard
          title="The lead that left with the guy who quit"
          body="Customers text whoever handed them a card. When that number walks off the crew, the thread and every job in it walks too."
          /* Proof: a thread living on the business number, assignee avatar
             visible (the deck's established background row, verbatim). */
          fragment={
            <FragmentFrame>
              <ConvRow
                as="div"
                name="Ray Aldana"
                snippet="Thanks, drain’s running great."
                time="6:14 PM"
                pill="Closed"
                avatar="M"
              />
            </FragmentFrame>
          }
          caption="Every thread lives on the business number. Not in a pocket."
        />
        <ProblemCard
          title="The quote nobody can find"
          body="You priced it three weeks ago, from somebody’s phone, in a thread nobody else can open. Now the customer says yes and you’re scrolling."
          fragment={
            <div className="grid justify-items-start gap-2">
              <TagChip>Quote sent</TagChip>
              <NoteRow as="div" author="Marcus">
                quoted $1,450 on the 12th
              </NoteRow>
            </div>
          }
          caption={
            <>Tag it &ldquo;Quote sent&rdquo;. Anyone on the crew can pull it up.</>
          }
        />
        <ProblemCard
          title="The 9 pm text nobody saw until noon"
          body="It sat face down on a truck seat all night. By the time anyone read it, she’d booked whoever answered first."
          /* Proof: the unread dot holding at 9:04 PM (deck S2 card 3). */
          fragment={
            <FragmentFrame>
              <ConvRow
                as="div"
                name="Dana Whitfield"
                snippet="Water heater’s leaking into the garage. Too late to text?"
                time="9:04 PM"
                unread
              />
            </FragmentFrame>
          }
          caption="Unread stays lit until somebody deals with it."
        />
      </RevealGroup>
    </Section>
  );
}
