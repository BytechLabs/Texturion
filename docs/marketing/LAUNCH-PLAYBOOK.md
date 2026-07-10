# Loonext Launch Playbook (#127)

The post-launch distribution plan. The product is live; nobody knows about it.
This document is the founder's execution checklist: every channel below was
verified against the live web on 2026-07-10 (103 directories checked, 23 found
dead or defunct, plus four discovery sweeps: trade communities, review
platforms, the 2026 launch-platform landscape, and the SEO foundation). Sources
and raw per-channel notes live in the research run; the actionable output is
here.

Companion work shipped with this doc: the `/blog` content engine on the
marketing site (12 launch articles, RSS at `/blog/rss.xml`, sitemap-integrated).

Two ground rules, from the research:

1. **Launch platforms reach makers, not plumbers.** Product Hunt, Show HN,
   Uneed, and the directories are a domain-authority and credibility campaign
   (roughly $0 to $50 and a few hours), not customer acquisition. Treat them
   accordingly and do not over-invest.
2. **The buyers are in communities with strict anti-promo rules.** Reddit,
   Facebook trade groups, and forums are where owners actually are, and every
   one of them bans drive-by promotion. The playbook there is answer-first,
   disclose always, roughly 90% participation to 10% mention, with 2 to 4 weeks
   of genuine history before any product mention.

One product caution before pushing Canadian channels hard: Canadian number
ordering is currently blocked at the Telnyx account level (needs the account
upgrade). The Canada-first story is real for Canadian businesses on US-capable
flows, but resolve the CA ordering block before spending the Canada wedge.

---

## 1. Week-one checklist (about half a day total)

SEO foundation (all free, founder accounts required):

- [ ] Google Search Console: add a **Domain** property for loonext.com, verify
      via a TXT record in Cloudflare DNS (never delete that record), submit
      `sitemap.xml`, then Request Indexing on the top 10 pages (home, /pricing,
      the four /features pages, /canada, /blog, and the two /compare pages).
- [ ] Bing Webmaster Tools: sign in and use **Import from Google Search
      Console** (one click, no separate verification). Bing's index feeds
      ChatGPT Search and Copilot; its free AI Performance report shows AI
      citations. Grab an IndexNow API key while there.
- [ ] Cloudflare **AI Crawl Control** audit: Cloudflare blocks AI crawlers by
      default for domains onboarded after July 2025, regardless of robots.txt.
      Explicitly allow: OAI-SearchBot, ChatGPT-User, GPTBot, ClaudeBot,
      Claude-User, PerplexityBot, Perplexity-User, Google-Extended, Bingbot,
      Applebot. Then verify by asking Perplexity or ChatGPT to read
      https://loonext.com/pricing.
- [ ] Cloudflare Caching → Configuration → toggle **Crawler Hints** ON
      (IndexNow pings Bing and friends on content changes; Google ignores it).
- [ ] Cloudflare **Web Analytics**: add loonext.com (free, cookie-free,
      ad-blocker-proof second lens next to GA4; our own Sentry history proves
      the ad-blocker blind spot is real).
- [ ] Ahrefs Webmaster Tools (free tier): verify via the GSC connection, run
      the site audit, turn on backlink alerts.

Review platforms (the highest-authority free listings; one submission each):

- [ ] **Capterra / GetApp / Software Advice**: one free vendor submission at
      capterra.com/vendors covers all three (G2 acquired the trio from Gartner
      in Feb 2026; the one-submission model still operates). Category: SMS
      Marketing Software (that is where Heymarket, Textline, Podium, and
      Salesmsg live; there is no shared-inbox-for-SMS category). Disclose the
      flat $29/$79 pricing explicitly; flat per-company pricing is the
      differentiator in a per-seat category. Free listings sort below
      sponsored by default but rank organically under Highest Rated and Most
      Reviews, so reviews are the lever, not payment.
- [ ] **G2**: search g2.com for Loonext first; claim the profile if one was
      auto-created, otherwise create one (needs a company-domain email,
      1 to 3 business days review). Same category. G2 grids rank by review
      score, not spend. Skip every paid tier.
- [ ] **Trustpilot** (defensive): claim the loonext.com domain profile free.
      Anyone can start a Trustpilot page for a domain; unclaimed plus one angry
      review equals the top result for "Loonext reviews". Free plan includes 50
      review invitations a month. Trustpilot bans incentives entirely; invite
      every customer the same way.

High-value free directories (backlinks and alternatives pages, ~15 min each):

