import type { Translated } from "../translated";

import type { MarketingLocale } from "./footer";

/**
 * D138 — the home page, in both languages.
 *
 * ## Why this one is a single catalogue and not eleven
 *
 * The home page is eleven sections in twelve files, and every one of them is
 * a separate component the route composes. Eleven catalogues would mean
 * eleven imports to keep in step and eleven places to look when a sentence is
 * wrong. One file per PAGE is the rule the feature pages already follow; the
 * home page is one page.
 *
 * ## The country branch is not the language branch
 *
 * Several sections already render differently for a US and a Canadian reader
 * (`CountryOnly` / `CountryText`), because the registration wait is real in
 * one country and absent in the other. That branch is orthogonal to language:
 * a French page still has to say the right thing to a Canadian, and the
 * `...Us` / `...Ca` key pairs below carry both. A French reader is
 * overwhelmingly Canadian, but "overwhelmingly" is not "always", and the
 * page already knows how to ask.
 *
 * ## What is deliberately NOT here
 *
 * Person names in the demo inbox (Karen M, Theo B, Morgan W, Priya) are
 * people, not words to translate — the rule the bilingual guard states when
 * it leaves `name` out of its data-copy list. The water-heater thread script
 * has its own catalogue: it is a conversation, it is 263 lines, and it is
 * shared with surfaces beyond this page.
 */
