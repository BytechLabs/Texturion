# Data processing agreement (#285)

**Status: RECORD, and published at `/legal/dpa` on 2026-08-16.** This is the
agreement itself rather than a plan for one: a customer who signs it is
entitled to hold us to every clause below, which is why each factual one cites
where the fact lives.

Loonext acts as a processor for the customer content a workspace sends and
receives. This is the document to hand a buyer who asks for a DPA.

**It has not been reviewed by outside counsel**, and that is stated here rather
than discovered later. It was drafted from what the product actually does, with
every factual clause citing where the fact lives — which makes it accurate
about the mechanism and unpolished as contract drafting. A buyer whose legal
team wants to redline it is welcome to; the facts will survive the exercise
because they are checkable.

---

## How this was written

Every factual clause cites where the fact lives, and the citation is the point:
a DPA that describes a practice the product does not have is worse than no DPA,
because it is a written misrepresentation rather than a gap. Where the honest
answer is "we do not do that", the clause says so instead of reaching for
standard wording.

The three clauses most contracts overstate — **data residency, completeness of
deletion, and audit rights** — are the three this document deliberately
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
clause this document exists to avoid. It is a fair question for a buyer to ask and
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

**One historical note, and why it is not a disclosure clause.** Between
2026-07-01 and 2026-08-09 our error-reporting breadcrumbs recorded full
outbound URLs including query strings. The cause is fixed, nothing is being
added, and those events age out by 2026-11-07 at the outside. The product was
not publicly available in that window, so the data involved is our own test
traffic and that of workspaces the founder controls — there is no customer
whose data this concerns and therefore nothing for this contract to disclose to
one. Recorded as R10 in `docs/ACCEPTED-RISKS.md`, which is the honest place
for it.

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

## How to keep this true

Every factual clause above cites where the fact lives, and that structure is
the only thing separating this from the kind of DPA that describes what
somebody once intended. The failure mode is quiet: a practice changes, the
contract keeps promising the old one, and nobody notices because a markdown
file has no build.

So it gets one. Citations are covered across every document by
`scripts/check-doc-citations.mjs`, which fails on any cited path that stops
resolving. What needed its own guard is the three clauses this document
deliberately UNDER-promises on, held by
`apps/web/src/app/(marketing)/legal/dpa/dpa-promises.test.ts`:

1. **No residency guarantee** (§11). Storage is US, which is where it is rather
   than a commitment, and inference cannot be confined to a country.
2. **Deletion is incomplete**, with the exception named (§9).
3. **No audit right** we have no way to service (§10).

Those three are the ones a future editor will be tempted to soften, because
each reads as a weakness. Each is the reason a buyer can trust the rest.

**When outside counsel does review this**, the thing to protect is the
citations. A clause rewritten into standard contract language without checking
what the product does is how a DPA stops being true.