- [ ] **SaaSHub** (saashub.com/submit): list, verify, and mark OpenPhone,
      Heymarket, Podium, and Google Voice as alternatives so Loonext appears on
      their "alternatives" pages, which real buyers search.
- [ ] **AlternativeTo** (alternativeto.net): create the account NOW; a
      one-week account-aging rule applies before you can submit. Then list
      Loonext as an alternative to OpenPhone, Heymarket, Podium, Google Voice.
- [ ] **Uneed** (uneed.best): book the free launch slot immediately; the free
      queue runs weeks out. DR ~75 dofollow, listings persist past launch day.
- [ ] **Crunchbase** (crunchbase.com/add-new): free company profile. Feeds
      knowledge panels, AI answers, and press lookups.
- [ ] **StartupBase** (startupbase.io): free tier, solid DR ~45 dofollow link.

Site follow-ups (code, already shipped or trivial):

- [x] `/blog` with 12 launch articles, RSS, sitemap integration (this change).
- [ ] Add `sameAs` array to the Organization JSON-LD as official profiles get
      created (LinkedIn, X, Crunchbase, G2, Capterra). Do this after the
      profiles exist, one commit.
- [ ] Run home and /pricing through search.google.com/test/rich-results and
      validator.schema.org; fix warnings if any.

## 2. Month-one checklist

Launch platforms (one well-prepared shot each, maker audience, SEO value):

- [ ] **Product Hunt**: treat as a 4 to 6 week project, launch once. 12:01 AM
      PT; consider a weekend (lowest competition; a niche B2B tool will not win
      a weekday, and "Top 5 of the day" reads the same on a badge). Featured
      rate is ~10% and the algorithm rewards engagement depth over vote
      spikes; vote rings are punished. Drafts in section 5.
- [ ] **Show HN**: prerequisite first: something readers can try WITHOUT
      signing up (a live demo or sandbox inbox). A signup-wall landing page
      gets flagged as not a Show HN. The angle HN likes: the honest telecom
      war story (A2P registration, STOP handling, Canada same-day, double-charge
      fail-safes). Tuesday or Wednesday, 7 to 9 AM PT. Draft in section 5.
- [ ] **Microlaunch** (microlaunch.net): free; launch early in a calendar
      month for the full month of ranking time.
- [ ] **Fazier** (fazier.com): DR ~82 dofollow, but the free tier requires
      embedding their badge on our site, which the design system forbids
      (footer Law 1: no credits of any kind). Either pay the $19.99 Lite tier
      or skip. Do not add the badge.
- [ ] **Tiny Startups** (tinystartups.com/launch): free; enforced 10-word
      pitch: "One business number, one shared text inbox for service crews."
- [ ] **Peerlist Launchpad** (peerlist.io/launchpad): free; create a real
      founder profile first; launches start Mondays, week-long voting.
- [ ] **Indie Hackers**: skip the bare product page; post a milestone/lessons
      thread instead. Draft in section 5.
- [ ] **SourceForge** business directory (sourceforge.net/software/vendors):
      free listing, ~20M monthly visitors, mirror the Capterra copy.
- [ ] Second-tier free directories, one sitting, reuse the same copy kit:
      Promote Project (dofollow DR ~48), Startup Ranking (DA ~74, ~60-day
      queue), SaaSWorthy, CrozDesk (vendor side now at vendor.revleads.com),
      Alternative.me, Awesome Indie, SnapMunk, Startup Buffer, Startup Stash,
      Discover Cloud, Startup Beat (free editorial pitch, 6-sentence pitch
      plus screenshot), TechPluto (free form, lottery ticket, do not pay).

Community entry (start the clock now; mentions come weeks later):

- [ ] Join and START PARTICIPATING (no product mentions yet): r/sweatystartup,
      r/smallbusiness, the HVAC Business Owners & Contractors Facebook group,
      r/CanadaSmallBusiness. Re-read each community's pinned rules in-app
      before the first post. Full norms in section 4.
- [ ] LinkedIn founder profile: 2 to 3 native text posts a week (drafts in
      section 5). This is the ONE channel from the launch circuit where
      trades-business owners actually exist. Personal profile, not a company
      page (~2.75x the reach).
- [ ] X founder account in maintenance mode: 2 to 3 build-in-public posts a
      week, engage with the SMB/sweaty-startup sphere. Purpose: warm
      supporters for the PH launch and messaging tests, not direct sales.

## 3. Month-two-and-later checklist

- [ ] TrustRadius free profile (enterprise-skewed; set and forget; ignore the
      $30k/yr sales pitch).
