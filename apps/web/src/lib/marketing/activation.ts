/**
 * #437 — how fast the product is actually usable, said once.
 *
 * THE COLLISION THIS ENDS. Every blog post and several feature pages closed on
 * "live in minutes". One of those posts —
 * `blog/a2p-10dlc-registration-honest-timeline` — exists to tell the reader:
 *
 *   "Be skeptical of any pitch that promises same-day US sending from a fresh
 *    local number: nobody gets to skip that queue."
 *
 * A few hundred pixels below that sentence sat our own CTA promising a number live
 * in minutes. The post was right and the CTA was the pitch it had just told the
 * reader to distrust. Both ours, on one page.
 *
 * WHY IT SURVIVED SO LONG: the claim is not a lie, which is what made it easy to
 * miss. Per D2, inbound works immediately for everyone and CA→CA outbound works
 * immediately for Canadian companies, so "live in minutes" is true for a Canadian
 * shop and for anyone who only needs to receive. It is wrong by about a week for a
 * US business wanting to text customers, which is the modal reader of a post about
 * 10DLC registration.
 *
 * ONE PHRASE, NOT PER-PAGE OVERRIDES, and that is the #437 ask worth honouring
 * literally. `article-page.tsx` already accepted `ctaHeading`/`ctaSub` props, so the
 * cheap fix was overriding the copy on the one post that contradicted itself. That
 * is precisely how the $29 figure in #385 drifted from its "one to three seats"
 * qualifier: a default that is wrong somewhere plus overrides wherever anybody
 * noticed. A default that is true everywhere needs no maintenance and cannot drift.
 *
 * WHY NOT COUNTRY-SPLIT IT, given the site already renders a US story and a CA
 * story separately. Two reasons. Some of these strings are `metadata.description`
 * for SEO, which is one string per URL and cannot vary by reader. And a CA reader
 * who reads "texting US customers turns on once carriers approve" is not misled by
 * it — it simply does not apply to them — whereas a US reader who reads "live in
 * minutes" is. Erring toward the sentence that is true for everybody costs the
 * Canadian reader nothing.
 *
 * The wording follows `home/the-deal.tsx`, which has been carrying the honest
 * version all along while the unqualified one travelled: *"Day one you're not idle:
 * receiving texts works right away. Texting US customers turns on in about a week,
 * 3 to 7 business days, once the phone companies approve you."*
 *
 * No em dashes: these strings render in marketing prose, where Law 6 applies and
 * `blog-pages.test.ts` enforces it.
 */

/**
 * The full claim. Use wherever there is room for a sentence — CTA subheads, body
 * copy, anywhere the old "live in minutes" ran.
 */
export const ACTIVATION_CLAIM =
  "set up today. Receiving texts works right away, and texting US customers " +
  "turns on once the carriers approve you, about a week";

/**
 * The short claim, for `metadata.description` and other places with a character
 * budget. Still names the wait rather than implying its absence, which is the whole
 * point — a shorter version that dropped the qualifier would recreate the bug in a
 * tighter space.
 */
export const ACTIVATION_CLAIM_SHORT =
  "set up today, with US texting live once carriers approve";

/**
 * The chip-length claim, for trust bars where the line is
 * "Live in minutes · Month to month" and there is no room for a clause.
 *
 * "Set up today" is honest compression rather than a shorter lie: you do sign up,
 * pick a number and start receiving texts today. What it drops is the implication
 * that OUTBOUND US texting is live today, which is the only part that was wrong.
 * The full claim appears in the same page's body copy, so the chip is a summary of
 * something the reader can check rather than a claim standing alone.
 */
export const ACTIVATION_CHIP = "Set up today";

/**
 * The phrase this replaced. Exported so a test can assert it is gone rather than
 * trusting that a sweep caught every copy.
 *
 * That test is the durable half of this fix. #437 reported the phrase on the blog
 * CTA and the feature pages; a case-insensitive sweep found SIXTEEN copies across
 * nine files, because every trade page carried it twice (a trust-bar chip and a
 * closing subhead) and nobody had grepped. A constant plus a test is what stops the
 * seventeenth.
 */
export const RETIRED_ACTIVATION_CLAIM = "live in minutes";
