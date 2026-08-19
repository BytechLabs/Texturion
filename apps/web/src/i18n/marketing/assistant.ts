import type { Translated } from "../translated";

import type { MarketingLocale } from "./footer";

/**
 * D138 — /features/assistant, in both languages.
 *
 * ## The one claim this page cannot soften
 *
 * Lou **never sends**. The page says it in the dateline, the h1, the facts and
 * three of the six answers, because the whole product position rests on it: a
 * machine that answers a customer in your name is the thing this is not. The
 * French has to be as flat — *n'envoie jamais*, *ne réserve rien*, *ne parle
 * jamais à votre client en votre nom*. A translation that reached for
 * *automatiquement* or softened "never" into "does not usually" would be
 * making a different promise in a language whoever signs it off may not read.
 *
 * `Lou` is a name and stays. So does `Cloudflare Workers AI`, which is a
 * product a reader may want to look up.
 *
 * ## The caps are numbers, and numbers move
 *
 * 1,500 / 500 / 1,000 are product facts stated on the page. French Canadian
 * writes the thousands separator as a space, not a comma: `1 500`. A comma
 * there reads as a decimal point to a French reader, which on a page about
 * limits is the one place it must not.
 */
export const assistantEn = {
  metaTitle: "Lou, the assistant that drafts and never sends",
  metaDescription:
    "Lou drafts replies for you to edit, writes voicemails down so you can read them, and fills in a job's address and due date from the customer's own words. A person always sends. Included on every plan.",

  breadcrumbHome: "Home",
  breadcrumbSelf: "Lou, your assistant",

  dateline: "DRAFTS. NEVER SENDS.",
  h1: "Lou does the typing. A person still does the answering.",
  heroSub:
    "Lou is the assistant inside Loonext. It drafts a reply you can edit, writes a voicemail down so you can read it at a red light, and fills in a job's address and due date from what the customer actually said. It never sends anything, never books anything, and never talks to your customer as you. Included on every plan, and every part of it can be switched off.",
  visualCaption:
    "A draft waiting in the composer, and the task it filled in. Neither has gone anywhere.",
  visualAria:
    "A reply drafted by Lou sitting unsent in the Loonext composer, above a task it filled in",

  coreEyebrow: "The core idea",
  coreTitle: "A suggestion is not a decision.",
  coreBodyOne:
    "Everything Lou produces lands in front of a person before it goes anywhere. A drafted reply sits in the composer waiting to be edited or thrown away. An address it read out of a text is a field you can correct. Nothing is queued, nothing sends on a timer, and there is no setting that makes any of it automatic, because the moment a machine answers a customer in your name you have stopped running your own business.",
  coreBodyTwo:
    'That is also the honest difference between this and an "AI receptionist". Lou does not hold a conversation with your customer. The one place it speaks to them at all is a single extra line in your voicemail greeting, asking what the job is, and that is the one feature that ships turned off.',

  doesEyebrow: "What it actually does",
  doesTitle: "Four jobs, five switches.",
  doesDraftTitle: "Drafts the reply",
  doesDraftBody:
    "Lou reads the thread and writes a reply in your voice, grounded in one sentence you wrote about what your business does. You edit it or bin it. It never sends. If you have told Lou nothing about the business, it will not invent a description of it.",
  doesVoicemailTitle: "Writes the voicemail down",
  doesVoicemailBody:
    "A voicemail arrives as text you can read between jobs and search months later, instead of a badge you have to find somewhere quiet to listen to. The recording is still there.",
  doesTaskTitle: "Fills in the job",
  doesTaskBody:
    "Promote a text to a task and Lou pulls the address and the due date out of what the customer wrote. Two separate switches, so a crew that wants the address but not the date can have exactly that.",
  doesIntakeTitle: "Pulls the job out of a voicemail",
  doesIntakeBody:
    "Off by default. Lou reads the transcript and shows what the caller wanted and where, above the recording. Your greeting is yours — we do not add a line to it. Nothing is booked and nobody meets a menu.",

  factsEyebrow: "The plain facts",
  factsNeverSends:
    "Lou never sends a message, never answers a call, and never books anything. Every output is a suggestion a person accepts, edits, or discards.",
  factsDefaults:
    "Four features arrive ON: drafted replies, voicemail transcripts, task addresses, task due dates. Voicemail intake arrives OFF, because it is the only one your customer hears. An owner can switch any of them either way.",
  factsCaps:
    "The caps are per workspace per calendar month and they are hard: 1,500 drafted replies, 500 voicemail transcripts, 1,000 task details. Past a cap the feature stops for the rest of the month rather than billing you more, and the crew is told which cap it was.",
  factsModels:
    "The models run on Cloudflare Workers AI in the same account that hosts the app. Your message content and voicemail audio are not used to train models, by Cloudflare's published policy and by ours. What comes back is stored in your workspace like any other message and deleted with it.",

  pricingBefore:
    "Lou is included at both prices with nothing to enable and no per-seat or per-use charge:",
  privacyLink: "privacy policy",
  subprocessorsLink: "subprocessors page",

  relatedEyebrow: "Where Lou shows up",
  relatedTitle:
    "The assistant is not a screen of its own. It appears inside the things you were already doing.",
  relatedInboxTitle: "Shared inbox",
  relatedInboxBody: "Where a drafted reply waits for you to edit it.",
  relatedCallsTitle: "Calls and voicemail",
  relatedCallsBody: "Where the transcript and the intake questions live.",
  relatedPrivacyTitle: "Privacy",
  relatedPrivacyBody: "What is read, what is stored, and for how long.",
  relatedSubprocessorsTitle: "Subprocessors",
  relatedSubprocessorsBody: "Every third party that sees customer data, named.",

  faqTitle: "Assistant questions, straight answers.",
  faqSendQ: "Will Lou reply to my customers without me?",
  faqSendA:
    "No, and there is no setting that would let it. Every draft waits in the composer for a person to read, change, or delete. The only message Loonext ever sends on its own is your after-hours auto-reply and your missed-call text back, and both of those are words you wrote yourself, not words Lou wrote.",
  faqTrainQ: "Is my customers' message content used to train AI models?",
  faqTrainA:
    "No. The models run on Cloudflare Workers AI inside the same account that hosts the app, and message content and voicemail audio are not used for training, by Cloudflare's published policy and by ours. Anything Lou produces is stored in your workspace like any other message and is deleted when that data is.",
  faqOffQ: "Can I turn it off?",
  faqOffA:
    "Yes, feature by feature, in Settings under AI, by an owner or admin. Four are on when you arrive and one, voicemail intake, is off. Turning a feature off stops it immediately; nothing already produced is removed, because it is your workspace's data at that point.",
  faqCapQ: "What happens when we hit a monthly cap?",
  faqCapA:
    "That feature stops for the rest of the calendar month and the crew is told which cap it was. Nothing bills more and nothing degrades quietly. A voicemail past the transcript cap still arrives as a recording; a reply past the draft cap is just a reply you type yourself.",
  faqIntakeQ: "Why is the voicemail question off by default when everything else is on?",
  faqIntakeA:
    "Because it is the only one your customer experiences. The others produce something a member of your crew reads and decides about. That one changes what a stranger hears when they ring your business, in your name, and a default that speaks for you is not ours to pick.",
  faqBusinessQ: "Does Lou know anything about my business?",
  faqBusinessA:
    "Only one sentence, which you write, describing what you do. It grounds the drafts so they sound like your trade instead of generic support copy. If you leave it blank, Lou will not describe your business at all rather than guess, because an invented answer to a customer is worse than no answer.",

  ctaTitle: "Let the typing be somebody else's job.",
  ctaSubBefore:
    "Drafted replies, voicemails in writing, and jobs that fill themselves in,",
  ctaSubAfter: ". See the price.",

  visualBadge: "AI writes texts",
  visualIncoming:
    "Hi, my water heater is leaking all over the basement floor. Can somebody come out today? I’m at 114 Bishop St.",
  visualDraftedBy: "Lou drafted this",
  visualEditFirst: "Edit before you send",
  visualDraft:
    "Sorry to hear that. Shut the water off at the valve on top of the tank if you can reach it. We can have someone at 114 Bishop St this afternoon between 2 and 4. Does that work?",
  visualNotSent: "Nothing is sent until you press it.",
  visualSend: "Send",
  visualTaskLabel: "New task, filled in from that message",
  visualAddressChip: "114 Bishop St",
  visualTaskTitle: "Water heater leak, Bishop St",
  visualTaskDue: "Due today",
} as const;