- [ ] SoftwareSuggest free listing (India-skewed; citation breadth only).
- [ ] Webwiki, eBool, Postmake, KitDB, Getworm, growingpage, Startups List,
      All Startups Info: alive but low-value; only if there is idle time.
- [ ] ContractorTalk: the only channel with a sanctioned paid vendor path
      (free-account promotion is an explicit bannable offense). Ask for
      Supporting Vendor pricing; decide when there is revenue to justify it.
      Same operator and rules at LawnSite and PlumbingZone.
- [ ] Alignable free company profile (9M+ SMB owners incl. Canada; value is
      the citation and Canadian reach; do not buy Premium).
- [ ] DEV.to: publish the engineering war stories (Workers, Telnyx, TCPA/CASL
      plumbing) with canonical_url pointing at the loonext.com blog.
- [ ] Press: skip the mass tip lines (TechCrunch, Mashable, etc. verified alive
      but realistic odds for a niche bootstrapped SaaS are near zero). The one
      press-shaped thing worth doing: pitch trade-media newsletters and
      "best texting app for contractors" listicle authors AFTER there are
      customer reviews to cite. SuperbCrew and Startup Beat accept free
      startup Q&As; fine as backlinks.

Do NOT do (verified dead, ineligible, or wrong for us):

- **Google Business Profile / Bing Places**: online-only SaaS is ineligible
  (in-person contact required). Faking an address risks suspension and brand
  damage. The compliant angle: content about GBP for OUR customers (they live
  on it).
- **AppSumo lifetime deals**: buyers exist but LTD economics are an unbounded
  liability for a product with perpetual per-message carrier costs.
- **BetaList**: pre-launch products only (we launched 2026-07-08), and the
  free queue is effectively gone.
- **Dev Hunt** (dev tools only), **There's An AI For That** (AI products
  only), design galleries (Land-book, Sidebar, Designer News: wrong audience).
- **Dead or defunct, do not waste time**: Launched!, Prefundia, Makerlog,
  SideProjects.net, Betafy, Roast or Toast, Appvita, eBool*, Feed My App,
  Appoid, Apps 400, Hackerspad, StartUpLift, Startup 88, Startup Lister,
  Startup Benchmarks, 10Words, Tech^Map, Startup Dope, Apps Listo,
  AppsThunder, FeedMyStartup, Netted, The Tech Block, Techli, Pando
  (*several were unreachable rather than confirmed dead; if one resurfaces,
  it is a 10-minute decision, not a priority).
- **Vendor-owned communities** (Housecall Pro Superpro, Jobber ecosystem):
  listening only, never post. Their complaint streams (per-seat pricing,
  texting buried in a big FSM suite) are positioning ammunition for use
  elsewhere.
- Anywhere: no vote buying, no upvote pods, no undisclosed founder mentions,
  no incentivized Trustpilot reviews (bans them outright; Capterra caps
  incentives at $25, G2 at $100 via its administered campaigns only).

## 4. Community norms cheat sheet

The universal rules: find existing conversations, answer completely and
honestly (including "you don't need a paid tool for that" when true), disclose
with every mention, keep participation to promotion around 90/10, and build 2
to 4 weeks of history before the first mention. Reddit blocked automated rule
fetching during research; re-check pinned rules in-app before posting.

Standard disclosure line (adapt, never skip):

> Full disclosure: I built Loonext, so I'm biased. The honest comparison:
> [genuinely honest comparison including free options].

| Channel | Reality | Play |
| --- | --- | --- |
| r/sweatystartup (~207k) | Purest ICP on Reddit; famously hostile to ads | Answer phone-setup, Google Voice limit, and personal-cell threads. Founder story post only after weeks of history |
| r/smallbusiness (~2.5M) | Promo only in designated weekly threads; blog links banned | Answer A2P confusion, "why are my texts blocked", TCPA threads. Weekly thread for the one allowed plug |
| HVAC Business Owners & Contractors (FB) | Owner-level software-recommendation threads happen organically | Join as founder, answer like a peer, mention only when asked, disclose |
| Home Service Expert + guru groups (FB) | Growth-minded owners; hosts sell coaching; cold vendors removed | Metrics-and-systems contributions; never pitch cold |
| r/CanadaSmallBusiness, r/EntrepreneurCanada | Friendlier to disclosed local founders; CASL confusion is live pain | The same-day-texting vs US-registration-wait wedge, CASL plain-English answers |
| Salon owner FB groups | Coach-run; salons often have booking-app SMS already | Angle: two-way conversational texting and one shared front-desk number, not blast reminders |
| Trade-pro subs (r/HVAC, r/Plumbing) | Techs, not owners; zero promo tolerance | Listening and language mining; answer "going out on my own" setup threads only |
| ContractorTalk / LawnSite / PlumbingZone | Paid vendor status REQUIRED to promote; explicit rule | Free lane is individual participation with zero mentions; paid lane is a later decision |
| X / LinkedIn | Self-promo is native; risk is indifference, not bans | Build in public; LinkedIn is the only launch-circuit channel with real buyers |

