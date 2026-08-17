import { PLAN_PRICING, US_REGISTRATION_FEE_DOLLARS } from "@/lib/api/types";
import { BLOG_POSTS, blogPostPath } from "@/lib/marketing/blog";
import { LIVE_ROUTES, absoluteUrl } from "@/lib/marketing/site";

/**
 * #451 — llms.txt, built from the same data the site renders from.
 *
 * TWO FILES DESCRIBED THIS PRODUCT TO MACHINES and only one could go stale.
 * `sitemap.ts` derives from `BLOG_POSTS`, so publishing a post cannot leave it
 * behind. `public/llms.txt` was a static asset typed by hand, and per #434 it
 * drifted within a fortnight: current through the calls feature, with zero
 * mentions of AI, transcripts, mentions or Lou a fortnight after all four shipped
 * to three clients. Same repo, same audience, ten lines apart in the same
 * directory. The only difference was that one was generated.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS DERIVED, WHAT IS INTERPOLATED, AND WHAT STAYS AUTHORED.
 *
 * Not all of it should be generated, and #451 says so itself: the honest-omissions
 * voice — "No phone menus, queues, or call-center features" — is the file's best
 * feature and a judgement rather than data. Generating it would cost the thing
 * worth keeping. So the split is by KIND of fact, not by section:
 *
 *   DERIVED. The enumerable sets. Every blog post comes from `BLOG_POSTS`, so
 *   publishing one updates this file with no human step, exactly as it updates the
 *   sitemap. Every URL comes from `LIVE_ROUTES`, so a route rename cannot leave a
 *   dead link.
 *
 *   INTERPOLATED. The numbers, read from `PLAN_PRICING` and
 *   `US_REGISTRATION_FEE_DOLLARS` inside sentences a person wrote. A price change
 *   updates the prose without anybody rewriting it, and templating whole sentences
 *   to achieve the same thing would have produced robotic copy for no gain.
 *
 *   ONLY WHERE A DIGIT READS NATURALLY, though. "Two numbers on Pro" is left as the
 *   authored word: interpolating it produced "2 numbers on Pro", which is worse
 *   copy, and a sentence that spells a number out needs rewording if the number
 *   ever changes anyway. The Pricing section states the same count as a digit and
 *   is interpolated, so the fact is still derived somewhere.
 *
 *   AUTHORED. The prose, unchanged and still hand-edited — including the page
 *   descriptions. A bare link is worse for the reader than a line saying why to
 *   open it, so those are declared with the routes rather than generated.
 *
 * THE ONE THING A TEST COVERS RATHER THAN DERIVATION: the AI monthly caps live in
 * the API Worker (`SUGGEST_REPLY_MONTHLY_CAP` and friends) and the web app cannot
 * import across that boundary. `llms-txt.test.ts` reads them out of the API source
 * instead — which is how two of the three were caught wrong while #434 was being
 * closed. Said out loud so nobody assumes the caps move on their own.
 */

/**
 * The pages worth pointing a machine at, and the one line that says why.
 *
 * Exhaustive over `LIVE_ROUTES` BY TYPE: adding a route fails to compile until this
 * object says what to do with it. `null` means deliberately not listed, with the
 * reason beside it, so an omission is a decision rather than an oversight — the
 * failure #434 was actually about.
 */