export const homeEn = {
  metaTitle: "Loonext: the shared line for service crews",
  metaDescription:
    "One business number for texts and calls, in an inbox the whole crew works from any phone. Reply, answer, assign, turn it into a job, close it.",

  heroDateline: "9:04 PM · TUESDAY",
  heroH1: "Somebody texted your business at 9:04 last night. Did anybody see it?",
  heroSub:
    "Loonext gives your business a local number and one shared inbox for everything that reaches it. Texts and calls both land where the whole crew can see them, so the next 9 PM message gets answered by whoever is free instead of dying on somebody's personal cell.",
  heroPriceAfter: "a month for the whole team, flat.",
  heroActivationUs:
    "Your number is live and receiving texts the day you sign up. Texting US customers turns on in about a week, once the phone companies approve you. We file everything the minute you pay.",
  heroActivationCa:
    "Your number is live the day you sign up, and you can text Canadian customers the same day. No registration, no fee, no waiting. We set you up the minute you pay.",
  heroInboxAria: "Customer conversations waiting in the Loonext inbox",
  heroInboxHeading: "Inbox",
  heroInboxYou: "You: ",

  truthChipTexts: "Send and receive texts and pictures",
  truthChipMonthly: "Month to month, cancel anytime",

  patternTitle:
    "Your business runs on a phone number. That number runs on one phone.",
  patternSub:
    "Customers call the number on the truck, or they text it. Either way it reaches one pocket, and that works until it doesn't.",
  patternBuriedArtifact: "DELIVERED 9:04 PM · NO REPLY",
  patternBuriedTitle: "Buried on one phone.",
  patternBuriedBody:
    'Quotes, bookings, and "is he coming today?" all land on the owner\'s personal cell, in between the family group chat. Whoever has the phone has the business.',
  patternOwnerArtifact: "2 REPLIES · 0 OWNERS",
  patternOwnerTitle: "Nobody knows who answered.",
  patternOwnerBody:
    "Did anyone get back to the Hendersons about Thursday? You can't tell without asking around. Two people reply, or nobody does.",
  patternSimArtifact: "SIM REMOVED",
  patternSimTitle: "The number leaves with the phone.",
  patternSimBody:
    "When a tech moves on, their conversations, their contacts, and sometimes their customers go with them. The business should own its own number.",

  stepsTitle: "From signup to answering customers, in three steps.",
  stepsNumberTitle: "Pick your number.",
  stepsNumberBody:
    "Type your city or area code and we'll find you a local number. It's usually live in a minute or two, and it belongs to your business, not to anyone's phone.",
  stepsCrewTitle: "Invite the crew.",
  stepsCrewBody:
    "Send your team a link. They open it on whatever phone they already have. Nothing to install, nothing to configure. Starter covers 3 people, Pro covers 15.",
  stepsAnswerTitle: "Answer customers.",
  stepsAnswerBody:
    'Put "call or text" on your trucks, your site, and your invoices. Every text and every call lands in the shared inbox, where anyone can pick it up.',

  timelineYouAreHere: "YOU ARE HERE",
  timelineYouAreHereLabel: "You are here",
  timelineDay0: "DAY 0",
  timelineDay0Title: "You're live, not waiting.",
  timelineDay0Body:
    "Your number is up. Receiving texts works right away. You can invite the crew and start today.",
  timelineReviewLabel: "DAYS 1 TO 7",
  timelineReviewTitle: "The phone companies review you.",
  timelineReviewBody:
    "US carriers require every business that texts to register. We filed yours the minute you paid. Approval typically takes 3 to 7 business days, about a week.",
  timelineApprovedLabel: "APPROVED",
  timelineApprovedTitle: "US texting turns on.",
  timelineApprovedBody:
    "We email you the moment it's live. Nothing else for you to do.",
  timelineNoWait: "Today, no wait",
  timelineDayOneLabel: "DAY ONE",
  timelineDayOneTitle: "You're live and texting the same day.",
  timelineDayOneBody:
    "Your number is active, usually a minute or two after you sign up, and you can text Canadian customers right away. No registration, no fee, no waiting. Receiving texts works immediately too.",

  bentoTitle: "Everything a crew needs. Nothing a sales team invented.",
  bentoTruckTitle: "Built for the truck, not the desk.",
  bentoTruckAria: "A 6am no-hot-water conversation, answered from a phone",
  bentoNotesTitle: "Internal notes.",
  bentoNotesAria: "An internal note the customer never sees",
  bentoTemplatesTitle: "Saved replies.",
  bentoTemplatesAria: "The saved-reply picker above the composer",
  bentoPushTitle: "Loonext",
  bentoPushBody: "New text from Marcus T",
  bentoAssignTitle: "Assign and track.",
  bentoAssignBody:
    "Every conversation has one owner and one status: new, open, waiting, or closed. At a glance, you know what's handled and what's not.",
  bentoAssignAria: "Conversations with one owner and one status each",
  bentoNotesBody:
    "Talk about the job inside the conversation. Notes are marked, locked, and never sent to the customer.",
  bentoTemplatesBody:
    'Type "/" and send your on-my-way, quote-follow-up, or booking text in two taps. Write them once, stop retyping them forever.',
  bentoTagsTitle: "Tags that match how you sell.",
  bentoTagsBody:
    "Quote sent, scheduled, won, lost. Ready out of the box, editable to fit how you actually work.",
  bentoPhotosTitle: "Photos, both ways.",
  bentoPhotosBody:
    "Customers text you a picture of the problem, and receiving photos is always free, on every plan. Texting back a photo of the finished job is included too, on every plan, and every photo is stored free.",
  bentoSearchTitle: "Search everything.",
  bentoSearchBody:
    'Every message and contact, searchable. "What did we quote the Nguyens in March?" takes five seconds, not a phone poll.',
  bentoHistoryTitle: "One history per customer.",
  bentoHistoryBody:
    "Every text, call, voicemail and photo you have ever exchanged with somebody, on one timeline, with their address and your private notes. Bring your list in with a CSV; we show you exactly what will import before anything does.",
  bentoCallsTitle: "Calls ring the whole crew.",
  bentoCallsBody:
    "A customer calls your business number and every teammate's app rings at once, so whoever is free answers. Nobody free? They leave a voicemail we write down for you to read, and they get a text back before they try the next business. Included on every plan.",
  bentoJobTitle: "Turn it into a job.",
  bentoJobBody:
    "A text or a call becomes a task with an owner, an address and a due date, linked back to what the customer actually said. Book the Hendersons for Tuesday stops living in one person's head.",
  bentoLouTitle: "Lou drafts, you send.",
  bentoLouBody:
    "Our assistant writes a reply for you to edit, puts voicemails in writing, and fills in a job's address and due date from the customer's own words. A person always reads it before it goes. Every part of it can be switched off.",
  bentoDoneTitle: "Mark it done.",
  bentoDoneBody:
    "Tap any message to check it off, right in the thread. The whole crew sees what's handled. No separate to-do app.",
  bentoTwoNumbersBody:
    "Two locations, or an office line and a field line? Pro gives you two separate numbers, each with its own inbox.",
  bentoPhoneBody:
    "Works on every phone your crew already carries. No download, no app store, no IT day. Open the link, add it to your home screen, and it behaves like an app: push notifications when a customer texts or calls, one-handed replies from the job site, calls you can take or place straight from the conversation, and a dark mode that doesn't blind you at 6am.",

  embedTomorrow: "Tomorrow between 9 and 11 works",
  embedComingToday: "Is he coming today?",
  embedAllDone: "All done, invoice when ready",
  embedNoteLabel: "Internal note · Priya",
  embedNoteBody:
    "Sounds like the Navien on Delaware Ave. Dale, you're two streets over this afternoon",
  embedNoteOnlyTeam: "Only your team sees this",
  embedTemplateOnMyWay: "On my way",
  embedTemplateOnMyWayBody:
    "On my way. Should be with you in about 20 minutes.",
  embedTemplateFollowUp: "Quote follow-up",
  embedTemplateFollowUpBefore: "Hi",
  embedTemplateFollowUpAfter: ", checking in on the quote we sent over.",
  embedTemplateBooking: "Booking confirmation",
  embedTemplateBookingBody:
    "You're booked. We'll text you when we're on the way.",
  embedComposerHint: "Type / for saved replies",

  mathEyebrow: "Do the math",
  mathTitle: "What's a missed conversation worth?",
  mathClose:
    "A missed call and an unanswered text cost the same job. Loonext rings your whole crew when somebody calls, writes down the voicemail when nobody can pick up, and puts every text where whoever's free answers it, not whoever's phone it is. That's",
  mathCloseAfter: "a month against the number above.",

  dealTitle: "One flat price for the whole crew.",
  dealSub:
    "No per-user fees. No quote calls. No annual contracts. This is the whole price list.",
  dealGuaranteeUs:
    "30-day money-back guarantee. Full refund, including the registration fee. No fine print.",
  dealGuaranteeCa: "30-day money-back guarantee. Full refund, no fine print.",
  dealActivationUs:
    "Day one you're not idle: receiving texts works right away. Texting US customers turns on in about a week, 3 to 7 business days, once the phone companies approve you.",
  dealActivationCa:
    "Day one you're texting: your number is active and you can text Canadian customers the same day, usually a minute or two after signup. No waiting.",
  dealTruthUsPrice:
    "US shops: {starter} a month plus a one-time {registration} to register with the phone companies. That's {firstMonth} your first month, then {starter} every month after. The registration fee is charged once, ever.",
  dealTruthCaPrice:
    "Canadian shops: {starter} a month, flat. No registration, no setup fee, no first-month bump; {starter} is {starter} from month one.",
  dealTaxUs: "Prices in USD, plus sales tax where it applies. That's the whole list.",
  dealTaxCa:
    "Prices in Canadian dollars, plus tax where it applies. That's the whole list.",
  dealFairUse: "The concrete numbers live in our fair use policy.",
  dealEnterprise: "Talk to us about Enterprise",
  dealSliderCaption:
    "Slide from 1 to 10 people and watch a typical per-user tool climb past Loonext's flat line.",
  dealMeterCaption:
    "This is the usage screen you'll see in the app: well within fair use, and a spending cap you control, with a heads-up early if a month ever runs hot. No surprise bills.",
  dealMeterAria: "The Loonext usage screen resting well within fair use",
  dealSeePricing: "See full pricing. Every cost is on that page.",

  rulesEyebrowUs: "The carrier stuff, handled",
  rulesTitleUs: "Your registration, filed and tracked.",
  rulesBodyUs:
    "The US registration is filed the minute you pay and carried all the way through carrier approval, resubmissions included. Receiving texts works right away, and we email you the moment US texting goes live, usually 3 to 7 business days after signup.",
  rulesLinkUs: "How Loonext handles the rules",
  rulesEyebrowCa: "The rules, handled",
  rulesTitleCa: "Texting Canadian customers, day one.",
  rulesBodyCa:
    "The US phone-company registration doesn't apply to a Canadian business texting Canadian customers, so on Loonext you're texting the same day you sign up. Local numbers in every province, CASL-aware consent records, and a privacy policy that says plainly where your data lives.",
  rulesLinkCa: "How Loonext works in Canada",
  rulesCardHeading: "Texting rules are real. We deal with them so you don't have to.",
  rulesRegTitle: "Registration, filed for you.",
  rulesRegBody:
    "We register your business with the US phone companies automatically at signup. You answer a few plain questions; we handle the forms, the follow-ups, and the resubmission if anything bounces.",
  rulesStopTitle: "STOP means stop, instantly.",
  rulesStopBody:
    "When a customer texts STOP, they're opted out on the spot, and Loonext blocks any future send to that number until they opt back in.",
  rulesConsentTitle: "Consent, on the record.",
  rulesConsentBodyUs:
    "Every conversation you start is recorded with who started it and when, so your opt-in trail is real if a carrier ever asks.",
  rulesConsentBodyCa:
    "Every conversation you start is recorded with who started it and when, so your CASL consent trail is a real name and date, not a memory.",
  rulesOptOutTitle: "Opt-outs honored, however they're said.",
  rulesOptOutBody:
    'The rules count "please stop texting me" the same as STOP, so one click marks a customer opted out and Loonext blocks every send until they ask back in.',
  rulesNoRegTitle: "No registration to file.",
  rulesNoRegBody:
    "Texting Canadian customers doesn't go through the US phone-company registration, so there's nothing to file and nothing to wait on. You pick a local number and start the same day.",
  rulesChipFiled: "Filed for you at signup",
  rulesChipReceiving: "Receiving texts, day one",
  rulesChipPrivacy: "Plain-English privacy",
  rulesChipLocal: "Local Canadian numbers",
  rulesChipDayOne: "Texting works day one",
  rulesInCanada: "In Canada?",

  faqTitle: "Fair questions, straight answers.",
  faqNumberQ:
    "What's my number, and can I keep the one that's on my trucks and my Google listing?",
  faqNumberAUs:
    'Either. Pick a new local number in the area code you choose, usually live in a minute or two, or bring the number your customers already know. Porting is free and self-serve: choose "Bring my number" at signup or start it later from settings, answer a few questions, and we handle the carrier paperwork and show you where the transfer is the whole way. Your number keeps working on your old carrier while it moves, usually a few days to two weeks, then switches to Loonext on a scheduled date. Nothing on your trucks or your listing has to change.',
  faqNumberACa:
    'Either. Pick a new local Canadian number in the area code you choose, usually live in a minute or two, or bring the number your customers already know. Porting is free and self-serve: choose "Bring my number" at signup or start it later from settings, answer a few questions, and we handle the carrier paperwork and show you where the transfer is the whole way. Your number keeps working on your old carrier while it moves, often just a few days for a Canadian number, then switches to Loonext on a scheduled date. Nothing on your trucks or your listing has to change.',
  faqAppQ: "Do we need to download an app?",
  faqAppA:
    "No. Loonext runs in the browser on any phone or computer. Add it to your home screen and it works like an app, push notifications included. Your crew is set up in the time it takes to open a link.",
  faqCallsQ: "Does it do phone calls too, or only texts?",
  faqCallsA:
    "Both, on the same number, included on every plan with nothing to switch on. A customer calls and every teammate's Loonext rings at once, so whoever is free answers. Nobody free? They leave a voicemail we write down so you can read it between jobs, and they get an automatic text back in your own words. You call customers back from the app and they see your business number, never anyone's cell. What it is not is a call center: no phone menus, no queues, no desk phones.",
  faqCountQ: "What counts as a text I send?",
  faqCountA:
    "Each text you send counts. A plain text up to 160 characters is one; longer texts, or texts with emoji, count as more than one, and the composer shows you the count before you send, so there's no mystery. Receiving texts is always free and unlimited. Receiving photos is free too, and they're saved for you; storage is free, with no caps. Texting is included under our automated fair-use policy, and almost every crew stays well inside it without thinking about it.",
  faqWaitQ: "Why does texting US customers take about a week?",
  faqWaitA:
    "The phone companies require every business that texts to register first. It's an industry rule, not a Loonext rule, and every provider has to do it. Approval usually lands in 3 to 7 business days, about a week. We file yours the minute you pay and email you the moment it's approved. The whole time, receiving texts already works.",
  faqStartQ: "When can I start texting customers?",
  faqStartA:
    "Right away. Your Loonext number is active usually a minute or two after you sign up, and you can text Canadian customers the same day. No registration, no fee, no waiting. Receiving texts works immediately too.",
  faqUsQ: "Can we also text US customers?",
  faqCrewElsewhereUsd:
    "A 6-person crew on a typical per-user tool runs $90 to $114 a month",
  faqCrewElsewhereCad:
    "A 6-person crew on a typical per-user tool runs US$90 to US$114 a month",
  faqPriceQ: "Is it really {starter} for the whole team?",
  faqPriceAUs:
    "Yes. {starter} a month for up to 3 people on Starter, {pro} for up to 15 on Pro. We don't charge per user. One thing to know up front: there's also a one-time {registration} fee to register with the phone companies, so your first month is {firstMonth} and every month after is {starter}. {crew}; on Loonext it's {pro}, flat.",
  faqPriceACa:
    "Yes. {starter} a month for up to 3 people on Starter, {pro} for up to 15 on Pro. We don't charge per user, and texting Canadian customers has no registration fee and no setup cost, so {starter} is {starter} from your first month on. {crew}; on Loonext it's {pro}, flat.",
  faqUsA:
    "Yes, when you're ready. You can turn on US texting anytime from settings. That's the point where the one-time {registration} US registration and the roughly one-week carrier approval apply, because US phone companies require every business to register. Until you turn it on, texting Canadian customers stays free of both.",
  faqPhotosQ: "Can customers text us photos?",
  faqPhotosA:
    "Yes, both directions, on every plan, nothing to turn on. Photos customers send come through in the conversation, full size, and receiving them is free. Sending photos back is included too, under the same fair-use policy as your texts, and every photo is stored free with no caps.",
  faqOverageQ: "What happens if we go over our included texting?",
  faqOverageA:
    "Nothing surprising. We email you at 80% and again at 100% of your included texting, and past it extra texts bill at a small per-text rate, up to a spending cap you control that stops things before they run away. The exact rates live in our fair use policy.",
  faqCancelQ: "What happens if I cancel?",
  faqCancelA:
    "Your subscription is month to month. Cancel anytime from your billing settings, no phone call required. We hold your number for 30 days after cancellation, so if you come back within a month, you keep it.",
  faqFeeQ: "What's the one-time {registration} fee?",
  faqFeeA:
    "It covers registering your business with the phone companies so you're allowed to text customers. They charge a real fee to review and approve every business, and we pay it on your behalf, including a resubmission if the first try bounces. You pay it once, ever: cancel and come back later and you won't pay it again.",

  ctaTitle: "One inbox for the whole crew. No strings attached.",
  ctaSub:
    "See the price, pay, and start answering customers today, with a full refund in your first 30 days if it's not for you. Month to month, the whole time.",
  ctaEmail: "Email us anytime",
  ctaPriceLine: "/MO FLAT · MONTH TO MONTH · 30-DAY MONEY-BACK",
  ctaFounderBefore:
    "We built Loonext because we watched small shops run the whole business off one person's cell. No sales team, no investors leaning on us to upsell you.",
  ctaFounderAfter: "; we answer.",
  ctaSecurityBefore:
    "Your data is encrypted in transit and at rest, we keep message content out of our analytics and error logs, and it's stored in the United States. The details are on our",
  ctaSecurity: "security page",
} as const;

