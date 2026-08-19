import type { Translated } from "../translated";

import type { MarketingLocale } from "./footer";

/**
 * D138 — /pricing, in both languages.
 *
 * ## The honesty ledger had a trap in it
 *
 * `LEDGER_CA` was built by taking the US ledger and swapping two rows, matched
 * like this:
 *
 *     if (entry.term === "Register with the phone companies") { ... }
 *
 * That is English string equality deciding which rows a Canadian reader sees.
 * The moment `term` came from a catalogue the comparison stopped matching, and
 * the failure is silent: the Canadian ledger keeps every row, so a Canadian
 * business reads a US registration fee it never pays, on the page where the
 * whole promise is that there are no surprises. Rows carry a stable `id` now
 * and the branch reads that; the term is only ever a label.
 *
 * ## The competitor table stays in US dollars
 *
 * Not an oversight and not a translation question. Heymarket and Quo publish
 * in USD, so the arithmetic only means anything if all three columns are the
 * same money — converting our column alone would flatter us by the exchange
 * rate. The footnote says which currency the table is in, in both languages.
 */
export const pricingEn = {
  metaTitle: "Pricing, {starter}/mo flat for the whole crew",
  metaDescription:
    "Build your plan and see the total before you pay: Starter {starter}/mo for up to 3 people, Pro {pro}/mo for up to 15. Texting, pictures, and calling included under automated fair use, storage free. One-time {fee} US registration fee. No per-user fees, no quote calls.",
  ogTitle: "Pricing: {starter}/mo flat for the whole crew",
  ogDescription:
    "Starter {starter}/mo for up to 3 people, Pro {pro}/mo for up to 15. Texting, pictures, and calling included under automated fair use, storage free. No per-user fees, no quote calls.",

  breadcrumbHome: "Home",
  breadcrumbSelf: "Pricing",

  h1: "One price for the whole crew. Nothing hidden.",
  heroSub:
    "Two plans, every cost on this page, and a buy button instead of a sales call. If you can't find a price on a texting company's pricing page, that's the price talking.",

  buildTitle: "Build your plan. The total updates as you go.",
  buildSub:
    "Pick a plan, switch on only what you need, and see the whole bill before you ever type a card number. What you build here is exactly what checkout starts from.",
  fairUseLink: "See our fair use policy.",

  enterpriseTitle: "More than 15 on your crew?",
  enterpriseBody:
    "Enterprise is unlimited seats with the same flat pricing, no per-user fees, sized to your team. Tell us who you are and we'll sort out the rest.",
  enterpriseCta: "Talk to us",

  sliderTitle: "Flat beats per-user. Slide to see by how much.",

  ledgerTitle: "Every cost, before you pay.",
  truthUsWorks:
    "Receiving texts works the moment your number is ready, usually live in a minute or two.",
  truthUsWait:
    "Texting US numbers turns on after the phone companies approve you, typically 3 to 7 business days. We file everything and email you the moment you're approved.",
  truthCaWorks:
    "Texting Canadian customers works the same day your number is active, usually live in a minute or two after you subscribe. No registration, no fee, no wait.",
  truthCaReceiving:
    "Receiving texts works right away too, the moment your number is ready.",
  meterCaption:
    "Well within fair use, and a spending cap you control. We reach out early if a month ever runs hot. No surprise bills.",
  meterAria:
    "The app usage screen: well within fair use this month, with the owner-set spending cap",

  elsewhereTitle: "The same crew, priced elsewhere.",
  elsewhereIntroBefore:
    "The workload we price: a 3-person crew sending 500 plain texts a month, at published prices {asOf} (every number below cites its source on our",
  elsewhereIntroLink: "comparison pages",
  elsewhereIntroAfter: "):",
  elsewhereTableCaption:
    "Monthly cost for a 3-person crew sending 500 texts: Loonext next to Heymarket and Quo, at published prices {asOf}.",

  segmentTitle: 'What\'s a "text," exactly?',
  segmentBody:
    'A plain text up to 160 characters counts as one text. Longer texts, or texts with emoji, count as more than one, the texting networks split them behind the scenes (the technical word is "segments," but you never have to think about it). The composer always shows the count before you send, so there\'s no mystery on your bill.',
  segmentAria:
    "A message to Karen from Reyes Plumbing being counted: one text, 122 characters, plain",

  guaranteeTitle: "Try it for a month, on us if it's not for you.",
  guaranteeBefore:
    "If Loonext isn't right for your crew, email us within 30 days of signing up and we'll refund your first invoice in full,",
  guaranteeUs: "subscription and registration fee included",
  guaranteeCa: "the whole subscription included",
  guaranteeAfter:
    '. No "minus credits used", no forms, no retention call. We\'d rather have your trust than your',
  refundLink: "Read the whole policy. It's three paragraphs.",

  leaveTitle: "And if you leave later",
  leaveCancel:
    "Cancel yourself, from billing settings. No phone call, no retention chat, no email to a support queue.",
  leaveNoCharge:
    "Nothing is charged after that. You keep working through the period you already paid for.",
  leaveNumber:
    "Your number is held for 30 days in case you come back. After that it goes back to the phone company and can be given to another business, so people who saved it will eventually reach someone else. Port it out first if you want to keep it.",
  leavePerson:
    "A real person is reachable from inside the app, including on the way out.",
  termsLink: "The cancellation terms, in full.",

  faqTitle: "Pricing questions, straight answers.",

  ctaTitle: "You've seen the whole price list. That's the point.",
  ctaChipAfter: "· Month to month · 30-day money-back guarantee",
  ledgerPlanTerm: "Your plan",
  ledgerPlanDetail:
    "Month to month. Starter covers {starterSeats} people, Pro covers {proSeats}, flat either way.",
  ledgerRegisterTerm: "Register with the phone companies",
  ledgerRegisterFigure: "{fee}, one time, ever",
  ledgerRegisterDetail:
    "The phone companies require every business that texts to register first. This covers the fee they charge to review and approve you, and we pay it on your behalf, including a resubmission if your first attempt bounces. Cancel and come back next year: you won't pay it again. That means {firstMonth} your first month, then {starter} every month after.",
  ledgerNoRegisterTerm: "No registration, no setup fee",
  ledgerNoRegisterFigure: "{zero}, ever",
  ledgerNoRegisterDetail:
    "A Canadian business texting Canadian customers registers nothing and pays no setup fee. Your number sends the same day it's active, usually a minute or two after you subscribe, so your first month costs the same as every month after.",
  ledgerExtraTerm: "Extra texts",
  ledgerExtraFigure: "Capped by you",
  ledgerExtraDetail:
    "Texting and pictures are included under our automated fair-use policy, and almost every crew stays well inside it. If a month runs hot, extra texts bill at a small per-text rate, only up to the spending cap you control, and we email you at 80% and 100% of your included texting first. The exact rates live in our fair use policy.",
  ledgerStorageTerm: "Storage",
  ledgerStorageFigure: "$0, no caps",
  ledgerStorageDetail:
    "Files you attach and photos customers send are stored free, on every plan. No storage pools, no meter, no storage add-on to buy, and nothing pauses when you save a lot.",
  ledgerAddOnsTerm: "Optional add-ons, if you turn them on",
  ledgerAddOnsDetail:
    "Calling is included in every plan, not an add-on: incoming calls ring your crew inside Loonext and whoever is free answers, you call customers back from the app on your business number, and callers you miss leave a voicemail and get an automatic text back, with generous calling minutes under fair use (the mechanics live in our fair use policy). One add-on exists: Canada numbers, {addOn}/mo, which adds Canadian numbers you can get and text alongside your US number. It isn't switchable on quite yet; we'll sell it when it works, at this price, and nothing here is required to text.",
  ledgerTaxTerm: "Tax",
  ledgerTaxDetailUs:
    "Prices are in US dollars, plus sales tax where it applies, calculated at checkout.",
  ledgerTaxDetailCa:
    "Your plan is priced and billed in Canadian dollars, plus tax where it applies, calculated at checkout. The amount on your statement doesn't move with the exchange rate.",
  ledgerWholeListTerm: "That's the whole list.",
  ledgerWholeListDetailUs:
    'Two plans, one optional add-on, one registration fee, and overage you cap. No setup fees, no per-user fees, no storage fees, no monthly "compliance" or "carrier" line items, no fee for canceling.',
  ledgerWholeListDetailCa:
    'Two plans, one optional add-on, and overage you cap. No registration fee, no setup fees, no per-user fees, no storage fees, no monthly "compliance" or "carrier" line items, no fee for canceling.',

  planStarterTagline: "For crews of one to three.",
  planProTagline: "For crews up to fifteen, and a second number.",
  planProBadge: "For bigger crews",
  planSeats: "{seats} teammates included",
  planOneNumber:
    "{numbers} local business number (US or Canada, your area code)",
  planTwoNumbers:
    "{numbers} local business numbers (two locations, or office and field)",
  planTexts: "Send and receive texts and pictures*",
  planMonthly: "Month to month, cancel anytime",
  planStarterCta: "Start with Starter",
  planProCta: "Start with Pro",
  planFairUseNote:
    "* Texting, pictures, and calling are included under fair use, not a hard wall: almost every crew stays well inside it, a busy month now and then is fine, and we reach out early if usage ever paces past what your plan covers. Extra texts, if a month runs hot, bill at a small per-text rate up to a spending cap you control. Storage is free on every plan, with no caps.",

  datelineUs: "{firstMonth} FIRST MONTH (US) · {starter} AFTER",
  datelineCa: "{starter}/MO · NO REGISTRATION FEE",

  elsewhereLoonext: "Loonext Starter",
  elsewhereSoftware: "Monthly software",
  elsewhereWorkload: "500 texts a month, the workload",
  elsewhereIncluded: "Included",
  elsewhereNotIncluded: "Not included, metered at 1¢/segment (~$5)",
  elsewhereCarrier: "Monthly carrier line item",
  elsewhereTotal: "Monthly total",
  elsewhereFlat: "{starter} flat",
  elsewhereQuoTotal: "~$64 + extra numbers at $5 ea.",
  elsewhereFootnote:
    "Competitor prices from their public pricing pages, July 2026; each figure is sourced on the matching comparison page. Every figure in this table is in US dollars, which is what Heymarket and Quo publish in, so the Loonext row is our US price; Canadian workspaces are quoted and billed in Canadian dollars. Heymarket's texting total assumes 500 single-segment texts at their published 3¢/segment plus their $10/mo per-campaign carrier fee. Quo's total is $57 in seats plus ~$5 of metered texting (1¢/segment) plus their published $1.50 to $3 monthly carrier maintenance, and extra numbers are $5 each. One-time registration fees excluded for all (ours is {fee}; Quo discloses $19.50; others don't say). If any number changes, tell us and we'll fix it.",

  faqTrialQ: "Is there a free trial?",
  faqTrialA:
    'No, and here\'s why. A texting number can\'t really be "free": the moment we give you one, the phone companies charge for it, and free numbers attract spammers, which wrecks message delivery for everyone. So Loonext is paid from day one, with a 30-day full money-back guarantee instead. You get a real trial; we keep the network clean.',
  faqInboundQ: "Do texts customers send me count against my plan?",
  faqInboundA:
    "No. Receiving texts is free and unlimited on every plan, and receiving photos is free too. Only what you send counts.",
  faqPhotosQ: "How do photo messages work?",
  faqPhotosA:
    "Photos work both ways on every plan, nothing to turn on. Receiving them is free, and every photo is saved for you; storage is free, with no caps. Sending photos is included too, under the same fair-use policy and overage rules as everything else you send. The exact counting mechanics live in our fair use policy.",
  faqOverageQ: "What happens if we send more than usual?",
  faqOverageA:
    "We email you at 80% and again at 100% of your included texting, so nothing starts quietly. Past that, extra texts bill at a small per-text rate up to a spending cap you control. Hit the cap and sending pauses until you raise it; account owners can do that in one click. You'll never get a surprise bill. The exact rates live in our fair use policy.",
  faqFeeTwiceQ: "Will I ever pay the registration fee twice?",
  faqFeeTwiceA:
    "No. It's charged at most once per company, ever, even if you cancel and come back. It only exists at all because the phone companies charge a real fee to review and approve every business that texts, and we'd rather show you that fee than bury it in the subscription.",
  faqChangeQ: "Can I change plans or cancel later?",
  faqChangeA:
    "Yes. Upgrades apply immediately. Downgrades apply at the end of your billing period. Canceling takes two clicks in billing settings, no phone call, no chat-with-retention. We hold your number for 30 days in case you change your mind.",
  faqPortQ: "Can I keep my current business number?",
  faqPortA:
    "Yes, transfer it to Loonext. At signup, choose “Bring my number,” give us your current carrier details, and upload a recent bill; we handle the paperwork with the phone companies from there. Transfers are free for US and Canadian numbers and typically take 1 to 7 business days, and your number keeps working on your current carrier the whole time, switching to Loonext on the transfer date. Want to text sooner? Get a new local number now and transfer your old one alongside it.",
  faqCurrencyQ: "What currency am I billed in?",
  faqCurrencyA:
    "Whichever your business is in. A Canadian workspace is priced and charged in Canadian dollars, so the amount doesn't move with the exchange rate and your bank has no conversion to add on top. A US workspace is charged in US dollars. The country you pick at signup decides it, and it's fixed once your subscription starts, so tell us before you pay if you picked the wrong one.",
  faqNotGettingQ: "What am I not getting at these prices?",
  faqNotGettingA:
    "Loonext is your business line and the work that comes out of it, not a call center: no mass text blasts, no review management, no phone menus, no queues, and no desk phones or SIP handsets. Calling is included on every plan: the app itself is the phone, so incoming calls ring the whole crew inside Loonext and whoever is free answers, you call customers back on that same business number, and callers you miss leave a voicemail we write down and get an automatic text back, so the lead still lands in your inbox. The minutes are generous under fair use, with the exact mechanics in our fair use policy. If you need blasts or review tools, a bigger platform might fit better; our comparison pages say so honestly.",
} as const;