const PAGE_NOTES: Record<keyof typeof LIVE_ROUTES, string | null> = {
  home: null, // the file opens with the site URL; a second link adds nothing
  pricing:
    "the interactive plan builder with the live total, both plans, and every cost on one page",
  // #321: what SHIPPED, dated, newest first. Listed because "is this product
  // still being worked on" is a question a buyer asks and an answer we have.
  whatsNew:
    "what shipped recently, in plain English and dated; never what is planned",
  featuresSharedInbox: "every customer text in one inbox the whole crew can see",
  featuresCalls:
    "calls on the same number: the crew answers in the app, voicemail is written down, and missed callers get a text back",
  featuresAssistant:
    "Lou drafts replies, writes voicemails down, and fills in a job's address and due date; a person always sends",
  featuresTasks:
    "turn a customer text or call into a job with an owner, a due date and an address, worked from a list, board, calendar or map",
  featuresContacts:
    "one timeline per customer holding every text, call, voicemail and file, plus their address, consent record and your private notes",
  featuresBusinessNumber:
    "a local number that belongs to the business, new or ported in free",
  featuresCompliance: "registration, opt-outs, and consent, handled by the product",
  featuresTemplatesAndTags: "saved replies and tags that match how you sell",
  canada: "Canadian businesses text Canadian customers the same day they sign up",
  security: "tenant isolation, encryption, and what stays out of logs",
  // #238/#285: listed rather than grouped with the legal line. "Is it
  // accessible" is a question a buyer asks outright, and the answer names the
  // test behind every claim — which is the part worth pointing a machine at.
  // #285: the DPA a compliance function asks for by name. Listed rather than
  // grouped: its absence is what stalls a deal, so its presence should be
  // findable without asking us.
  dpa:
    "the data processing agreement: roles, sub-processors, 72-hour breach notification, deletion, and the three things we do not promise because the product cannot deliver them",
  accessibility:
    "what we verify about accessibility and what we do not: WCAG 2.2 AA criteria enforced by named tests, the gaps stated plainly, and no third-party audit claimed",
  status: "live service status",
  contact: "reach support",
  blog: null, // has its own heading below, with every post
  terms: null, // grouped on the legal line
  privacy: null, // grouped on the legal line
  messaging: null, // grouped on the legal line
  fairUse: null, // grouped on the legal line, and named in Pricing above
  refunds: null, // grouped on the legal line
  aup: null, // grouped on the legal line
  cookies: null, // grouped on the legal line
  subprocessors: null, // named inline in the AI section, where it matters
  deleteMyData: null, // a store-filed URL for app reviewers, not a reader page
  compareIndex: null, // the two head-to-heads are what a reader wants
  compareHeymarket: null, // grouped on the comparison line
  compareQuo: null, // grouped on the comparison line
  forPlumbers: null, // grouped on the trades line
  forLandscapers: null, // grouped on the trades line
  forCleaners: null, // grouped on the trades line
  forHvac: null, // grouped on the trades line
  forSalons: null, // grouped on the trades line
  forContractors: null, // grouped on the trades line
};

/** The label each noted page is linked as. Separate so the note reads as prose. */
const PAGE_LABELS: Partial<Record<keyof typeof LIVE_ROUTES, string>> = {
  pricing: "Pricing",
  featuresSharedInbox: "Shared inbox",
  featuresCalls: "Calls and voicemail",
  featuresAssistant: "Lou, your assistant",
  featuresTasks: "Tasks",
  featuresContacts: "Contacts",
  featuresBusinessNumber: "Your business number",
  featuresCompliance: "Compliance built in",
  featuresTemplatesAndTags: "Templates and tags",
  canada: "Canada",
  security: "Security",
  status: "Status",
  contact: "Contact",
};

/** `[Label](url)` for a route, so no URL in this file is typed by hand. */
function link(label: string, route: keyof typeof LIVE_ROUTES): string {
  return `[${label}](${absoluteUrl(LIVE_ROUTES[route])})`;
}

/** Exported for the test: which routes carry their own line. */
export function notedRoutes(): (keyof typeof LIVE_ROUTES)[] {
  return (Object.keys(PAGE_NOTES) as (keyof typeof LIVE_ROUTES)[]).filter(
    (route) => PAGE_NOTES[route] !== null,
  );
}