export const homeFr: Translated<typeof homeEn> = {
  metaTitle: "Loonext : la ligne partagée des équipes de service",
  metaDescription:
    "Un seul numéro d'entreprise pour les textos et les appels, dans une boîte que toute l'équipe utilise depuis n'importe quel téléphone. Répondez, prenez l'appel, assignez, transformez en job, fermez.",

  heroDateline: "21 H 04 · MARDI",
  heroH1:
    "Quelqu'un a écrit à votre entreprise à 21 h 04 hier soir. Est-ce que quelqu'un l'a vu ?",
  heroSub:
    "Loonext donne à votre entreprise un numéro local et une seule boîte partagée pour tout ce qui y arrive. Les textos et les appels atterrissent là où toute l'équipe les voit, alors le prochain message de 21 h est pris par qui est libre au lieu de mourir dans le cellulaire personnel de quelqu'un.",
  heroPriceAfter: "par mois pour toute l'équipe, prix fixe.",
  heroActivationUs:
    "Votre numéro est en service et reçoit des textos le jour de votre inscription. L'envoi aux clients américains s'active en environ une semaine, une fois que les compagnies de téléphone vous approuvent. Nous déposons tout dès que vous payez.",
  heroActivationCa:
    "Votre numéro est en service le jour de votre inscription, et vous pouvez écrire à des clients canadiens le jour même. Aucun enregistrement, aucuns frais, aucune attente. Nous vous installons dès que vous payez.",
  heroInboxAria: "Des conversations clients en attente dans la boîte Loonext",
  heroInboxHeading: "Boîte de réception",
  heroInboxYou: "Vous : ",

  truthChipTexts: "Envoyez et recevez textos et photos",
  truthChipMonthly: "Au mois, annulez quand vous voulez",

  patternTitle:
    "Votre entreprise roule sur un numéro de téléphone. Ce numéro roule sur un seul téléphone.",
  patternSub:
    "Les clients appellent le numéro sur le camion, ou ils l'écrivent. Dans les deux cas, ça aboutit dans une seule poche, et ça marche jusqu'au jour où ça ne marche plus.",
  patternBuriedArtifact: "LIVRÉ À 21 H 04 · AUCUNE RÉPONSE",
  patternBuriedTitle: "Enterré dans un seul téléphone.",
  patternBuriedBody:
    "Les soumissions, les rendez-vous et les « est-ce qu'il vient aujourd'hui ? » atterrissent tous dans le cellulaire personnel du patron, entre deux messages du groupe familial. Celui qui a le téléphone a l'entreprise.",
  patternOwnerArtifact: "2 RÉPONSES · 0 RESPONSABLE",
  patternOwnerTitle: "Personne ne sait qui a répondu.",
  patternOwnerBody:
    "Est-ce que quelqu'un a rappelé les Henderson pour jeudi ? Impossible de le savoir sans demander autour. Deux personnes répondent, ou personne.",
  patternSimArtifact: "CARTE SIM RETIRÉE",
  patternSimTitle: "Le numéro part avec le téléphone.",
  patternSimBody:
    "Quand un technicien s'en va, ses conversations, ses contacts et parfois ses clients partent avec lui. L'entreprise devrait posséder son propre numéro.",

  stepsTitle: "De l'inscription aux réponses aux clients, en trois étapes.",
  stepsNumberTitle: "Choisissez votre numéro.",
  stepsNumberBody:
    "Tapez votre ville ou votre indicatif régional et on vous trouve un numéro local. Il est habituellement en service en une minute ou deux, et il appartient à votre entreprise, pas au téléphone de quelqu'un.",
  stepsCrewTitle: "Invitez l'équipe.",
  stepsCrewBody:
    "Envoyez un lien à votre monde. Ils l'ouvrent sur le téléphone qu'ils ont déjà. Rien à installer, rien à configurer. Starter couvre 3 personnes, Pro en couvre 15.",
  stepsAnswerTitle: "Répondez aux clients.",
  stepsAnswerBody:
    "Mettez « appelez ou écrivez » sur vos camions, votre site et vos factures. Chaque texto et chaque appel atterrit dans la boîte partagée, où n'importe qui peut le prendre.",

  timelineYouAreHere: "VOUS ÊTES ICI",
  timelineYouAreHereLabel: "Vous êtes ici",
  timelineDay0: "JOUR 0",
  timelineDay0Title: "Vous êtes en service, pas en attente.",
  timelineDay0Body:
    "Votre numéro est actif. La réception des textos fonctionne tout de suite. Vous pouvez inviter l'équipe et commencer aujourd'hui.",
  timelineReviewLabel: "JOURS 1 À 7",
  timelineReviewTitle: "Les compagnies de téléphone vous révisent.",
  timelineReviewBody:
    "Les opérateurs américains exigent que chaque entreprise qui envoie des textos s'enregistre. Nous avons déposé la vôtre dès que vous avez payé. L'approbation prend généralement de 3 à 7 jours ouvrables, environ une semaine.",
  timelineApprovedLabel: "APPROUVÉ",
  timelineApprovedTitle: "L'envoi vers les États-Unis s'active.",
  timelineApprovedBody:
    "Nous vous écrivons dès que c'est en service. Rien d'autre à faire de votre côté.",
  timelineNoWait: "Aujourd'hui, sans attente",
  timelineDayOneLabel: "PREMIER JOUR",
  timelineDayOneTitle: "Vous êtes en service et vous écrivez le jour même.",
  timelineDayOneBody:
    "Votre numéro est actif, habituellement une minute ou deux après votre inscription, et vous pouvez écrire à des clients canadiens tout de suite. Aucun enregistrement, aucuns frais, aucune attente. La réception des textos fonctionne immédiatement aussi.",

  bentoTitle:
    "Tout ce qu'une équipe a besoin. Rien qu'une équipe de vente a inventé.",
  bentoTruckTitle: "Bâti pour le camion, pas pour le bureau.",
  bentoTruckAria:
    "Une conversation « plus d'eau chaude » à 6 h, répondue depuis un téléphone",
  bentoNotesTitle: "Notes internes.",
  bentoNotesAria: "Une note interne que le client ne voit jamais",
  bentoTemplatesTitle: "Réponses enregistrées.",
  bentoTemplatesAria:
    "Le sélecteur de réponses enregistrées au-dessus du champ de saisie",
  bentoPushTitle: "Loonext",
  bentoPushBody: "Nouveau texto de Marcus T",
  bentoAssignTitle: "Assignez et suivez.",
  bentoAssignBody:
    "Chaque conversation a un seul responsable et un seul état : nouveau, ouvert, en attente ou fermé. D'un coup d'œil, vous savez ce qui est réglé et ce qui ne l'est pas.",
  bentoAssignAria: "Des conversations avec un responsable et un état chacune",
  bentoNotesBody:
    "Parlez de la job à l'intérieur de la conversation. Les notes sont marquées, verrouillées, et ne sont jamais envoyées au client.",
  bentoTemplatesBody:
    "Tapez « / » et envoyez votre texto « en route », votre relance de soumission ou votre confirmation en deux touches. Écrivez-les une fois, arrêtez de les retaper pour toujours.",
  bentoTagsTitle: "Des étiquettes qui suivent votre façon de vendre.",
  bentoTagsBody:
    "Soumission envoyée, planifié, gagné, perdu. Prêtes à l'emploi, modifiables pour coller à votre façon de travailler.",
  bentoPhotosTitle: "Des photos, dans les deux sens.",
  bentoPhotosBody:
    "Les clients vous envoient une photo du problème, et la réception des photos est toujours gratuite, sur tous les forfaits. Renvoyer une photo de la job terminée est inclus aussi, sur tous les forfaits, et chaque photo est stockée gratuitement.",
  bentoSearchTitle: "Cherchez dans tout.",
  bentoSearchBody:
    "Chaque message et chaque contact, cherchables. « Combien a-t-on soumissionné aux Nguyen en mars ? » prend cinq secondes, pas un sondage téléphonique.",
  bentoHistoryTitle: "Un seul historique par client.",
  bentoHistoryBody:
    "Chaque texto, appel, message vocal et photo que vous avez échangés avec quelqu'un, sur une seule ligne du temps, avec son adresse et vos notes privées. Amenez votre liste avec un CSV ; on vous montre exactement ce qui sera importé avant que quoi que ce soit le soit.",
  bentoCallsTitle: "Les appels font sonner toute l'équipe.",
  bentoCallsBody:
    "Un client appelle votre numéro d'entreprise et l'application de chaque coéquipier sonne en même temps, alors celui qui est libre répond. Personne de libre ? Il laisse un message vocal qu'on met par écrit pour vous, et il reçoit un texto de retour avant d'essayer le commerce suivant. Inclus sur tous les forfaits.",
  bentoJobTitle: "Transformez-le en job.",
  bentoJobBody:
    "Un texto ou un appel devient une tâche avec un responsable, une adresse et une échéance, reliée à ce que le client a réellement dit. « Réserver les Henderson pour mardi » arrête de vivre dans la tête d'une seule personne.",
  bentoLouTitle: "Lou rédige, vous envoyez.",
  bentoLouBody:
    "Notre assistant écrit une réponse que vous modifiez, met les messages vocaux par écrit, et remplit l'adresse et l'échéance d'une job à partir des mots du client. Une personne le lit toujours avant que ça parte. Chaque partie peut être désactivée.",
  bentoDoneTitle: "Marquez-le terminé.",
  bentoDoneBody:
    "Touchez n'importe quel message pour le cocher, directement dans le fil. Toute l'équipe voit ce qui est réglé. Aucune application de tâches à part.",
  bentoTwoNumbersBody:
    "Deux emplacements, ou une ligne de bureau et une ligne de terrain ? Pro vous donne deux numéros distincts, chacun avec sa propre boîte.",
  bentoPhoneBody:
    "Fonctionne sur tous les téléphones que votre équipe transporte déjà. Aucun téléchargement, aucune boutique d'applications, aucune journée d'informatique. Ouvrez le lien, ajoutez-le à votre écran d'accueil, et ça se comporte comme une application : des notifications quand un client écrit ou appelle, des réponses à une main depuis le chantier, des appels que vous prenez ou placez directement depuis la conversation, et un mode sombre qui ne vous aveugle pas à 6 h du matin.",

  embedTomorrow: "Demain entre 9 h et 11 h, ça marche",
  embedComingToday: "Est-ce qu'il vient aujourd'hui ?",
  embedAllDone: "Tout est fait, facturez quand vous voulez",
  embedNoteLabel: "Note interne · Priya",
  embedNoteBody:
    "On dirait le Navien sur l'avenue Delaware. Dale, tu es à deux rues cet après-midi",
  embedNoteOnlyTeam: "Seule votre équipe voit ceci",
  embedTemplateOnMyWay: "En route",
  embedTemplateOnMyWayBody:
    "En route. On devrait être chez vous dans une vingtaine de minutes.",
  embedTemplateFollowUp: "Relance de soumission",
  embedTemplateFollowUpBefore: "Bonjour",
  embedTemplateFollowUpAfter:
    ", je fais un suivi sur la soumission qu'on vous a envoyée.",
  embedTemplateBooking: "Confirmation de rendez-vous",
  embedTemplateBookingBody:
    "C'est réservé. On vous écrit quand on est en route.",
  embedComposerHint: "Tapez / pour les réponses enregistrées",

  mathEyebrow: "Faisons le calcul",
  mathTitle: "Combien vaut une conversation manquée ?",
  mathClose:
    "Un appel manqué et un texto sans réponse coûtent la même job. Loonext fait sonner toute votre équipe quand quelqu'un appelle, met le message vocal par écrit quand personne ne peut répondre, et place chaque texto là où celui qui est libre y répond, pas celui à qui appartient le téléphone. Ça fait",
  mathCloseAfter: "par mois contre le chiffre ci-dessus.",

  dealTitle: "Un seul prix fixe pour toute l'équipe.",
  dealSub:
    "Aucuns frais par personne. Aucun appel pour une soumission. Aucun contrat annuel. Voici la liste de prix au complet.",
  dealGuaranteeUs:
    "Garantie de remboursement de 30 jours. Remboursement complet, frais d'enregistrement compris. Aucune clause en petits caractères.",
  dealGuaranteeCa:
    "Garantie de remboursement de 30 jours. Remboursement complet, aucune clause en petits caractères.",
  dealActivationUs:
    "Dès le premier jour vous n'êtes pas inactif : la réception des textos fonctionne tout de suite. L'envoi aux clients américains s'active en environ une semaine, de 3 à 7 jours ouvrables, une fois que les compagnies de téléphone vous approuvent.",
  dealActivationCa:
    "Dès le premier jour vous écrivez : votre numéro est actif et vous pouvez écrire à des clients canadiens le jour même, habituellement une minute ou deux après l'inscription. Aucune attente.",
  dealTruthUsPrice:
    "Commerces américains : {starter} par mois plus des frais uniques de {registration} pour s'enregistrer auprès des compagnies de téléphone. Ça fait {firstMonth} votre premier mois, puis {starter} chaque mois ensuite. Les frais d'enregistrement sont facturés une seule fois, à vie.",
  dealTruthCaPrice:
    "Commerces canadiens : {starter} par mois, prix fixe. Aucun enregistrement, aucuns frais d'installation, aucune hausse le premier mois ; {starter} reste {starter} dès le premier mois.",
  dealTaxUs:
    "Prix en dollars américains, plus les taxes de vente là où elles s'appliquent. C'est toute la liste.",
  dealTaxCa:
    "Prix en dollars canadiens, plus les taxes là où elles s'appliquent. C'est toute la liste.",
  dealFairUse:
    "Les chiffres concrets vivent dans notre politique d'utilisation équitable.",
  dealEnterprise: "Parlez-nous d'Enterprise",
  dealSliderCaption:
    "Glissez de 1 à 10 personnes et regardez un outil typique facturé par personne grimper au-dessus de la ligne fixe de Loonext.",
  dealMeterCaption:
    "Voici l'écran d'utilisation que vous verrez dans l'application : bien à l'intérieur de l'utilisation équitable, et un plafond de dépenses que vous contrôlez, avec un avertissement d'avance si un mois chauffe. Aucune facture surprise.",
  dealMeterAria:
    "L'écran d'utilisation de Loonext, bien à l'intérieur de l'utilisation équitable",
  dealSeePricing: "Voir tous les prix. Chaque coût est sur cette page.",

  rulesEyebrowUs: "Les affaires d'opérateurs, réglées",
  rulesTitleUs: "Votre enregistrement, déposé et suivi.",
  rulesBodyUs:
    "L'enregistrement américain est déposé dès que vous payez et porté jusqu'à l'approbation des opérateurs, les nouvelles soumissions comprises. La réception des textos fonctionne tout de suite, et nous vous écrivons dès que l'envoi vers les États-Unis est en service, habituellement de 3 à 7 jours ouvrables après l'inscription.",
  rulesLinkUs: "Comment Loonext gère les règles",
  rulesEyebrowCa: "Les règles, réglées",
  rulesTitleCa: "Écrire à des clients canadiens, dès le premier jour.",
  rulesBodyCa:
    "L'enregistrement auprès des compagnies de téléphone américaines ne s'applique pas à une entreprise canadienne qui écrit à des clients canadiens, alors sur Loonext vous écrivez le jour même de votre inscription. Des numéros locaux dans chaque province, des dossiers de consentement conformes à la LCAP, et une politique de confidentialité qui dit clairement où vivent vos données.",
  rulesLinkCa: "Comment Loonext fonctionne au Canada",
  rulesCardHeading:
    "Les règles du texto sont réelles. On s'en occupe pour que vous n'ayez pas à le faire.",
  rulesRegTitle: "L'enregistrement, déposé pour vous.",
  rulesRegBody:
    "Nous enregistrons automatiquement votre entreprise auprès des compagnies de téléphone américaines à l'inscription. Vous répondez à quelques questions simples ; on s'occupe des formulaires, des suivis et de la nouvelle soumission si quoi que ce soit est refusé.",
  rulesStopTitle: "ARRÊT veut dire arrêt, instantanément.",
  rulesStopBody:
    "Quand un client écrit ARRÊT, il est retiré sur-le-champ, et Loonext bloque tout envoi futur vers ce numéro jusqu'à ce qu'il revienne.",
  rulesConsentTitle: "Le consentement, au dossier.",
  rulesConsentBodyUs:
    "Chaque conversation que vous démarrez est consignée avec qui l'a démarrée et quand, alors votre trace d'adhésion est réelle si un opérateur la demande un jour.",
  rulesConsentBodyCa:
    "Chaque conversation que vous démarrez est consignée avec qui l'a démarrée et quand, alors votre trace de consentement LCAP est un vrai nom et une vraie date, pas un souvenir.",
  rulesOptOutTitle: "Les retraits honorés, peu importe les mots.",
  rulesOptOutBody:
    "Les règles comptent « arrêtez de m'écrire » comme un ARRÊT, alors un clic marque un client comme retiré et Loonext bloque chaque envoi jusqu'à ce qu'il redemande.",
  rulesNoRegTitle: "Aucun enregistrement à déposer.",
  rulesNoRegBody:
    "Écrire à des clients canadiens ne passe pas par l'enregistrement auprès des compagnies de téléphone américaines, alors il n'y a rien à déposer et rien à attendre. Vous choisissez un numéro local et vous commencez le jour même.",
  rulesChipFiled: "Déposé pour vous à l'inscription",
  rulesChipReceiving: "Réception des textos, jour un",
  rulesChipPrivacy: "Confidentialité en langage clair",
  rulesChipLocal: "Numéros canadiens locaux",
  rulesChipDayOne: "Le texto fonctionne jour un",
  rulesInCanada: "Au Canada ?",

  faqTitle: "Questions légitimes, réponses directes.",
  faqNumberQ:
    "C'est quoi mon numéro, et puis-je garder celui qui est sur mes camions et ma fiche Google ?",
  faqNumberAUs:
    "L'un ou l'autre. Choisissez un nouveau numéro local dans l'indicatif régional que vous voulez, habituellement en service en une minute ou deux, ou amenez le numéro que vos clients connaissent déjà. Le transfert est gratuit et libre-service : choisissez « Amener mon numéro » à l'inscription ou lancez-le plus tard depuis les réglages, répondez à quelques questions, et on s'occupe de la paperasse des opérateurs en vous montrant où en est le transfert tout du long. Votre numéro continue de fonctionner chez votre ancien fournisseur pendant le déplacement, habituellement de quelques jours à deux semaines, puis il bascule sur Loonext à une date prévue. Rien sur vos camions ni sur votre fiche n'a à changer.",
  faqNumberACa:
    "L'un ou l'autre. Choisissez un nouveau numéro canadien local dans l'indicatif régional que vous voulez, habituellement en service en une minute ou deux, ou amenez le numéro que vos clients connaissent déjà. Le transfert est gratuit et libre-service : choisissez « Amener mon numéro » à l'inscription ou lancez-le plus tard depuis les réglages, répondez à quelques questions, et on s'occupe de la paperasse des opérateurs en vous montrant où en est le transfert tout du long. Votre numéro continue de fonctionner chez votre ancien fournisseur pendant le déplacement, souvent seulement quelques jours pour un numéro canadien, puis il bascule sur Loonext à une date prévue. Rien sur vos camions ni sur votre fiche n'a à changer.",
  faqAppQ: "Devons-nous télécharger une application ?",
  faqAppA:
    "Non. Loonext fonctionne dans le navigateur sur n'importe quel téléphone ou ordinateur. Ajoutez-le à votre écran d'accueil et ça fonctionne comme une application, notifications comprises. Votre équipe est installée le temps d'ouvrir un lien.",
  faqCallsQ: "Est-ce que ça fait aussi les appels, ou seulement les textos ?",
  faqCallsA:
    "Les deux, sur le même numéro, inclus sur tous les forfaits sans rien à activer. Un client appelle et le Loonext de chaque coéquipier sonne en même temps, alors celui qui est libre répond. Personne de libre ? Il laisse un message vocal qu'on met par écrit pour que vous le lisiez entre deux jobs, et il reçoit un texto de retour automatique dans vos propres mots. Vous rappelez les clients depuis l'application et ils voient votre numéro d'entreprise, jamais le cellulaire de quelqu'un. Ce que ce n'est pas, c'est un centre d'appels : aucun menu téléphonique, aucune file d'attente, aucun téléphone de bureau.",
  faqCountQ: "Qu'est-ce qui compte comme un texto envoyé ?",
  faqCountA:
    "Chaque texto que vous envoyez compte. Un texto simple jusqu'à 160 caractères en vaut un ; les textos plus longs, ou avec des émojis, en valent plus d'un, et le champ de saisie vous montre le compte avant l'envoi, alors il n'y a aucun mystère. La réception des textos est toujours gratuite et illimitée. La réception des photos est gratuite aussi, et elles sont conservées pour vous ; le stockage est gratuit, sans plafond. L'envoi est inclus sous notre politique d'utilisation équitable automatisée, et presque toutes les équipes restent bien à l'intérieur sans y penser.",
  faqWaitQ: "Pourquoi écrire à des clients américains prend-il environ une semaine ?",
  faqWaitA:
    "Les compagnies de téléphone exigent que chaque entreprise qui envoie des textos s'enregistre d'abord. C'est une règle de l'industrie, pas une règle de Loonext, et tous les fournisseurs doivent le faire. L'approbation arrive habituellement en 3 à 7 jours ouvrables, environ une semaine. Nous déposons la vôtre dès que vous payez et nous vous écrivons dès qu'elle est approuvée. Pendant tout ce temps, la réception des textos fonctionne déjà.",
  faqStartQ: "Quand puis-je commencer à écrire à mes clients ?",
  faqStartA:
    "Tout de suite. Votre numéro Loonext est actif habituellement une minute ou deux après votre inscription, et vous pouvez écrire à des clients canadiens le jour même. Aucun enregistrement, aucuns frais, aucune attente. La réception des textos fonctionne immédiatement aussi.",
  faqUsQ: "Pouvons-nous aussi écrire à des clients américains ?",
  faqCrewElsewhereUsd:
    "Une équipe de 6 personnes sur un outil typique facturé par personne coûte de 90 $ à 114 $ par mois",
  faqCrewElsewhereCad:
    "Une équipe de 6 personnes sur un outil typique facturé par personne coûte de 90 $US à 114 $US par mois",
  faqPriceQ: "C'est vraiment {starter} pour toute l'équipe ?",
  faqPriceAUs:
    "Oui. {starter} par mois pour un maximum de 3 personnes sur Starter, {pro} pour un maximum de 15 sur Pro. On ne facture pas par personne. Une chose à savoir d'avance : il y a aussi des frais uniques de {registration} pour s'enregistrer auprès des compagnies de téléphone, alors votre premier mois est de {firstMonth} et chaque mois ensuite est de {starter}. {crew} ; sur Loonext c'est {pro}, prix fixe.",
  faqPriceACa:
    "Oui. {starter} par mois pour un maximum de 3 personnes sur Starter, {pro} pour un maximum de 15 sur Pro. On ne facture pas par personne, et écrire à des clients canadiens n'a aucuns frais d'enregistrement ni aucun coût d'installation, alors {starter} reste {starter} dès votre premier mois. {crew} ; sur Loonext c'est {pro}, prix fixe.",
  faqUsA:
    "Oui, quand vous serez prêt. Vous pouvez activer l'envoi vers les États-Unis n'importe quand depuis les réglages. C'est à ce moment-là que les frais uniques de {registration} pour l'enregistrement américain et l'approbation d'environ une semaine par les opérateurs s'appliquent, parce que les compagnies de téléphone américaines exigent que chaque entreprise s'enregistre. Tant que vous ne l'activez pas, écrire à des clients canadiens reste libre des deux.",
  faqPhotosQ: "Les clients peuvent-ils nous envoyer des photos ?",
  faqPhotosA:
    "Oui, dans les deux sens, sur tous les forfaits, rien à activer. Les photos que les clients envoient arrivent dans la conversation, en pleine taille, et les recevoir est gratuit. Renvoyer des photos est inclus aussi, sous la même politique d'utilisation équitable que vos textos, et chaque photo est stockée gratuitement, sans plafond.",
  faqOverageQ: "Que se passe-t-il si on dépasse les textos inclus ?",
  faqOverageA:
    "Rien de surprenant. On vous écrit à 80 % puis à 100 % de vos textos inclus, et au-delà les textos supplémentaires sont facturés à un petit tarif à l'unité, jusqu'à un plafond de dépenses que vous contrôlez et qui arrête les choses avant qu'elles s'emballent. Les tarifs exacts vivent dans notre politique d'utilisation équitable.",
  faqCancelQ: "Que se passe-t-il si j'annule ?",
  faqCancelA:
    "Votre abonnement est au mois. Annulez quand vous voulez depuis vos réglages de facturation, sans appel téléphonique. On garde votre numéro 30 jours après l'annulation, alors si vous revenez dans le mois, vous le gardez.",
  faqFeeQ: "C'est quoi les frais uniques de {registration} ?",
  faqFeeA:
    "Ils couvrent l'enregistrement de votre entreprise auprès des compagnies de téléphone pour que vous ayez le droit d'écrire à vos clients. Elles facturent de vrais frais pour réviser et approuver chaque entreprise, et nous les payons en votre nom, y compris une nouvelle soumission si la première est refusée. Vous les payez une seule fois, à vie : annulez et revenez plus tard, vous ne les paierez pas de nouveau.",

  ctaTitle: "Une seule boîte pour toute l'équipe. Sans conditions.",
  ctaSub:
    "Voyez le prix, payez, et commencez à répondre à vos clients aujourd'hui, avec un remboursement complet dans vos 30 premiers jours si ça ne vous convient pas. Au mois, tout du long.",
  ctaEmail: "Écrivez-nous n'importe quand",
  ctaPriceLine: "/MOIS PRIX FIXE · AU MOIS · REMBOURSEMENT 30 JOURS",
  ctaFounderBefore:
    "On a bâti Loonext parce qu'on a vu des petits commerces faire rouler toute l'entreprise sur le cellulaire d'une seule personne. Aucune équipe de vente, aucun investisseur qui nous pousse à vous vendre plus.",
  ctaFounderAfter: "; on répond.",
  ctaSecurityBefore:
    "Vos données sont chiffrées en transit et au repos, nous gardons le contenu des messages hors de nos analyses et de nos journaux d'erreurs, et il est stocké aux États-Unis. Les détails sont sur notre",
  ctaSecurity: "page sécurité",
};

/**
 * Fill `{named}` holes in a catalogue string.
 *
 * The price answers carry up to five figures inside one sentence, and the
 * figures are computed (the first month is a SUM). Fragments would have fixed
 * them in English word order, which is exactly the thing a translation has to
 * be free to change.
 */
export function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key) =>
    key in values ? values[key] : whole,
  );
}

const HOME_COPY = {
  en: homeEn,
  "fr-CA": homeFr,
} as const;

export type HomeCopy = typeof homeEn | typeof homeFr;

export function homeCopy(locale: MarketingLocale = "en"): HomeCopy {
  return HOME_COPY[locale] ?? homeEn;
}