export const assistantFr: Translated<typeof assistantEn> = {
  metaTitle: "Lou, l'adjoint qui rédige et n'envoie jamais",
  metaDescription:
    "Lou rédige des réponses que vous modifiez, écrit les messages vocaux pour que vous puissiez les lire, et remplit l'adresse et l'échéance d'un travail à partir des mots mêmes du client. Une personne envoie toujours. Inclus dans tous les forfaits.",

  breadcrumbHome: "Accueil",
  breadcrumbSelf: "Lou, votre adjoint",

  dateline: "RÉDIGE. N'ENVOIE JAMAIS.",
  h1: "Lou fait la dactylographie. Une personne fait encore la réponse.",
  heroSub:
    "Lou est l'adjoint intégré à Loonext. Il rédige une réponse que vous pouvez modifier, écrit un message vocal pour que vous le lisiez à un feu rouge, et remplit l'adresse et l'échéance d'un travail à partir de ce que le client a vraiment dit. Il n'envoie jamais rien, ne réserve jamais rien, et ne parle jamais à votre client en votre nom. Inclus dans tous les forfaits, et chacune de ses parties peut être désactivée.",
  visualCaption:
    "Une réponse rédigée qui attend dans le champ de saisie, et la tâche qu'elle a remplie. Ni l'une ni l'autre n'est partie.",
  visualAria:
    "Une réponse rédigée par Lou, non envoyée, dans le champ de saisie de Loonext, au-dessus d'une tâche qu'elle a remplie",

  coreEyebrow: "L'idée de départ",
  coreTitle: "Une suggestion n'est pas une décision.",
  coreBodyOne:
    "Tout ce que Lou produit arrive devant une personne avant d'aller où que ce soit. Une réponse rédigée attend dans le champ de saisie qu'on la modifie ou qu'on la jette. Une adresse qu'il a lue dans un texto est un champ que vous pouvez corriger. Rien n'est mis en file, rien ne part sur une minuterie, et aucun réglage ne rend tout cela automatique, parce qu'au moment où une machine répond à un client en votre nom, vous avez cessé de mener votre propre entreprise.",
  coreBodyTwo:
    "C'est aussi la différence honnête entre ceci et une « réceptionniste IA ». Lou ne tient pas de conversation avec votre client. Le seul endroit où il lui parle, c'est une seule ligne de plus dans votre message d'accueil vocal, qui demande de quoi il s'agit, et c'est la seule fonction livrée désactivée.",

  doesEyebrow: "Ce qu'il fait vraiment",
  doesTitle: "Quatre travaux, cinq interrupteurs.",
  doesDraftTitle: "Il rédige la réponse",
  doesDraftBody:
    "Lou lit le fil et écrit une réponse dans votre voix, ancrée dans une phrase que vous avez écrite sur ce que fait votre entreprise. Vous la modifiez ou vous la jetez. Il n'envoie jamais. Si vous n'avez rien dit à Lou sur l'entreprise, il n'en inventera pas la description.",
  doesVoicemailTitle: "Il écrit le message vocal",
  doesVoicemailBody:
    "Un message vocal arrive sous forme de texte que vous lisez entre deux travaux et que vous cherchez des mois plus tard, au lieu d'une pastille qu'il faut aller écouter dans un endroit tranquille. L'enregistrement est toujours là.",
  doesTaskTitle: "Il remplit le travail",
  doesTaskBody:
    "Transformez un texto en tâche et Lou en tire l'adresse et l'échéance à partir de ce que le client a écrit. Deux interrupteurs distincts, pour qu'une équipe qui veut l'adresse mais pas la date ait exactement cela.",
  doesIntakeTitle: "Il tire le travail d'un message vocal",
  doesIntakeBody:
    "Désactivé par défaut. Lou lit la transcription et montre ce que la personne voulait et où, au-dessus de l'enregistrement. Votre message d'accueil vous appartient — nous n'y ajoutons pas de ligne. Rien n'est réservé et personne ne tombe sur un menu.",

  factsEyebrow: "Les faits, simplement",
  factsNeverSends:
    "Lou n'envoie jamais de message, ne répond jamais à un appel et ne réserve jamais rien. Chaque résultat est une suggestion qu'une personne accepte, modifie ou jette.",
  factsDefaults:
    "Quatre fonctions arrivent ACTIVÉES : les réponses rédigées, les transcriptions de messages vocaux, les adresses de tâches, les échéances de tâches. La prise d'information vocale arrive DÉSACTIVÉE, parce que c'est la seule que votre client entend. Un propriétaire peut basculer chacune d'elles dans un sens ou dans l'autre.",
  factsCaps:
    "Les plafonds sont par espace de travail par mois civil et ils sont fermes : 1 500 réponses rédigées, 500 transcriptions de messages vocaux, 1 000 détails de tâches. Passé un plafond, la fonction s'arrête pour le reste du mois plutôt que de vous facturer davantage, et on dit à l'équipe de quel plafond il s'agissait.",
  factsModels:
    "Les modèles tournent sur Cloudflare Workers AI dans le même compte que celui qui héberge l'application. Le contenu de vos messages et l'audio de vos messages vocaux ne servent pas à entraîner des modèles, selon la politique publiée de Cloudflare et selon la nôtre. Ce qui revient est conservé dans votre espace de travail comme n'importe quel autre message et supprimé avec lui.",

  pricingBefore:
    "Lou est inclus aux deux prix, sans rien à activer et sans frais par personne ni par utilisation :",
  privacyLink: "politique de confidentialité",
  subprocessorsLink: "page des sous-traitants",

  relatedEyebrow: "Où Lou apparaît",
  relatedTitle:
    "L'adjoint n'a pas d'écran à lui. Il apparaît à l'intérieur de ce que vous faisiez déjà.",
  relatedInboxTitle: "Boîte de réception partagée",
  relatedInboxBody: "Là où une réponse rédigée attend que vous la modifiiez.",
  relatedCallsTitle: "Appels et messagerie vocale",
  relatedCallsBody: "Là où vivent la transcription et les questions d'accueil.",
  relatedPrivacyTitle: "Confidentialité",
  relatedPrivacyBody: "Ce qui est lu, ce qui est conservé, et pour combien de temps.",
  relatedSubprocessorsTitle: "Sous-traitants",
  relatedSubprocessorsBody: "Chaque tiers qui voit des données de clients, nommé.",

  faqTitle: "Questions sur l'adjoint, réponses directes.",
  faqSendQ: "Est-ce que Lou répondra à mes clients sans moi ?",
  faqSendA:
    "Non, et aucun réglage ne le permettrait. Chaque brouillon attend dans le champ de saisie qu'une personne le lise, le change ou le supprime. Les seuls messages que Loonext envoie de lui-même sont votre réponse automatique après les heures et votre texto de retour d'appel manqué, et ce sont dans les deux cas des mots que vous avez écrits vous-même, pas des mots de Lou.",
  faqTrainQ:
    "Le contenu des messages de mes clients sert-il à entraîner des modèles d'IA ?",
  faqTrainA:
    "Non. Les modèles tournent sur Cloudflare Workers AI dans le même compte que celui qui héberge l'application, et le contenu des messages et l'audio des messages vocaux ne servent pas à l'entraînement, selon la politique publiée de Cloudflare et selon la nôtre. Tout ce que Lou produit est conservé dans votre espace de travail comme n'importe quel autre message et supprimé quand ces données le sont.",
  faqOffQ: "Puis-je le désactiver ?",
  faqOffA:
    "Oui, fonction par fonction, dans les Réglages sous IA, par un propriétaire ou un administrateur. Quatre sont activées à votre arrivée et une, la prise d'information vocale, est désactivée. Désactiver une fonction l'arrête immédiatement ; rien de ce qui a déjà été produit n'est supprimé, parce que ce sont les données de votre espace de travail à ce moment-là.",
  faqCapQ: "Qu'arrive-t-il quand on atteint un plafond mensuel ?",
  faqCapA:
    "Cette fonction s'arrête pour le reste du mois civil et on dit à l'équipe de quel plafond il s'agissait. Rien ne facture davantage et rien ne se dégrade en silence. Un message vocal passé le plafond de transcription arrive quand même comme enregistrement ; une réponse passé le plafond de rédaction est simplement une réponse que vous tapez vous-même.",
  faqIntakeQ:
    "Pourquoi la question vocale est-elle désactivée par défaut alors que tout le reste est activé ?",
  faqIntakeA:
    "Parce que c'est la seule que votre client vit. Les autres produisent quelque chose qu'un membre de votre équipe lit et sur quoi il décide. Celle-là change ce qu'un inconnu entend quand il appelle votre entreprise, en votre nom, et un réglage par défaut qui parle à votre place ne nous revient pas.",
  faqBusinessQ: "Est-ce que Lou connaît quelque chose de mon entreprise ?",
  faqBusinessA:
    "Une seule phrase, que vous écrivez, décrivant ce que vous faites. Elle ancre les brouillons pour qu'ils sonnent comme votre métier plutôt que comme du texte de soutien générique. Si vous la laissez vide, Lou ne décrira pas du tout votre entreprise plutôt que de deviner, parce qu'une réponse inventée à un client est pire que pas de réponse.",

  ctaTitle: "Laissez la dactylographie à quelqu'un d'autre.",
  ctaSubBefore:
    "Des réponses rédigées, des messages vocaux par écrit, et des travaux qui se remplissent tout seuls,",
  ctaSubAfter: ". Voyez le prix.",

  visualBadge: "L'IA écrit des textos",
  visualIncoming:
    "Bonjour, mon chauffe-eau coule partout sur le plancher du sous-sol. Quelqu'un peut passer aujourd'hui ? Je suis au 114, rue Bishop.",
  visualDraftedBy: "Rédigé par Lou",
  visualEditFirst: "Modifiez avant d'envoyer",
  visualDraft:
    "Désolé d'apprendre ça. Fermez l'eau au robinet sur le dessus du réservoir si vous pouvez l'atteindre. On peut envoyer quelqu'un au 114, rue Bishop cet après-midi entre 14 h et 16 h. Est-ce que ça vous convient ?",
  visualNotSent: "Rien n'est envoyé tant que vous n'appuyez pas.",
  visualSend: "Envoyer",
  visualTaskLabel: "Nouvelle tâche, remplie à partir de ce message",
  visualAddressChip: "114, rue Bishop",
  visualTaskTitle: "Fuite de chauffe-eau, rue Bishop",
  visualTaskDue: "Dû aujourd'hui",
};

const ASSISTANT_COPY = {
  en: assistantEn,
  "fr-CA": assistantFr,
} as const;

export type AssistantCopy = typeof assistantEn | typeof assistantFr;

export function assistantCopy(locale: MarketingLocale = "en"): AssistantCopy {
  return ASSISTANT_COPY[locale] ?? assistantEn;
}
