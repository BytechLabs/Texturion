# Data processing agreement — DRAFT, not published (#285)

**Status: DRAFT AWAITING REVIEW.** This is the one item on #285 that is a
**contract** rather than a description. Everything else that issue asks for
describes something already true and can be checked against the code; a DPA
makes forward-looking promises about how we will behave, and publishing it
binds the company to them.

So it is written and it is not published. The drafting was the work; the
decision to offer it to customers is the founder's, and it deserves a read by
somebody who does this for a living before it goes on the site. **Nothing here
should be sent to a buyer until that happens.**

**What this draft is good for meanwhile:** a buyer who asks "do you have a DPA"
can be told one is drafted and what it says, and the clauses below are already
the honest answer. It is a faster route to the facts than an empty promise to
"look into it".

---

## How this was written

Every factual clause cites where the fact lives, and the citation is the point:
a DPA that describes a practice the product does not have is worse than no DPA,
because it is a written misrepresentation rather than a gap. Where the honest
answer is "we do not do that", the clause says so instead of reaching for
standard wording.

The three clauses most contracts overstate — **data residency, completeness of
deletion, and audit rights** — are the three this draft deliberately
under-promises on, because that is what is true here.

---

## 1. Roles

Loonext (BytechLabs) acts as a **processor** in respect of the customer content
a workspace sends and receives — messages, contacts, call recordings,
voicemail — and as a **controller** in respect of its own account and billing
records.

The customer is the controller of their workspace's content and is responsible
for having a lawful basis to contact the people in it. That responsibility is
already stated in the acceptable use policy and is not softened here.

> Source: `/legal/aup`, `/legal/privacy`

## 2. Subject matter, duration, nature and purpose

- **Subject matter:** operating a shared business phone number — sending and
  receiving SMS/MMS, placing and answering calls, storing the resulting
  conversation history, and the automated messages the workspace configures.
- **Duration:** for as long as the workspace exists, plus the deletion window in
  §9.
- **Nature and purpose:** providing the service the customer subscribed to. Not
  for our own analytics beyond the counts described in §5, and not for training
  models — see §7.

**Categories of data subject:** the customer's own crew members, and the
customer's customers who text or call the workspace's number.

**Types of personal data:** enumerated per field and per platform, with the
reason for each, in `docs/DATA-INVENTORY.md`. That document rather than this
clause is the authoritative list, because it is maintained against the schema.

> Source: `docs/DATA-INVENTORY.md` §"Data collected"

## 3. Processing on documented instructions

We process customer content to provide the service and on the customer's
instructions, which for this product are expressed through the workspace's own
settings — who is on the crew, which automations are on, what the away message
says.

We do not sell customer content, and we do not use message bodies to build
profiles or advertising audiences.

## 4. Confidentiality

Access to production data is limited to people who need it to operate the
service. Credentials are held as encrypted secrets and never in the repository;
the database key is independently revocable and the payment key is restricted
to billing scope.

**The size of that population is not stated here**, because no document in this
repository records it and a number invented for a contract is the kind of
clause this draft exists to avoid. It is a fair question for a buyer to ask and
it should be answered from fact before this is signed.

> Source: `docs/SECURITY-QUESTIONNAIRE.md` §3

## 5. Security measures

- Encryption in transit and at rest.
- Message content is excluded from analytics and from error reporting. This is
  enforced rather than intended: Sentry's `beforeSend` strips request bodies and
  redacts phone numbers, `sendDefaultPii` is off, and there is no session replay
  on conversation pages.
- Tenant isolation is performed by the API on every request. **It is one layer,
  not two** — the Worker's database key bypasses row-level security, so an
  unscoped query in our own code would be executed as written. SPEC §10 says so
  in those words rather than calling it defence-in-depth.
- Analytics hold UUIDs, counts and feature events only.