/** The Pages section: one line per noted page, then the grouped lines. */
function pagesSection(): string {
  const noted = notedRoutes().map(
    (route) => `- ${link(PAGE_LABELS[route] ?? route, route)}: ${PAGE_NOTES[route]}.`,
  );

  const trades = [
    ["For plumbers", "forPlumbers"],
    ["HVAC", "forHvac"],
    ["landscapers", "forLandscapers"],
    ["cleaners", "forCleaners"],
    ["salons", "forSalons"],
    ["contractors", "forContractors"],
  ] as const;

  const legal = [
    ["Terms", "terms"],
    ["Privacy", "privacy"],
    ["Messaging policy", "messaging"],
    ["Acceptable use", "aup"],
    ["Fair use", "fairUse"],
    ["Refunds", "refunds"],
    ["Cookies", "cookies"],
  ] as const;

  const grouped = [
    `- ${trades.map(([label, route]) => link(label, route)).join(", ")}: ` +
      `the product in each trade's own words.`,
    `- ${link("Loonext vs Heymarket", "compareHeymarket")} and ` +
      `${link("Loonext vs Quo", "compareQuo")}: flat per-company pricing against ` +
      `per-user pricing.`,
    `- ${legal.map(([label, route]) => link(label, route)).join(", ")}: the legal ` +
      `pages in plain language. The fair-use page is the one place the concrete ` +
      `texting numbers live.`,
  ];

  return ["## Pages", ...noted, ...grouped].join("\n");
}

/**
 * Every guide, derived. This is the section #451 is really about: publishing a
 * post updates it with no human step, and the summary sentence above the list
 * stays authored because "what these guides are for" is not data.
 */
function blogSection(): string {
  const intro =
    `- ${link("Blog", "blog")}: plain-English guides on customer texting for ` +
    `small service crews. RSS at ${absoluteUrl("/blog/rss.xml")}.`;
  const posts = BLOG_POSTS.map(
    (post) => `  - [${post.title}](${absoluteUrl(blogPostPath(post.slug))})`,
  );
  return ["## Guides", intro, ...posts].join("\n");
}

/** The whole file. */
export function buildLlmsTxt(): string {
  return [PROSE, pagesSection(), blogSection(), ""].join("\n\n");
}

/**
 * The authored prose, verbatim from the file this replaced, with the numbers
 * interpolated. Every word here was written by a person and still is: editing it
 * is editing this constant.
 */
