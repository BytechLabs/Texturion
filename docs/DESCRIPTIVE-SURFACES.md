# Descriptive surfaces: what a shipped feature has to tell (#434)

**Status: CURRENT DIRECTION (#323).** Describes how the product works today. Where it disagrees with `docs/DECISIONS.md`, that file wins.

A feature is not finished when it works. It is finished when the artifacts that
tell people it exists know about it.

**#338** asks for a definition of done that names all three clients. This is the
same question aimed at the things that *describe* the product, and the reason it
needs writing down is that the gap has already cost real accuracy four times:

| | What drifted |
|---|---|
| **#389** | `DATA-INVENTORY.md` was updated for the Apple and Google declarations when AI shipped. The public **subprocessors** page was not. Two documents, two audiences, one updated. |
| **#434** | `llms.txt` was current through the calls feature and contained **zero** occurrences of `AI`, `transcript` or `Lou` a fortnight after they shipped — in the one file whose whole job is describing us to machines. |
| **#436** | Two blog posts stated the same CA→CA claim and only one carried the carrier-filtering caveat. |
| **#437** | "live in minutes" appeared in **sixteen** places across nine files, contradicting a post that told readers to distrust exactly that claim. |

Every one of those was found by somebody re-reading, not by a process. The point
of this file is that the answer is **decided rather than remembered**.

**The step that fires is one question** (D63): *does anything outside the app need
to know about this?* If no, that is a complete answer. This file is what "outside the
app" means when the answer is yes.

---

## The checklist

When a customer-visible feature ships, work down this list and decide each row.
Most features touch two or three. "No" is a fine answer; unconsidered is not.

| Surface | Needs a line when | Check |
|---|---|---|
| **`apps/web/src/lib/marketing/llms-txt.ts`** | the feature changes what the product *is* or *does not do* | it is the whole submission to the "ask an assistant" channel. State the limits too — the file's strength is that it says what we do not do. **Blog posts, page links and prices now derive** (#451/D84), so those need nothing; what still needs a human is the narrative — a new capability, or a new deliberate absence. |
| **Marketing copy** (home, features, trade pages) | the feature is a reason to buy | search for the **claim**, not the page (see below) |
| **Comparison pages** (`compare/*`) | the feature is a *differentiator* | needs a **sourced** competitor fact, not an assumption. Do not add a row you cannot cite. |
| **Pricing / plan copy** | it has a cap, a fee, or a plan gate | a cap stated wrong is worse than a cap omitted |
| **`legal/privacy`** | it processes customer content in a new way | |
| **`legal/subprocessors`** | a new third party sees customer data | this is the #389 row. It is public and it is legally load-bearing. |
| **`DATA-INVENTORY.md`** | the store declarations change | Apple and Google ask separately from the privacy page |
| **Blog posts giving advice** | the feature backs, or fails to back, an existing "you should" | `docs/marketing/COMPLIANCE-CONTENT.md` owns this one |
| **`docs/DECISIONS.md`** | a decision was made that the code alone does not explain | |

---

## Two rules that do the actual work

**1. Search for the CLAIM, not the page.** `grep -rni "no registration" apps/web/src`
finds every copy. Opening the page you remember finds one. #437 was sixteen copies
because nobody grepped, and #436 was two posts where only one had been edited.

**2. Prefer a constant with a test over a careful edit.** A default that is true
everywhere needs no maintenance; a default that is wrong somewhere plus overrides
wherever anybody noticed is how #385's `$29` lost its "one to three seats"
qualifier. Where a claim is a number, read it from the source that enforces it:

- `lib/marketing/activation.ts` — the activation claim, with a test that sweeps the
  marketing tree for the retired phrase.
- `llms-txt.test.ts` — reads the AI monthly caps out of the API constants that
  enforce them, so a stale number fails rather than ships. **This one caught two of
  three caps wrong while being written**, which is the argument for it.

---

## The direction to be wrong in

When a descriptive surface is inaccurate, it matters *which way*.

`llms.txt` said the AI features were **"opt-in, off by default"**. All four default
to on — `20260723020000_ai_settings_default_on.sql` flipped enrichment deliberately.
So the file understated what the product does with message text, which is the one
direction a privacy-adjacent claim must never be wrong in. The omission #434
reported was the smaller half of that bug.

**Overstating a limit is a documentation error. Understating what you do with
customer data is the other thing.** When in doubt, describe the product as doing
more with the data and less for the customer than you think it does, and let the
correction be in the flattering direction.