export const pricingFr: Translated<typeof pricingEn> = {
  metaTitle: "Tarifs, {starter}/mois prix fixe pour toute l'équipe",
  metaDescription:
    "Bâtissez votre forfait et voyez le total avant de payer : Starter {starter}/mois pour un maximum de 3 personnes, Pro {pro}/mois pour un maximum de 15. Textos, photos et appels inclus sous l'utilisation équitable automatisée, stockage gratuit. Frais uniques d'enregistrement américain de {fee}. Aucuns frais par personne, aucun appel pour une soumission.",
  ogTitle: "Tarifs : {starter}/mois prix fixe pour toute l'équipe",
  ogDescription:
    "Starter {starter}/mois pour un maximum de 3 personnes, Pro {pro}/mois pour un maximum de 15. Textos, photos et appels inclus sous l'utilisation équitable automatisée, stockage gratuit. Aucuns frais par personne, aucun appel pour une soumission.",

  breadcrumbHome: "Accueil",
  breadcrumbSelf: "Tarifs",

  h1: "Un seul prix pour toute l'équipe. Rien de caché.",
  heroSub:
    "Deux forfaits, chaque coût sur cette page, et un bouton d'achat au lieu d'un appel de vente. Si vous ne trouvez pas de prix sur la page de prix d'une compagnie de textos, c'est le prix qui parle.",

  buildTitle: "Bâtissez votre forfait. Le total se met à jour au fur et à mesure.",
  buildSub:
    "Choisissez un forfait, activez seulement ce dont vous avez besoin, et voyez toute la facture avant même de taper un numéro de carte. Ce que vous bâtissez ici est exactement ce par quoi le paiement commence.",
  fairUseLink: "Voyez notre politique d'utilisation équitable.",

  enterpriseTitle: "Plus de 15 personnes dans votre équipe ?",
  enterpriseBody:
    "Enterprise, c'est un nombre illimité de sièges au même prix fixe, aucuns frais par personne, taillé pour votre équipe. Dites-nous qui vous êtes et on s'occupe du reste.",
  enterpriseCta: "Parlez-nous",

  sliderTitle: "Le prix fixe bat le prix par personne. Glissez pour voir de combien.",

  ledgerTitle: "Chaque coût, avant de payer.",
  truthUsWorks:
    "La réception des textos fonctionne dès que votre numéro est prêt, habituellement en service en une minute ou deux.",
  truthUsWait:
    "L'envoi vers des numéros américains s'active après l'approbation des compagnies de téléphone, généralement de 3 à 7 jours ouvrables. On dépose tout et on vous écrit dès que vous êtes approuvé.",
  truthCaWorks:
    "Écrire à des clients canadiens fonctionne le jour même où votre numéro est actif, habituellement en service une minute ou deux après votre abonnement. Aucun enregistrement, aucuns frais, aucune attente.",
  truthCaReceiving:
    "La réception des textos fonctionne tout de suite aussi, dès que votre numéro est prêt.",
  meterCaption:
    "Bien à l'intérieur de l'utilisation équitable, et un plafond de dépenses que vous contrôlez. On vous contacte d'avance si un mois chauffe. Aucune facture surprise.",
  meterAria:
    "L'écran d'utilisation de l'application : bien à l'intérieur de l'utilisation équitable ce mois-ci, avec le plafond de dépenses fixé par le propriétaire",

  elsewhereTitle: "La même équipe, tarifée ailleurs.",
  elsewhereIntroBefore:
    "La charge de travail qu'on tarife : une équipe de 3 personnes envoyant 500 textos simples par mois, aux prix publiés en {asOf} (chaque chiffre ci-dessous cite sa source sur nos",
  elsewhereIntroLink: "pages de comparaison",
  elsewhereIntroAfter: ") :",
  elsewhereTableCaption:
    "Coût mensuel pour une équipe de 3 personnes envoyant 500 textos : Loonext à côté de Heymarket et Quo, aux prix publiés en {asOf}.",

  segmentTitle: "C'est quoi un « texto », exactement ?",
  segmentBody:
    "Un texto simple jusqu'à 160 caractères compte pour un texto. Les textos plus longs, ou avec des émojis, en comptent plus d'un : les réseaux de textos les découpent en coulisses (le mot technique est « segments », mais vous n'avez jamais à y penser). Le champ de saisie montre toujours le compte avant l'envoi, alors il n'y a aucun mystère sur votre facture.",
  segmentAria:
    "Un message à Karen de Reyes Plumbing en train d'être compté : un texto, 122 caractères, simple",

  guaranteeTitle: "Essayez-le un mois, à nos frais si ça ne vous convient pas.",
  guaranteeBefore:
    "Si Loonext ne convient pas à votre équipe, écrivez-nous dans les 30 jours suivant votre inscription et on rembourse votre première facture au complet,",
  guaranteeUs: "abonnement et frais d'enregistrement compris",
  guaranteeCa: "tout l'abonnement compris",
  guaranteeAfter:
    ". Aucun « moins les crédits utilisés », aucun formulaire, aucun appel de rétention. On préfère avoir votre confiance que votre",
  refundLink: "Lisez toute la politique. Elle fait trois paragraphes.",

  leaveTitle: "Et si vous partez plus tard",
  leaveCancel:
    "Annulez vous-même, depuis les réglages de facturation. Aucun appel téléphonique, aucun clavardage de rétention, aucun courriel à une file de soutien.",
  leaveNoCharge:
    "Rien n'est facturé après ça. Vous continuez de travailler pendant la période que vous avez déjà payée.",
  leaveNumber:
    "Votre numéro est gardé 30 jours au cas où vous reviendriez. Après ça, il retourne à la compagnie de téléphone et peut être donné à une autre entreprise, alors les gens qui l'avaient enregistré finiront par joindre quelqu'un d'autre. Transférez-le d'abord si vous voulez le garder.",
  leavePerson:
    "Une vraie personne est joignable depuis l'intérieur de l'application, y compris sur le chemin de la sortie.",
  termsLink: "Les conditions d'annulation, au complet.",

  faqTitle: "Questions sur les tarifs, réponses directes.",

  ctaTitle: "Vous avez vu toute la liste de prix. C'est bien le but.",
  ctaChipAfter: "· Au mois · Garantie de remboursement de 30 jours",
  ledgerPlanTerm: "Votre forfait",
  ledgerPlanDetail:
    "Au mois. Starter couvre {starterSeats} personnes, Pro en couvre {proSeats}, prix fixe dans les deux cas.",
  ledgerRegisterTerm: "S'enregistrer auprès des compagnies de téléphone",
  ledgerRegisterFigure: "{fee}, une seule fois, à vie",
  ledgerRegisterDetail:
    "Les compagnies de téléphone exigent que chaque entreprise qui envoie des textos s'enregistre d'abord. Ceci couvre les frais qu'elles facturent pour vous réviser et vous approuver, et nous les payons en votre nom, y compris une nouvelle soumission si votre première tentative est refusée. Annulez et revenez l'an prochain : vous ne les paierez pas de nouveau. Ça veut dire {firstMonth} votre premier mois, puis {starter} chaque mois ensuite.",
  ledgerNoRegisterTerm: "Aucun enregistrement, aucuns frais d'installation",
  ledgerNoRegisterFigure: "{zero}, à vie",
  ledgerNoRegisterDetail:
    "Une entreprise canadienne qui écrit à des clients canadiens n'enregistre rien et ne paie aucuns frais d'installation. Votre numéro envoie le jour même où il est actif, habituellement une minute ou deux après votre abonnement, alors votre premier mois coûte la même chose que chaque mois ensuite.",
  ledgerExtraTerm: "Textos supplémentaires",
  ledgerExtraFigure: "Plafonnés par vous",
  ledgerExtraDetail:
    "Les textos et les photos sont inclus sous notre politique d'utilisation équitable automatisée, et presque toutes les équipes restent bien à l'intérieur. Si un mois chauffe, les textos supplémentaires sont facturés à un petit tarif à l'unité, seulement jusqu'au plafond de dépenses que vous contrôlez, et on vous écrit à 80 % puis à 100 % de vos textos inclus avant. Les tarifs exacts vivent dans notre politique d'utilisation équitable.",
  ledgerStorageTerm: "Stockage",
  ledgerStorageFigure: "0 $, sans plafond",
  ledgerStorageDetail:
    "Les fichiers que vous joignez et les photos que les clients envoient sont stockés gratuitement, sur tous les forfaits. Aucun bassin de stockage, aucun compteur, aucun supplément de stockage à acheter, et rien ne s'arrête quand vous en gardez beaucoup.",
  ledgerAddOnsTerm: "Suppléments optionnels, si vous les activez",
  ledgerAddOnsDetail:
    "Les appels sont inclus dans chaque forfait, ce n'est pas un supplément : les appels entrants font sonner votre équipe dans Loonext et celui qui est libre répond, vous rappelez les clients depuis l'application sur votre numéro d'entreprise, et ceux que vous manquez laissent un message vocal et reçoivent un texto automatique en retour, avec des minutes d'appel généreuses sous l'utilisation équitable (les mécaniques vivent dans notre politique d'utilisation équitable). Un seul supplément existe : les numéros canadiens, {addOn}/mois, qui ajoutent des numéros canadiens que vous pouvez obtenir et utiliser à côté de votre numéro américain. Il n'est pas encore activable ; on le vendra quand il fonctionnera, à ce prix, et rien ici n'est requis pour envoyer des textos.",
  ledgerTaxTerm: "Taxes",
  ledgerTaxDetailUs:
    "Les prix sont en dollars américains, plus les taxes de vente là où elles s'appliquent, calculées au paiement.",
  ledgerTaxDetailCa:
    "Votre forfait est établi et facturé en dollars canadiens, plus les taxes là où elles s'appliquent, calculées au paiement. Le montant sur votre relevé ne bouge pas avec le taux de change.",
  ledgerWholeListTerm: "C'est toute la liste.",
  ledgerWholeListDetailUs:
    "Deux forfaits, un supplément optionnel, des frais d'enregistrement et un dépassement que vous plafonnez. Aucuns frais d'installation, aucuns frais par personne, aucuns frais de stockage, aucune ligne mensuelle de « conformité » ou d'« opérateur », aucuns frais d'annulation.",
  ledgerWholeListDetailCa:
    "Deux forfaits, un supplément optionnel, et un dépassement que vous plafonnez. Aucuns frais d'enregistrement, aucuns frais d'installation, aucuns frais par personne, aucuns frais de stockage, aucune ligne mensuelle de « conformité » ou d'« opérateur », aucuns frais d'annulation.",

  planStarterTagline: "Pour les équipes de une à trois personnes.",
  planProTagline:
    "Pour les équipes jusqu'à quinze personnes, et un deuxième numéro.",
  planProBadge: "Pour les plus grandes équipes",
  planSeats: "{seats} coéquipiers inclus",
  planOneNumber:
    "{numbers} numéro d'entreprise local (É.-U. ou Canada, votre indicatif régional)",
  planTwoNumbers:
    "{numbers} numéros d'entreprise locaux (deux emplacements, ou bureau et terrain)",
  planTexts: "Envoyez et recevez textos et photos*",
  planMonthly: "Au mois, annulez quand vous voulez",
  planStarterCta: "Commencer avec Starter",
  planProCta: "Commencer avec Pro",
  planFairUseNote:
    "* Les textos, les photos et les appels sont inclus sous l'utilisation équitable, pas un mur rigide : presque toutes les équipes restent bien à l'intérieur, un mois occupé de temps en temps est correct, et on vous contacte d'avance si l'utilisation dépasse ce que votre forfait couvre. Les textos supplémentaires, si un mois chauffe, sont facturés à un petit tarif à l'unité jusqu'à un plafond de dépenses que vous contrôlez. Le stockage est gratuit sur tous les forfaits, sans plafond.",

  datelineUs: "{firstMonth} PREMIER MOIS (É.-U.) · {starter} ENSUITE",
  datelineCa: "{starter}/MOIS · AUCUNS FRAIS D'ENREGISTREMENT",

  elsewhereLoonext: "Loonext Starter",
  elsewhereSoftware: "Logiciel mensuel",
  elsewhereWorkload: "500 textos par mois, la charge de travail",
  elsewhereIncluded: "Inclus",
  elsewhereNotIncluded: "Non inclus, facturé 1 ¢/segment (~5 $)",
  elsewhereCarrier: "Ligne mensuelle d'opérateur",
  elsewhereTotal: "Total mensuel",
  elsewhereFlat: "{starter} prix fixe",
  elsewhereQuoTotal: "~64 $ + numéros supplémentaires à 5 $ ch.",
  elsewhereFootnote:
    "Prix des concurrents tirés de leurs pages de prix publiques, juillet 2026 ; chaque chiffre est sourcé sur la page de comparaison correspondante. Chaque chiffre de ce tableau est en dollars américains, ce qui est la monnaie dans laquelle Heymarket et Quo publient, alors la ligne Loonext est notre prix américain ; les espaces de travail canadiens sont établis et facturés en dollars canadiens. Le total de textos de Heymarket suppose 500 textos d'un seul segment à leur tarif publié de 3 ¢/segment plus leurs frais d'opérateur de 10 $/mois par campagne. Le total de Quo est de 57 $ en sièges plus ~5 $ de textos facturés à l'unité (1 ¢/segment) plus leur entretien d'opérateur publié de 1,50 $ à 3 $ par mois, et les numéros supplémentaires sont à 5 $ chacun. Frais d'enregistrement uniques exclus pour tous (les nôtres sont de {fee} ; Quo déclare 19,50 $ ; les autres ne le disent pas). Si un chiffre change, dites-le-nous et on le corrigera.",

  faqTrialQ: "Y a-t-il un essai gratuit ?",
  faqTrialA:
    "Non, et voici pourquoi. Un numéro pour texter ne peut pas vraiment être « gratuit » : dès qu'on vous en donne un, les compagnies de téléphone le facturent, et les numéros gratuits attirent les pollueurs, ce qui ruine la livraison des messages pour tout le monde. Alors Loonext est payant dès le premier jour, avec une garantie de remboursement complet de 30 jours à la place. Vous avez un vrai essai ; on garde le réseau propre.",
  faqInboundQ:
    "Est-ce que les textos que les clients m'envoient comptent dans mon forfait ?",
  faqInboundA:
    "Non. La réception des textos est gratuite et illimitée sur tous les forfaits, et la réception des photos est gratuite aussi. Seul ce que vous envoyez compte.",
  faqPhotosQ: "Comment fonctionnent les messages photo ?",
  faqPhotosA:
    "Les photos fonctionnent dans les deux sens sur tous les forfaits, rien à activer. Les recevoir est gratuit, et chaque photo est conservée pour vous ; le stockage est gratuit, sans plafond. Envoyer des photos est inclus aussi, sous la même politique d'utilisation équitable et les mêmes règles de dépassement que tout ce que vous envoyez. Les mécaniques exactes de calcul vivent dans notre politique d'utilisation équitable.",
  faqOverageQ: "Que se passe-t-il si on envoie plus que d'habitude ?",
  faqOverageA:
    "On vous écrit à 80 % puis à 100 % de vos textos inclus, alors rien ne commence en silence. Au-delà, les textos supplémentaires sont facturés à un petit tarif à l'unité jusqu'à un plafond de dépenses que vous contrôlez. Atteignez le plafond et l'envoi s'arrête jusqu'à ce que vous le releviez ; les propriétaires du compte peuvent le faire en un clic. Vous n'aurez jamais de facture surprise. Les tarifs exacts vivent dans notre politique d'utilisation équitable.",
  faqFeeTwiceQ: "Vais-je payer les frais d'enregistrement deux fois ?",
  faqFeeTwiceA:
    "Non. Ils sont facturés au plus une fois par entreprise, à vie, même si vous annulez et revenez. Ils n'existent que parce que les compagnies de téléphone facturent de vrais frais pour réviser et approuver chaque entreprise qui envoie des textos, et on préfère vous montrer ces frais plutôt que de les enterrer dans l'abonnement.",
  faqChangeQ: "Puis-je changer de forfait ou annuler plus tard ?",
  faqChangeA:
    "Oui. Les mises à niveau s'appliquent immédiatement. Les rétrogradations s'appliquent à la fin de votre période de facturation. Annuler prend deux clics dans les réglages de facturation, sans appel téléphonique, sans clavardage de rétention. On garde votre numéro 30 jours au cas où vous changeriez d'idée.",
  faqPortQ: "Puis-je garder mon numéro d'entreprise actuel ?",
  faqPortA:
    "Oui, transférez-le vers Loonext. À l'inscription, choisissez « Amener mon numéro », donnez-nous les détails de votre fournisseur actuel et téléversez une facture récente ; on s'occupe de la paperasse avec les compagnies de téléphone à partir de là. Les transferts sont gratuits pour les numéros américains et canadiens et prennent habituellement de 1 à 7 jours ouvrables, et votre numéro continue de fonctionner chez votre fournisseur actuel tout du long, basculant sur Loonext à la date du transfert. Vous voulez écrire plus tôt ? Prenez un nouveau numéro local maintenant et transférez l'ancien à côté.",
  faqCurrencyQ: "Dans quelle monnaie suis-je facturé ?",
  faqCurrencyA:
    "Celle de votre entreprise. Un espace de travail canadien est établi et facturé en dollars canadiens, alors le montant ne bouge pas avec le taux de change et votre banque n'a aucune conversion à ajouter par-dessus. Un espace de travail américain est facturé en dollars américains. Le pays que vous choisissez à l'inscription le décide, et c'est fixé une fois votre abonnement commencé, alors dites-le-nous avant de payer si vous vous êtes trompé.",
  faqNotGettingQ: "Qu'est-ce que je n'ai pas à ces prix ?",
  faqNotGettingA:
    "Loonext est votre ligne d'affaires et le travail qui en sort, pas un centre d'appels : aucun envoi de textos en masse, aucune gestion d'avis, aucun menu téléphonique, aucune file d'attente, et aucun téléphone de bureau ni combiné SIP. Les appels sont inclus sur tous les forfaits : l'application elle-même est le téléphone, alors les appels entrants font sonner toute l'équipe dans Loonext et celui qui est libre répond, vous rappelez les clients sur ce même numéro d'entreprise, et ceux que vous manquez laissent un message vocal qu'on met par écrit et reçoivent un texto automatique en retour, alors le client potentiel atterrit quand même dans votre boîte. Les minutes sont généreuses sous l'utilisation équitable, avec les mécaniques exactes dans notre politique d'utilisation équitable. Si vous avez besoin d'envois en masse ou d'outils d'avis, une plus grosse plateforme conviendra peut-être mieux ; nos pages de comparaison le disent honnêtement.",
};

const PRICING_COPY = {
  en: pricingEn,
  "fr-CA": pricingFr,
} as const;

export type PricingCopy = typeof pricingEn | typeof pricingFr;

export function pricingCopy(locale: MarketingLocale = "en"): PricingCopy {
  return PRICING_COPY[locale] ?? pricingEn;
}
