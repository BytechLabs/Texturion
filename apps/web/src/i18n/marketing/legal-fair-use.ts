import type { Translated } from "../translated";

import type { MarketingLocale } from "./footer";

export const legalFairUseEn = {
  metaTitle: "Fair use policy",
  metaDescription:
    "Loonext's flat-rate texting fair-use policy, in one place: what each plan includes, overage rates under a spending cap you control, and free storage.",
  title: "Fair use policy",
  breadcrumbLabel: "Fair use",
  lastUpdated: "July 11, 2026",
  summary:
    "Loonext is a flat monthly price with texting included under an automated fair-use policy, and this page is the one place the concrete mechanics live. Starter includes 500 texts a month and Pro includes 2,500, and only the texts you send count because receiving is always free; extra texts are billed at 3¢ (Starter) or 2.5¢ (Pro) each up to a monthly spending cap you control, which pauses sending before a bill can surprise you. Calling is included on every plan and works the same way: 2,500 calling minutes on Starter and 6,000 on Pro, both directions, extra minutes at 1¢ each under the same cap. Storage is free, with no caps. We reserve a narrow right to step in only when usage stops looking like one business texting its own customers.",

  sectionWhy: "Why this exists",
  sectionIncluded: "What your plan includes",
  sectionOverage: "Overage and your spending cap",
  sectionCarrierLimits: "The carrier's own daily limit",
  sectionWhatFor: "What Loonext is for",
  sectionReasonable: "Reasonable use",
  sectionNumbers: "Phone numbers",
  sectionAddOns: "Voice and picture messages",
  sectionStorage: "Storage",
  sectionEnforcement: "If usage is out of bounds",
  sectionContact: "Contact",

  termsLink: "terms of service",
  aupLink: "acceptable use policy",
  pricingLink: "pricing page",
  refundsLink: "30-day money-back guarantee",
  why:
    "Loonext charges one flat price for the whole crew, with a set number of texts included. That only works when usage looks like a business texting its own customers. So this page tells you exactly what is included, what happens when you go past it, and the one line we hold, with no surprises. It is part of our {terms} and sits next to the {aup}, which covers who you may text and what you may say.",
  included:
    "Starter is {starterPrice}/mo for up to 3 people and includes 500 texts a month on one number. Pro is {proPrice}/mo for up to 15 people, includes 2,500 texts, and adds a second number. A text is counted in segments (about 160 characters each), the same way the carriers count them, so one long message can use more than one segment. Only the texts you send count. Receiving is free and unlimited on every plan, in every month, and never counts against what your plan includes. This page is the canonical home of those figures; the {pricing} describes plans in plain fair-use terms and points here for the mechanics. Think of the allowances as a fair-use line for one business texting its own customers, not a target: almost every crew stays well inside them without thinking about it, and a busy month now and then is fine.",
  overage:
    "If you send more than your plan includes, each extra segment is billed at 3¢ on Starter or 2.5¢ on Pro, up to a monthly spending cap you control (3× your included texts by default, adjustable in billing settings). You are never billed by surprise: we alert the account owner at 80% and again at 100% of your included texts, so paid overage never begins unnoticed, and sending pauses the moment you reach your cap. Raise the cap, upgrade, or wait for the next cycle. Your call. Beyond those fixed points, we also watch how your usage is pacing across the whole period and reach out early if you are on track to run past what your plan comfortably covers, so you can adjust before it adds up rather than hear about it after.",
  carrierOne:
    "Separately from your plan, the US mobile carriers set their own daily ceiling on every registered business, and it applies to us the same way it applies to everyone. On the registration we use for most businesses, T-Mobile allows up to 2,000 messages a day to T-Mobile numbers, and AT&T limits how fast you can send rather than how many. A sole proprietor registration is half that. These are the carriers' numbers, not ours, and they can change them.",
  carrierTwo:
    "For almost every crew this never comes up: a Pro plan includes 2,500 texts for the whole month, so an ordinary day is nowhere near a daily ceiling. It matters if you send a large batch in one go on one day. If a send is ever refused for this reason we will say so plainly, name the carrier, and tell you when it clears, rather than letting it look like a failure on our side.",
  carrierThree:
    "If your business grows past it, moving to a higher registration tier means a fresh carrier registration with its own review, which takes days rather than minutes. Tell us before you need it and we will start it early.",
  whatFor:
    "Loonext is a shared inbox for conversational texting with customers who agreed to hear from you: quotes, scheduling, on-my-way texts, and follow-ups. It is not a bulk-marketing platform, a mass-campaign blaster, an application-to-person (A2P) messaging gateway, a lead-generation tool for texting strangers, or a service to resell. We do not build those tools, and using Loonext as one falls outside fair use. What you may send, and to whom, is governed by the {aup}.",
  reasonable:
    "Almost every business stays well inside its plan. For the rare account whose usage stops looking normal, fair, and reasonable for one business texting its own customers, we reserve the right to review it and, where needed, to rate-limit it, ask you to move to a plan that fits, or in serious cases suspend it. The signals we weigh include volume far above the plan with few replies coming back, automated or bulk sending, one-to-many blasts, many messages to numbers that never consented, or a single account shared across separate businesses. Whenever we reasonably can, we tell you first and give you a fair chance to adjust or upgrade before we act.",
  numbers:
    "Your plan includes its numbers (one on Starter, two on Pro), and you can choose, release, and set up a replacement number yourself at no extra charge. Getting a fresh number when you genuinely need one is part of the plan. Rapidly cycling through numbers is not: because each new number is a real cost and heavy churn hurts delivery for everyone, the number of times you can set up a new number is limited, and churning numbers to dodge opt-outs or carrier filtering breaks both this policy and the {aup}.",
  addOns:
    "Picture messages are included on every plan, both directions. Receiving photos is free; each photo you send counts as three texts from your monthly allowance and follows the same overage rules as any other text you send. Calling is included on every plan and follows the same fair-use mechanics as texting: Starter includes 2,500 calling minutes a month and Pro includes 6,000, shared by both directions. A minute is a minute you actually talked, whether the crew answered an incoming call in the app or you called a customer from it, always from your business number; ringing that goes unanswered never counts. Extra minutes are billed at 1¢ each, under the same monthly spending cap you control, and we alert the owner at 80% and again at 100% of the included minutes so paid overage never begins unnoticed. Only at your cap does calling pause for the rest of the cycle: missed callers still get your text-back, and the texting in your base plan keeps working either way.",
  storage:
    "Storage is free. Files you attach to notes and the pictures customers send you are kept with no storage caps, no storage add-on, and no meter: uploads never pause and inbound photos never stop being saved because of space. The one line we hold is the same reasonable-use line as everything else: if a workspace's storage stops looking like one business keeping its own customer conversations (for example, using Loonext as a general file locker), we will contact you and work it out person to person. Nothing is blocked automatically.",
  enforcement:
    "Depending on severity, we may rate-limit an account, ask you to upgrade, pause a feature, or, for serious or repeated abuse, suspend or end the account to protect recipients, delivery, and the network we all share. Where we reasonably can, we give notice and a reasonable period to put things right first. This policy is enforced consistently with our {terms} and {aup}, and if you decide Loonext is not for you, the {refunds} still applies.",
  contact:
    "Expecting a busy month, or not sure whether a use fits? Tell us first and we will help you land on the right plan: {supportEmail}.",
} as const;

