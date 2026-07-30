# Compliance content: the rule, the audit, and who signs it off (#436)

The blog answers questions a tradesperson actually types, and several of those
questions are legal ones. That is the right content to write. It also carries a
liability a feature post does not: **where the advice and the product diverge, the
post becomes evidence.**

Not evidence for us. If a customer is fined for a missed opt-out, the discovery
question is what their vendor told them, and a post saying *"honor it the moment you
see it"* from a product that could not see it answers that question badly. The good
posts make it worse rather than better: careful, well-sourced content is what gets
relied on, and what gets relied on is what gets quoted.

---

## 1. The rule

> **Every post that tells a reader to DO something must say which half the software
> does and which half the human still owns.**

One or two sentences. It makes the post better, not weaker — the same instinct that
has `llms.txt` say *"No phone menus, queues, or call-center features."* A post that
names its own tool's limits is more credible, and it removes the only version of this
that hurts.

**"We do it for you" and "you must do this" are both fine. What is not fine is
advice that reads as either when it is the other.**

---

## 2. Audit, 2026-07-29

Checked every post giving compliance advice against what the product actually does,
which is the check that matters — the law they already get right.

| Post | Advice | Product | Action |
|---|---|---|---|
| `tcpa-rules-texting-customers-service-business` | "treat any plain-English opt-out exactly like STOP… Honor it the moment you see it" | **Now backed.** #396 shipped `opt-out-language.ts`: plain-English opt-outs are FLAGGED on the thread. It deliberately never auto-blocks. | Disclosure added: keywords are blocked for you, a sentence is flagged for you and needs one confirming tap, and why that asymmetry is deliberate. |
| `casl-text-message-rules-canada` | "Honor STOP immediately, and make sure it stays honored across the whole crew" | Backed for the keyword; the plain-English half was not mentioned at all, in a paragraph whose whole setup was the human failure mode. | Flagging added to the same paragraph. |
| `casl-text-message-rules-canada` | "no registration, no fee, no waiting" for CA→CA | **True and verified** (#379: Telnyx's own compliance guide documents no CA long-code registration). But Canadian carriers filter A2P on ten-digit numbers at their discretion and have said they will not stop. | **This was the live divergence, and #436 did not catch it.** The a2p post already carried the filtering caveat; this post repeated the claim without it. Caveat added. |
| `a2p-10dlc-registration-honest-timeline` | same CA→CA claim | same | Already carried the caveat. No change. |
| `customer-texted-stop-now-what` | "the block should stay until their START arrives", "don't clear it yourself" | Backed exactly. An opt-out cannot be lifted by us by design. | No change. |

**Both divergences #436 named are closed** — one by the product shipping (#396), one
by a caveat added when #379 resolved. The audit's value was the third row: an
inconsistency **between two posts**, where one carried a caveat the other did not.
That is the failure mode to expect next, and it is why this is a checklist rather
than a one-time fix.

---

## 3. When a post has to be revisited

Compliance posts are a **descriptive surface** — one row of the checklist in
`docs/DESCRIPTIVE-SURFACES.md`, which #434 asked for and which lists every
artifact a shipped feature may need to tell. Re-read the posts when:

- **the product gains or loses a compliance behaviour.** #396 turned an unbacked
  sentence into a backed one; the reverse is just as possible.
- **a carrier or regulator changes a rule we cite.** #379 is the worked example: the
  claim survived, the *reason* changed, and the caveat is what the post needed.
- **a fact appears in two posts.** The CA→CA claim was in two. Whichever gets edited
  is the one that stops matching.
- **a post links a feature page.** If the feature changes, the post inherits it.

**Search for the CLAIM, not the post.** `grep -rn "no registration" blog/` finds
every copy; opening the one you remember finds one.

---

## 4. Who signs it off

**A feature post that goes stale is embarrassing. A compliance post that goes stale is
discoverable.** They do not deserve the same review.

- **Feature and how-to posts** — normal review. Wrong is fixable.
- **Posts stating a legal obligation, a timeline, a fee, or a carrier rule** — the
  founder reads the whole post before it ships or after it is edited, against this
  document's rule, and specifically answers: *does the product do every "you should"
  in here, and where it does not, does the post say so?*

**No compliance post ships or gets edited on an agent's judgment alone.** That is not
about the writing; it is about who is answerable for a sentence a lawyer might read
back. This document exists so that review takes minutes rather than a re-derivation.

**And nothing here is legal advice, including this file.** The posts state what the
product does and cite published sources for the rest. Where a post asserts a legal
conclusion rather than a documented rule, that is the sentence to challenge first.