const PROSE = `# Loonext

Loonext is the shared line for small service businesses in the United States and Canada: plumbers, landscapers, cleaners, HVAC, salons, and contractors, from a solo owner to a whole crew. A business gets its own local phone number, either a new one or the number it already has, ported in free. Texts AND calls to that number reach the whole crew: a text becomes a conversation anyone can see, reply to, assign, tag, note and close, and a call rings every teammate in the app so whoever is free answers. Missed calls go to voicemail, get written down, and text the caller back. From there a message or a call becomes a task with a due date, and every customer's texts, calls, voicemails and files sit on one timeline. It replaces running the business off one person's personal cell.

Website: https://loonext.com

## Positioning
- Flat per-company pricing, not per seat: $${PLAN_PRICING.starter.monthlyDollars}/mo covers ${PLAN_PRICING.starter.seats} people; $${PLAN_PRICING.pro.monthlyDollars}/mo covers up to ${PLAN_PRICING.pro.seats}. Bigger crews use the contact-sales Enterprise tier (unlimited seats).
- Transparent and self-serve: see the price, pay, start working the line. No demo, no sales call, no annual contract, no phone number in the nav.
- Month to month. Cancel anytime from billing settings. 30-day money-back guarantee (full first-invoice refund, registration fee included).
- Leaving is stated up front, not just permitted: cancel yourself with no retention call, nothing is charged after, and a person is reachable inside the app on the way out. The number is held 30 days in case you come back, then released to the phone company and can be reassigned to another business, so people who saved it eventually reach someone else. Port it out first to keep it. We say the uncomfortable half deliberately; the claim is honesty about the exit, not a painless one.
- Canada-first: Canadian businesses can text Canadian customers the same day they sign up (no US carrier registration needed for Canada-to-Canada).

## Pricing (USD, plus sales tax where applicable)
- Starter, $${PLAN_PRICING.starter.monthlyDollars}/mo: ${PLAN_PRICING.starter.seats} teammates, ${PLAN_PRICING.starter.numbers} local number, texting included under an automated fair-use policy, receiving texts free and unlimited. There is no hard message cap: almost every crew stays well inside fair use, and if a month runs hot, extra texts bill at a small per-text rate, only up to a spending cap you control, with email alerts at 80% and 100% first. The concrete numbers live at https://loonext.com/legal/fair-use.
- Pro, $${PLAN_PRICING.pro.monthlyDollars}/mo: ${PLAN_PRICING.pro.seats} teammates, ${PLAN_PRICING.pro.numbers} local numbers, more texting for a bigger crew on the same fair-use basis, receiving texts free and unlimited.
- Enterprise: unlimited teammates for crews larger than ${PLAN_PRICING.pro.seats}. Contact-sales only (talk to us at support@loonext.com or the contact page); not a self-serve plan, same flat, no-per-user philosophy priced to your size.
- A plain text up to 160 characters counts as one text; longer or emoji texts count as more; the composer shows the count before you send.
- One-time $${US_REGISTRATION_FEE_DOLLARS} fee to register with the phone companies, for US businesses (and Canadian businesses that enable US texting). Charged once, ever, never again after a cancel/return. So a US shop pays $${PLAN_PRICING.starter.monthlyDollars + US_REGISTRATION_FEE_DOLLARS} the first month, then $${PLAN_PRICING.starter.monthlyDollars} every month after. Canadian businesses that don't text US numbers never pay it.
- Spending cap you control, with email alerts at 80% and 100% of your included texting; hit the cap and sending pauses until you raise it (one click for account owners). No surprise bills.
- Storage is free on every plan: files on notes and saved picture messages are kept with no caps, no meter, and no storage add-on. Uploads never pause and inbound pictures never stop being saved because of space.

- Picture messages (MMS) are included on every plan, both directions, nothing to turn on: receiving photos is free, and sending photos draws on the same fair-use texting and overage rules as everything else you send (counting mechanics at https://loonext.com/legal/fair-use).

- Calling is included on every plan, nothing to turn on: incoming calls to your business number ring your crew in the Loonext app (whoever answers first takes the call), callers reach voicemail when nobody can pick up, you call customers back from the app on your business number (they always see the business number), and callers you miss automatically get a text back (your own message) so the job doesn't go elsewhere. Call screening, hold, transfer between teammates, and caller ID name both directions are built in. One pool of generous calling minutes under fair use covers both directions; concrete minute figures live at https://loonext.com/legal/fair-use.

## AI features (on by default, switchable off per feature)
- Lou is the assistant inside Loonext. Every AI feature that produces a SUGGESTION A MEMBER READS arrives ON, and an owner can switch each one off individually in the workspace's AI settings. Saying otherwise would understate what the product does with message text, which is the wrong direction to be wrong in. Exactly one feature is off by default, and it is the one that changes what a stranger hears: voicemail intake (below).
- The caps are per company per calendar month, and they are hard: suggested replies 1,500, voicemail transcripts 500, task details 1,000. Past a cap the feature stops for the rest of that month rather than billing more, and the crew is told which cap it was.
- Suggested replies: Lou drafts a reply to a customer text. A person always reads, edits and sends it. Nothing is ever sent automatically.
- Voicemail transcripts: a voicemail is written down so the crew can read it instead of listening, and search it later.
- Task details: turning a customer text into a task fills in the address and due date from what the customer wrote. These are two switches, not one: the address and the due date can be turned off separately.
- Voicemail intake, OFF by default: Lou reads a voicemail transcript and breaks out what the caller wanted and where, shown above the recording. The greeting is the owner's own text and nothing is appended to it — a crew that wants callers to state the address asks for it in their own greeting. Nothing books anything and nobody is put through a menu.
- The models run on Cloudflare Workers AI, in the same account that hosts the app. Message content and voicemail audio are not used to train models, by Cloudflare's published policy and by ours. What comes back is stored in the workspace like any other message and deleted with it. Details at https://loonext.com/legal/privacy and https://loonext.com/legal/subprocessors.

## Optional add-on modules
- Canadian numbers alongside a US number ($5/mo): the one add-on that exists; coming soon, listed in the catalog but not yet purchasable.

## Keep your existing number (porting)
- Porting in is free and self-serve for US and Canadian local numbers: choose "Bring my number" at signup, or start a port later from Settings → Numbers. Loonext handles the carrier paperwork and shows the port's status the whole way.
- Your number keeps working on your old carrier during the transfer and switches to Loonext on a scheduled cutover date, typically 1 to 7 business days.
- An optional temporary Loonext number is offered to text from while the port completes (off by default).

## The honest US timeline (a trust feature, stated before payment)
- Day one: your number is live and receiving texts; texting Canadian customers works immediately.
- US texting activates after the phone companies approve your business registration, typically 3 to 7 business days (about a week). Loonext files everything the minute you pay and emails you the moment you're approved.
- The registration wait and the one-time $${US_REGISTRATION_FEE_DOLLARS} fee are US-only. A Canadian business texting Canadian customers registers nothing, pays no fee, and never waits; the wait and fee apply only if you also text US numbers.

## Product features
- Shared inbox with per-conversation owner and status (new, open, waiting, closed).
- Snooze a conversation until a time you pick, per person, so a thread you cannot act on today stops cluttering the queue; a customer reply cancels it instantly. Or set a follow-up reminder ("chase this in 3 days if they have not replied"), which cancels itself the moment they do reply.
- Internal notes (marked, never sent to the customer).
- Saved replies (templates) via a "/" shortcut.
- Tags for how you sell (Quote sent, Scheduled, Won, Lost).
- Pictures both ways: receiving photos is free on every plan and sending photos is included on every plan too; every photo is stored free, with no caps.
- After-hours auto-reply: outside your business hours, a message you wrote yourself is sent back automatically (at most once per conversation per burst, so nobody gets spammed).
- Calling included on every plan, both directions: the crew answers in the app, voicemail, call screening, hold and transfer, caller ID name, and missed-call text-back.
- Tasks: turn any customer text or call into a job with a due date, an address and an owner, linked back to the message it came from, so "book the Hendersons for Tuesday" stops living in somebody's head.
- Contacts: one timeline per customer holding every text, call, voicemail and file across every conversation you have ever had with them, plus their address, consent record and private notes.
- Response time, measured: how fast the crew answers a new customer now, against how fast it answered when it started, with the leads nobody answered counted beside the median rather than quietly dropped.
- Search across every message, voicemail transcript and contact; CSV contact import with a dry-run preview and CSV export.
- Works on every phone with no download: a web app you add to your home screen, with push notifications, dark mode, and the same inbox, calls, tasks and contacts as the desktop. There are native iPhone and Android builds, but they are not in the app stores yet, so the honest answer today is the web app.
- Two numbers on Pro (two locations, or an office line and a field line), each with its own inbox.

## Compliance, handled by the product
- Registration with the US phone companies is filed automatically at signup.
- STOP opt-outs are honored instantly; future sends to opted-out numbers are blocked. A "please stop texting me" can be honored with one click, the same way.
- Consent is recorded (name and date) when you start a conversation.
- A quiet-hours check nudges you before starting a late-night conversation (8pm to 8am in the customer's local time), never on replies.
- Messages send exactly as typed: Loonext does not append an automatic identification or opt-out footer to your texts.
- Helps you follow the rules (TCPA in the US, CASL in Canada). It does not make you compliant on its own, and it does not send marketing blasts.

## What Loonext does NOT do
- No mass/broadcast texting, no scheduled campaigns or blast marketing, no review management.
- No cell forwarding and no desk-phone/SIP hardware: calls ring and are placed in the Loonext app itself (the app is the phone, on any phone or computer, mic permission required). No phone menus, queues, or call-center features.
- No CAD billing yet (charged in USD).

## Security & data
- Tenant isolation via row-level security; encryption in transit and at rest.
- Message content, names, addresses, and phone numbers are kept out of analytics and error logs.
- Data is processed in the United States (Supabase on AWS us-east-1).

## Contact
- Support is by email only ([support@loonext.com](mailto:support@loonext.com)), usually within one business day.`;