export const legalFairUseFr: Translated<typeof legalFairUseEn> = {
  metaTitle: "Politique d'utilisation équitable",
  metaDescription:
    "La politique d'utilisation équitable des textos à tarif fixe de Loonext : ce que chaque forfait comprend, les frais d'utilisation excédentaire sous un plafond que vous contrôlez et le stockage gratuit.",
  title: "Politique d'utilisation équitable",
  breadcrumbLabel: "Utilisation équitable",
  lastUpdated: "11 juillet 2026",
  summary:
    "Loonext offre un prix mensuel fixe qui comprend les textos selon une politique automatisée d'utilisation équitable, et cette page rassemble tous les mécanismes concrets. Le forfait Starter comprend 500 textos par mois et Pro en comprend 2 500; seuls les textos envoyés comptent, puisque la réception est toujours gratuite. Chaque texto supplémentaire coûte 3 ¢ avec Starter ou 2,5 ¢ avec Pro, jusqu'à un plafond mensuel que vous contrôlez et qui interrompt les envois avant qu'une facture vous surprenne. Les appels sont compris dans chaque forfait et fonctionnent de la même façon : 2 500 minutes avec Starter et 6 000 avec Pro, dans les deux directions, puis 1 ¢ la minute sous le même plafond. Le stockage est gratuit et sans plafond. Nous nous réservons un droit d'intervention restreint uniquement lorsque l'utilisation ne ressemble plus à celle d'une entreprise qui écrit à ses propres clients.",

  sectionWhy: "Pourquoi cette politique existe",
  sectionIncluded: "Ce que votre forfait comprend",
  sectionOverage: "Utilisation excédentaire et plafond de dépenses",
  sectionCarrierLimits: "La limite quotidienne des fournisseurs sans fil",
  sectionWhatFor: "À quoi sert Loonext",
  sectionReasonable: "Utilisation raisonnable",
  sectionNumbers: "Numéros de téléphone",
  sectionAddOns: "Appels et messages photo",
  sectionStorage: "Stockage",
  sectionEnforcement: "Si l'utilisation dépasse les limites",
  sectionContact: "Nous joindre",

  termsLink: "conditions d'utilisation",
  aupLink: "politique d'utilisation acceptable",
  pricingLink: "page des tarifs",
  refundsLink: "garantie de remboursement de 30 jours",
  why:
    "Loonext facture un prix fixe pour toute l'équipe, avec un nombre déterminé de textos compris. Cela fonctionne lorsque l'utilisation ressemble à celle d'une entreprise qui écrit à ses propres clients. Cette page explique donc exactement ce qui est compris, ce qui arrive lorsque vous le dépassez et la seule limite que nous imposons, sans surprise. Elle fait partie de nos {terms} et accompagne la {aup}, qui précise à qui vous pouvez écrire et ce que vous pouvez envoyer.",
  included:
    "Starter coûte {starterPrice}/mois pour un maximum de 3 personnes et comprend 500 textos par mois sur un numéro. Pro coûte {proPrice}/mois pour un maximum de 15 personnes, comprend 2 500 textos et ajoute un deuxième numéro. Un texto est compté en segments d'environ 160 caractères, comme le font les fournisseurs sans fil; un long message peut donc utiliser plusieurs segments. Seuls les textos que vous envoyez comptent. La réception est gratuite et illimitée avec tous les forfaits, chaque mois, et ne réduit jamais ce que votre forfait comprend. Cette page est la source officielle de ces chiffres; la {pricing} décrit les forfaits en termes simples et renvoie ici pour les mécanismes. Voyez ces quantités comme la limite d'utilisation équitable d'une entreprise qui écrit à ses propres clients, pas comme un objectif : presque toutes les équipes restent bien en dessous sans y penser, et un mois plus occupé à l'occasion ne pose aucun problème.",
  overage:
    "Si vous envoyez plus que ce que votre forfait comprend, chaque segment supplémentaire coûte 3 ¢ avec Starter ou 2,5 ¢ avec Pro, jusqu'à un plafond mensuel que vous contrôlez (par défaut, 3 fois le nombre de textos compris, réglable dans les paramètres de facturation). Vous ne recevez jamais une facture surprise : nous avisons la personne propriétaire du compte à 80 %, puis à 100 % des textos compris. L'utilisation payante ne commence donc jamais à votre insu, et les envois s'interrompent dès que vous atteignez le plafond. Augmentez-le, changez de forfait ou attendez le prochain cycle; c'est votre choix. En plus de ces seuils fixes, nous surveillons le rythme de votre utilisation pendant toute la période et communiquons avec vous tôt si elle risque de dépasser confortablement votre forfait, afin que vous puissiez vous ajuster avant que les frais s'accumulent.",
  carrierOne:
    "Indépendamment de votre forfait, les fournisseurs mobiles américains imposent leur propre plafond quotidien à chaque entreprise inscrite, et il s'applique à nous comme à tout le monde. Pour l'inscription utilisée par la plupart des entreprises, T-Mobile permet jusqu'à 2 000 messages par jour vers ses numéros, tandis qu'AT&T limite la vitesse d'envoi plutôt que la quantité. La limite d'une entreprise individuelle correspond à la moitié. Ces chiffres appartiennent aux fournisseurs, pas à nous, et ils peuvent les modifier.",
  carrierTwo:
    "Pour presque toutes les équipes, cette limite ne se présente jamais : Pro comprend 2 500 textos pour tout le mois, alors une journée normale reste très loin d'un plafond quotidien. Elle compte si vous envoyez un gros lot d'un seul coup dans la même journée. Si un envoi est refusé pour cette raison, nous le dirons clairement, nommerons le fournisseur et indiquerons quand le blocage prendra fin, plutôt que de laisser croire à une panne de notre côté.",
  carrierThree:
    "Si votre entreprise dépasse cette limite en grandissant, le passage à un niveau d'inscription supérieur exige une nouvelle inscription auprès des fournisseurs et leur propre examen, ce qui prend des jours plutôt que des minutes. Prévenez-nous avant d'en avoir besoin et nous commencerons tôt.",
  whatFor:
    "Loonext est une boîte de réception partagée pour des conversations par texto avec des clients qui ont accepté de vous entendre : soumissions, planification, avis d'arrivée et suivis. Ce n'est ni une plateforme de marketing de masse, ni un outil de campagne massive, ni une passerelle de messagerie application-personne (A2P), ni un outil de prospection par texto auprès d'inconnus, ni un service à revendre. Nous ne créons pas ces outils, et utiliser Loonext ainsi sort de l'utilisation équitable. Ce que vous pouvez envoyer et à qui est régi par la {aup}.",
  reasonable:
    "Presque toutes les entreprises restent bien en deçà de leur forfait. Pour le rare compte dont l'utilisation cesse de paraître normale, équitable et raisonnable pour une entreprise qui écrit à ses propres clients, nous nous réservons le droit de l'examiner et, au besoin, de limiter son débit, de vous demander de choisir un forfait adapté ou, dans les cas graves, de le suspendre. Nous tenons notamment compte d'un volume très supérieur au forfait avec peu de réponses, d'envois automatisés ou massifs, de messages envoyés à plusieurs personnes à la fois, de nombreux numéros sans consentement ou d'un seul compte partagé entre des entreprises distinctes. Chaque fois que c'est raisonnablement possible, nous vous prévenons et vous donnons une chance équitable de vous ajuster ou de changer de forfait avant d'agir.",
  numbers:
    "Votre forfait comprend ses numéros, soit un avec Starter et deux avec Pro, et vous pouvez choisir, libérer et configurer vous-même un numéro de remplacement sans frais. Obtenir un nouveau numéro lorsque vous en avez réellement besoin fait partie du forfait. En changer rapidement et souvent n'en fait pas partie : chaque nouveau numéro a un coût réel et un roulement important nuit à la livraison pour tout le monde. Le nombre de nouveaux numéros que vous pouvez configurer est donc limité, et changer de numéro pour contourner les retraits ou le filtrage des fournisseurs enfreint cette politique et la {aup}.",
  addOns:
    "Les messages photo sont compris dans chaque forfait, dans les deux directions. La réception de photos est gratuite; chaque photo envoyée compte comme trois textos dans votre quantité mensuelle et suit les mêmes règles d'utilisation excédentaire. Les appels sont compris dans chaque forfait et suivent les mêmes mécanismes d'utilisation équitable : Starter comprend 2 500 minutes par mois et Pro en comprend 6 000, partagées entre les deux directions. Une minute correspond à une minute de conversation réelle, que l'équipe réponde à un appel dans l'application ou appelle un client à partir du numéro d'entreprise; une sonnerie sans réponse ne compte jamais. Chaque minute supplémentaire coûte 1 ¢ sous le même plafond mensuel, et nous avisons la personne propriétaire à 80 %, puis à 100 % des minutes comprises afin que les frais ne commencent jamais à son insu. Les appels s'interrompent pour le reste du cycle seulement au plafond : les appels manqués reçoivent toujours votre texto de retour, et les textos du forfait de base continuent de fonctionner.",
  storage:
    "Le stockage est gratuit. Les fichiers joints aux notes et les photos envoyées par les clients sont conservés sans plafond, sans option payante et sans compteur : les téléversements ne s'interrompent jamais et les photos reçues continuent d'être enregistrées. Nous appliquons la même limite d'utilisation raisonnable que partout ailleurs : si le stockage d'un espace de travail cesse de ressembler aux conversations avec les clients d'une seule entreprise, par exemple si Loonext sert de casier de fichiers général, nous communiquerons avec vous et réglerons la situation de personne à personne. Rien n'est bloqué automatiquement.",
  enforcement:
    "Selon la gravité, nous pouvons limiter le débit d'un compte, vous demander de changer de forfait, interrompre une fonction ou, en cas d'abus grave ou répété, suspendre ou fermer le compte afin de protéger les destinataires, la livraison et le réseau que nous partageons. Lorsque c'est raisonnablement possible, nous donnons d'abord un avis et un délai raisonnable pour corriger la situation. Cette politique est appliquée conformément à nos {terms} et à notre {aup}; si vous décidez que Loonext ne vous convient pas, la {refunds} s'applique toujours.",
  contact:
    "Vous prévoyez un mois occupé ou vous ne savez pas si une utilisation convient? Dites-le-nous d'abord et nous vous aiderons à choisir le bon forfait : {supportEmail}.",
};

const COPY = { en: legalFairUseEn, "fr-CA": legalFairUseFr } as const;

export function legalFairUseCopy(locale: MarketingLocale = "en") {
  return COPY[locale] ?? legalFairUseEn;
}