## 5. Copy kit (ready to paste)

Everything below is verified against BRAND-MESSAGING.md and llms.txt. House
rules apply everywhere: no em-dashes, plain language, nothing invented.

**Name:** Loonext
**URL:** https://loonext.com
**Tagline (40 chars):** One number. One inbox. Your whole crew.
**10-word pitch:** One business number, one shared text inbox for service crews.
**Category:** SMS Marketing Software (the industry's synonym for business
texting; request Small Business segment where offered)
**Suggested topics/tags:** business texting, shared inbox, SMS, small business,
home services, field service, Canada

**One-liner:**
We help small service crews answer every customer text, from any phone,
without living on one person's personal cell or paying per seat.

**160-character description (meta/directory short):**
One local number and one shared text inbox your whole crew works from any
phone. Flat $29/mo for the team, compliance built in, US and Canada.

**60-word blurb (directory medium):**
Loonext gives your small service business one local phone number and one
shared text inbox your whole crew works from any phone. Every customer text
becomes a conversation anyone can see, reply to, assign, and close. Flat
pricing for the whole team ($29/mo Starter), month to month, no sales call,
compliance handled, and Canadian businesses text the same day.

**Boilerplate (press/partner listings):**
Loonext is a shared SMS inbox for small service businesses in the United
States and Canada. It gives a business one local phone number and one shared
text inbox that the whole crew works from any phone, so every customer text
becomes a conversation anyone can see, answer, assign, and close, instead of
dying on one person's personal cell. Pricing is flat and per company rather
than per seat, starting at $29 a month, with texting included under a
fair-use policy, compliance handled automatically, and free number porting.
Learn more at https://loonext.com.

**Founder bio template (fill name):**
[Name] is the solo founder of Loonext, a shared text inbox for small service
businesses. Before Loonext, [one sentence of real background]. He builds in
public and answers support himself.

**Screenshot shopping list** (use `scripts/dev-shot.mjs`, both themes):
inbox list with the assign menu open; a conversation thread with an internal
note; the pricing page plan builder; the number picker; mobile inbox in dark
mode. Reuse the shots in every directory so the brand reads consistent.

### Product Hunt draft

- **Name:** Loonext
- **Tagline:** One number. One inbox. Your whole crew.
- **Description:** Loonext is a shared text inbox for small service crews
  (plumbers, HVAC, cleaners, salons). One local business number, every
  customer text visible to the whole team from any phone. Flat $29/mo for the
  team, never per seat. Compliance (TCPA/CASL, STOP, consent) handled
  automatically. Canadian businesses text the same day.
- **First maker comment:**
  Hey PH! Solo founder here. I built Loonext after watching small service
  businesses run entirely off one person's personal cell: the 9 PM "my water
  heater is leaking" text sits unseen on one phone, and the job goes to
  whoever answers first. Loonext gives the business one local number and one
  shared inbox the whole crew works from any phone. The parts I'm proudest
  of: flat per-company pricing (a 3-person crew pays $29/mo total, not per
  seat), honest US carrier-registration timelines shown before you pay
  (receiving works day one, US sending approves in about a week), same-day
  texting for Canadian businesses, and STOP/consent/quiet-hours compliance
  handled automatically. It's self-serve, month to month, with a 30-day
  money-back guarantee. I'll be here all day; ask me anything, especially
  about the telecom compliance rabbit hole.

### Show HN draft (prerequisite: a no-signup demo)

- **Title:** Show HN: Loonext, a shared SMS inbox for plumbing and HVAC crews
- **First comment:** Solo founder, bootstrapped. Small service businesses run
  on text messages that land on one person's personal cell; Loonext gives the
  business one local number and one shared inbox the whole crew answers from
  any phone. The interesting engineering was mostly telecom and compliance:
  A2P 10DLC registration filed automatically at signup with the honest 3 to 7
  business day approval wait shown before payment, instant STOP handling,
  consent records, quiet-hours checks, idempotency-keyed provisioning so a
  double-tap can't double-charge, and Canada-first routing so Canadian
  businesses text the same day with no registration. Stack: Next.js on
  Cloudflare Workers, Supabase, Telnyx. Demo link above needs no signup.
  Happy to answer anything, including the sharp edges.