**A caveat this clause must carry.** Customer data reached our error-reporting
tool between 2026-07-01 and 2026-08-09, through breadcrumbs that recorded full
outbound URLs including query strings. The cause is fixed and nothing is being
added; the events age out by 2026-11-07 at the outside. It is recorded as R10
in `docs/ACCEPTED-RISKS.md`. A DPA signed before that date should say so rather
than let the reader assume otherwise.

> Source: SPEC §10, `docs/ACCEPTED-RISKS.md` R10

## 6. Sub-processors

Current list, kept public and current: **Cloudflare, OpenAI, PostHog, Resend,
Sentry, Stripe, Supabase, Telnyx, and Cloudflare Workers AI.**

> Source: `/legal/subprocessors`

We will publish changes to that list on the same page. A customer who objects
to a new sub-processor may terminate; there is no mechanism by which we could
run the service for one workspace on a different set of vendors, and pretending
otherwise would be a clause we could not honour.

## 7. AI processing

Customer message text and voicemail audio are processed by Cloudflare Workers
AI and OpenAI for the features the workspace has enabled. The disclosure states
the **routing** rather than implying containment, because inference cannot be
confined to a country.

Customer content is not used to train models. Cloudflare states this for
Workers AI in terms we quote verbatim rather than paraphrase.

> Source: `docs/DATA-INVENTORY.md` §AI, `packages/shared/src/ai-disclosure.ts`

## 8. Personal data breach

We notify affected workspaces **within 72 hours of confirming** a breach of
security safeguards that creates a real risk of significant harm, with what we
know and what we do not yet know. Where we are a processor for the customer's
data, we notify the customer and the customer notifies the people affected and
the regulator.

> Source: `/security`

## 9. Deletion and return

- A customer can delete their workspace. Deletion is reversible for **30 days**
  and irreversible after that.
- **Deletion is not complete in every store, and the exceptions are enumerated
  rather than implied.** Today that is one: a message sent through the website
  contact form is held outside any workspace, is deleted on its own schedule
  after a year, and can be removed sooner on request.
- Contacts can be exported. **A broader export does not exist yet** (#304).

> Source: `packages/shared/src/deletion-promises.ts`
> (`DELETION_GRACE_DAYS`, `DELETION_GAPS`), `docs/DELETION.md`

## 10. Audits and information

We will answer a security questionnaire and provide the information in
`docs/SECURITY-QUESTIONNAIRE.md` and the documents it cites.

**We do not offer on-site audits or penetration tests of production by
customers**, and there is no SOC 2 or ISO 27001 report to substitute for one.
A clause granting audit rights we have no way to service would be the kind of
promise this whole document is written to avoid.

> Source: `/security`, `docs/SECURITY-QUESTIONNAIRE.md` §"What we do not have"

## 11. International transfers

Data is stored in the **United States**. This is a statement of where it is,
**not a residency guarantee** — we do not offer one, and AI inference in
particular cannot be confined to a country. The cross-border disclosure
required under PIPEDA and Quebec's Law 25 is on the privacy page.

> Source: `/legal/privacy`, `docs/ACCEPTED-RISKS.md` R4

## 12. What this document does not do

- It does not claim a certification we do not hold.
- It does not promise a residency, an audit right, or a completeness of
  deletion that the product cannot deliver.
- It does not replace the terms of service; where the two disagree, that is a
  bug in this document and the terms win until it is fixed.

---

## Before this is published

1. **Legal review.** This is a contract drafted from engineering facts. The
   facts are right; the contractual framing needs somebody qualified.
2. **Decide the R10 disclosure.** §5 carries it. Whether a signed DPA should
   recite a historical incident is a judgement call, and the alternative is to
   wait until the window ages out on 2026-11-07 and drop the paragraph.
3. **Decide where it lives.** The other legal documents are pages under
   `/legal/`; a DPA is more often a PDF attached to an order form. Either is
   defensible and the choice should be recorded in `docs/DECISIONS.md`.
4. **Re-check every citation.** Each one was true when written. The document is
   only as honest as its most stale line, which is exactly why they are cited
   rather than absorbed.