### Indie Hackers milestone post draft

- **Title:** Bootstrapping a flat-priced shared SMS inbox for trades, solo
- **Body sketch:** the personal-cell pain observed in trades; why flat
  per-company pricing in a per-seat market; what telecom compliance actually
  costs a solo founder (A2P registration, STOP handling, quiet hours); the
  honest-timeline trust bet (showing the US approval wait before payment);
  launch numbers when available. End with one link to loonext.com. No feature
  list; lessons first.

### LinkedIn starter posts (founder profile, native text, no links in post one)

1. The 9 PM leak: a homeowner texts a photo of a flooding garage to a
   plumber's personal cell. The plumber is asleep. By morning the job belongs
   to someone else. The fix isn't hustle, it's plumbing for texts: one
   business number, one inbox the whole crew can see. (Then the build-in-public
   line: I'm building exactly that, solo.)
2. Per-seat pricing punishes small crews for growing: add your third tech and
   your texting bill jumps 50%. Why I priced Loonext flat per company: $29/mo
   whether one person answers or three. The math for a 6-person crew vs the
   per-seat incumbents.
3. The most honest thing on our pricing page is a wait: US carriers take
   about a week to approve a new business for texting. Everyone in the
   industry hides that until after you pay. We show it before. Trust is the
   only moat a solo founder can afford.

### Reddit answer skeleton (for phone-setup threads, after history is built)

> The cheap options first: a second SIM works until you hire; Google Voice is
> free but [honest current limitation relevant to the thread]. The real
> problem is texts trapped on one phone once two people need to answer. What
> to look for in a shared-number tool: one number the crew shares, everyone
> sees the thread, one owner per conversation, and flat pricing so adding a
> helper doesn't raise the bill. Full disclosure: I built Loonext, which does
> exactly this for $29/mo flat, so I'm biased; [honest fit/no-fit note for
> the asker's situation].

## 6. Content engine (shipped with this change)

The blog exists to win the long-tail queries the trade pages can't: the
research found seven exploitable SERP gaps (CASL/Canada, A2P timelines, STOP
handling, missed-call text-back for trades, conversational-vs-marketing TCPA,
honest cost anatomy, texted quotes) where current results are help-center
docs, consultant microsites, or nothing. Twelve articles shipped as the
launch batch, all grounded in BRAND-MESSAGING.md facts, forming a "get your
number ready to text" cluster around the cornerstone guide
(/blog/how-to-get-a-business-text-number).

Cadence from here: one article a week beats twelve in a burst. Next topics in
priority order live in the content-plan research file. Every new post: add to
BLOG_POSTS registry (index, sitemap, RSS come free), 2 to 5 internal links,
sentence-case headings, no em-dashes, no invented numbers, compliance posts
end with the not-legal-advice line.

Distribution per post: LinkedIn native summary, X thread, DEV.to crosspost
with canonical_url (engineering posts only), and keep as ammunition for
community answers (r/smallbusiness bans blog links; answer in text instead).

## 7. Weekly 30-minute monitoring loop

1. GSC Page Indexing: indexed count trending up; investigate pages stuck in
   "Crawled - currently not indexed" older than ~4 weeks. Expect Google to
   take 4 to 12 weeks on a July-2026 domain; do not panic-resubmit.
2. Bing Webmaster AI Performance: AI citation counts by page.
3. Run the same 10 buyer queries through ChatGPT, Perplexity, and Claude; log
   who gets cited ("shared text inbox for small business", "business texting
   app Canada flat price", "one phone number whole team texting", "how long
   does 10DLC take", "can customers text my landline", "Heymarket
   alternative flat pricing", "stop giving customers my personal cell",
   "missed call text back plumber", "CASL texting rules", "Loonext reviews").
4. `site:loonext.com` on Google and Bing to eyeball coverage.
5. Ahrefs alert emails: new backlinks (each directory listing above should
   appear here as it goes live).
6. Review-platform check: new reviews on Capterra/G2/Trustpilot; respond to
   every one.

## 8. What Claude can and cannot do here

Everything in sections 1 to 3 that requires creating an account, submitting a
form, accepting platform terms, or posting publicly is founder-only work by
policy: Claude prepares the copy, the checklists, and the site changes, and
verifies results, but does not create accounts or publish on your behalf. The
copy kit in section 5 exists so each founder session is paste-and-go.
