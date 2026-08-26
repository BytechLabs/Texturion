import type { Translated } from "../translated";

import type { MarketingLocale } from "./footer";

export const legalMessagingEn = {
  metaTitle: "SMS messaging policy",
  metaDescription:
    "The Loonext SMS program disclosures: how opt-in works, reply STOP to stop and HELP for help, message frequency varies, message and data rates may apply, and numbers are never sold or shared for marketing.",
  title: "SMS messaging policy",
  breadcrumbLabel: "SMS messaging policy",
  lastUpdated: "July 3, 2026",
  summary:
    "Businesses on Loonext text their own customers, one conversation at a time. You receive texts because you texted the business first, called it, or gave it your number and agreed to be texted. Reply STOP to any message and the messages stop; reply HELP for help. Message and data rates may apply, and message frequency varies with the conversation.",

  sectionProgram: "What this program is",
  sectionOptIn: "How opt-in works",
  sectionOptOut: "How to stop messages (STOP)",
  sectionHelp: "Getting help (HELP)",
  sectionFrequency: "Message frequency and rates",
  sectionHours: "When messages are sent",
  sectionCarriers: "Carrier disclaimer",
  sectionPrivacy: "Your number stays private",
  sectionContact: "Contact",

  program:
    "Loonext is a shared business line that local service businesses in the United States and Canada use to text **their own customers**: appointment questions, quotes, photos of the job, on-my-way updates, and replies to messages those customers sent. Every message relayed through Loonext is a conversation between one business and a customer of that business. Loonext is not a bulk-marketing platform and does not offer blast tools, see our {aup}. \"Loonext,\" \"we,\" and \"us\" mean the company that operates Loonext, as defined in our {terms}.",
  aupLink: "acceptable use policy",
  termsLink: "terms of service",
  optInOne:
    "You receive texts from a business on Loonext in one of three ways: you texted the business first; you called the business (if no one could pick up, you may get a single text back about your call so you can reach them by reply); or you gave the business your number and agreed, in person, by phone, or in writing, to be texted. When a business starts a conversation you didn't initiate, it must attest that it has your consent first; Loonext requires that attestation and records it (who attested and when).",
  optInTwo:
    "Consent is per-business. Agreeing to hear from one business never opts you into messages from any other business, and consent cannot be bought, sold, or transferred between businesses. And STOP works on *any* message, whoever started the conversation (section 3).",
  optOut:
    "Reply **STOP** to any message and the messages stop. The opt-out is recorded and further sends from that business to your number are blocked until you opt back in (for example, by replying START). You don't need the exact keyword: any reasonable request to stop, \"stop texting me,\" \"take me off your list,\" a phone call, or an email to the business, is honored within at most 10 business days, as the FCC's 2025 consent-revocation rule requires. Keyword opt-outs take effect immediately.",
  help:
    "Reply **HELP** to any message and you'll receive a message identifying the service and how to reach support. You can also email {supportEmail} or use our {contact} at any time.",
  contactLink: "contact page",
  frequency:
    "**Message frequency varies.** These are conversations, not scheduled campaigns, so how many messages you receive depends on what you and the business are discussing. There is no fixed schedule of recurring messages. **Message and data rates may apply** according to your mobile plan; Loonext never charges the person receiving the texts.",
  hoursOne:
    "**Automated messages are never sent outside 8:00am to 8:00pm in your local time.** That is your time, worked out from your own phone number or from what the business has recorded about you, not the business's time and not ours. Where a state sets a narrower window we use the narrower one: in Texas, for example, automated messages are not sent before noon on a Sunday.",
  hoursIntro:
    "Two kinds of message are different, and it is fair to say so plainly:",
  hoursReply:
    "**A reply to something you just did.** If you text the business or call and miss them, the automatic answer comes back straight away whatever the hour, because you contacted them, and a reply that waited until morning would be useless to you.",
  hoursPerson:
    "**A person typing to you.** Business owners are people with their own hours, and one texting you back at 9pm is them choosing to. We show them your local time when they do, and we do not stop them.",
  hoursFederal:
    "The window we apply is deliberately tighter than the federal minimum of 8:00am to 9:00pm.",
  carriers:
    "Carriers are not liable for delayed or undelivered messages. Text delivery depends on the mobile carrier networks, which neither Loonext nor the business texting you controls, and delivery is not guaranteed.",
  privacy:
    "Mobile numbers and SMS consent data are never shared with, or sold to, third parties or affiliates for their own marketing. The consent you give a business, and the phone number tied to it, stay inside Loonext and the business that collected them, and are used only to deliver that business's messages and to honor opt-outs. The full detail is in our {privacy}.",
  privacyLink: "privacy policy",
  contact:
    "Questions about this program, or a message you received through Loonext? Email {supportEmail} or use our {contact}. We reply.",
} as const;

export const legalMessagingFr: Translated<typeof legalMessagingEn> = {
  metaTitle: "Politique sur les textos",
  metaDescription:
    "Les renseignements sur le programme de textos de Loonext : comment fonctionne le consentement, répondez STOP pour arrêter ou HELP pour obtenir de l'aide, la fréquence varie, des frais peuvent s'appliquer et les numéros ne sont jamais vendus ni transmis à des fins de marketing.",
  title: "Politique sur les textos",
  breadcrumbLabel: "Politique sur les textos",
  lastUpdated: "3 juillet 2026",
  summary:
    "Les entreprises qui utilisent Loonext envoient des textos à leurs propres clients, une conversation à la fois. Vous recevez des textos parce que vous avez d'abord écrit ou téléphoné à l'entreprise, ou parce que vous lui avez donné votre numéro et accepté de recevoir ses textos. Répondez STOP à n'importe quel message pour les arrêter, ou HELP pour obtenir de l'aide. Des frais de messagerie et de données peuvent s'appliquer, et la fréquence varie selon la conversation.",

  sectionProgram: "En quoi consiste ce programme",
  sectionOptIn: "Comment fonctionne le consentement",
  sectionOptOut: "Comment arrêter les messages (STOP)",
  sectionHelp: "Comment obtenir de l'aide (HELP)",
  sectionFrequency: "Fréquence des messages et frais",
  sectionHours: "Quand les messages sont envoyés",
  sectionCarriers: "Avis concernant les fournisseurs sans fil",
  sectionPrivacy: "Votre numéro demeure privé",
  sectionContact: "Nous joindre",

  program:
    "Loonext est une ligne d'entreprise partagée que des entreprises de services locales aux États-Unis et au Canada utilisent pour envoyer des textos à **leurs propres clients** : questions sur un rendez-vous, soumissions, photos du travail, avis d'arrivée et réponses aux messages de ces clients. Chaque message transmis par Loonext est une conversation entre une entreprise et l'un de ses clients. Loonext n'est pas une plateforme de marketing de masse et n'offre aucun outil d'envoi massif; consultez notre {aup}. Les mots \"Loonext\", \"nous\" et \"notre\" désignent l'entreprise qui exploite Loonext, comme l'indiquent nos {terms}.",
  aupLink: "politique d'utilisation acceptable",
  termsLink: "conditions d'utilisation",
  optInOne:
    "Vous recevez des textos d'une entreprise qui utilise Loonext de l'une des trois façons suivantes : vous avez d'abord envoyé un texto à l'entreprise; vous lui avez téléphoné (si personne n'a pu répondre, vous pourriez recevoir un seul texto au sujet de votre appel afin de pouvoir répondre); ou vous lui avez donné votre numéro et accepté, en personne, par téléphone ou par écrit, de recevoir ses textos. Lorsqu'une entreprise commence une conversation que vous n'avez pas amorcée, elle doit d'abord attester qu'elle a votre consentement; Loonext exige et consigne cette attestation, y compris qui l'a faite et quand.",
  optInTwo:
    "Le consentement vaut pour une seule entreprise. Accepter les messages d'une entreprise ne vous inscrit jamais aux messages d'une autre, et le consentement ne peut pas être acheté, vendu ni transféré entre entreprises. STOP fonctionne pour *tout* message, peu importe qui a commencé la conversation (section 3).",
  optOut:
    "Répondez **STOP** à n'importe quel message et les messages s'arrêtent. La demande de retrait est consignée, et tout autre envoi de cette entreprise à votre numéro est bloqué jusqu'à ce que vous consentiez de nouveau, par exemple en répondant START. Vous n'avez pas à utiliser le mot-clé exact : toute demande raisonnable d'arrêt, comme \"cessez de m'envoyer des textos\", \"retirez-moi de votre liste\", un appel ou un courriel à l'entreprise, est respectée au plus tard dans les 10 jours ouvrables, conformément à la règle de 2025 de la FCC sur la révocation du consentement. Les retraits par mot-clé prennent effet immédiatement.",
  help:
    "Répondez **HELP** à n'importe quel message pour recevoir un message qui identifie le service et explique comment joindre le soutien. Vous pouvez aussi écrire à {supportEmail} ou utiliser notre {contact} en tout temps.",
  contactLink: "page de contact",
  frequency:
    "**La fréquence des messages varie.** Il s'agit de conversations, pas de campagnes planifiées; le nombre de messages dépend donc de ce dont vous discutez avec l'entreprise. Il n'existe aucun calendrier fixe de messages récurrents. **Des frais de messagerie et de données peuvent s'appliquer** selon votre forfait mobile; Loonext ne facture jamais la personne qui reçoit les textos.",
  hoursOne:
    "**Les messages automatisés ne sont jamais envoyés en dehors de la période de 8 h à 20 h dans votre heure locale.** Il s'agit de votre heure, déterminée à partir de votre numéro de téléphone ou des renseignements que l'entreprise a consignés à votre sujet, et non de l'heure de l'entreprise ni de la nôtre. Lorsqu'un État impose une période plus courte, nous l'appliquons; au Texas, par exemple, aucun message automatisé n'est envoyé avant midi le dimanche.",
  hoursIntro:
    "Deux types de messages sont différents, et il est juste de le dire clairement :",
  hoursReply:
    "**Une réponse à ce que vous venez de faire.** Si vous envoyez un texto à l'entreprise ou l'appelez sans réponse, la réponse automatique revient immédiatement, peu importe l'heure, puisque vous avez communiqué avec elle; une réponse qui attendrait le matin ne vous servirait à rien.",
  hoursPerson:
    "**Une personne vous écrit.** Les propriétaires d'entreprise sont des personnes qui ont leurs propres horaires; si l'une d'elles vous répond à 21 h, c'est son choix. Nous lui montrons votre heure locale, mais nous ne l'en empêchons pas.",
  hoursFederal:
    "La période que nous appliquons est volontairement plus courte que le minimum fédéral de 8 h à 21 h.",
  carriers:
    "Les fournisseurs de services sans fil ne sont pas responsables des messages retardés ou non livrés. La livraison des textos dépend de leurs réseaux, que ni Loonext ni l'entreprise qui vous écrit ne contrôlent, et elle n'est pas garantie.",
  privacy:
    "Les numéros de téléphone mobile et les données de consentement aux textos ne sont jamais transmis ni vendus à des tiers ou à des sociétés affiliées pour leur propre marketing. Le consentement que vous donnez à une entreprise et le numéro qui y est lié restent dans Loonext et auprès de l'entreprise qui les a recueillis. Ils servent seulement à livrer les messages de cette entreprise et à respecter les retraits. Tous les détails se trouvent dans notre {privacy}.",
  privacyLink: "politique de confidentialité",
  contact:
    "Des questions sur ce programme ou sur un message reçu par Loonext? Écrivez à {supportEmail} ou utilisez notre {contact}. Nous vous répondrons.",
};

const COPY = { en: legalMessagingEn, "fr-CA": legalMessagingFr } as const;

export function legalMessagingCopy(locale: MarketingLocale = "en") {
  return COPY[locale] ?? legalMessagingEn;
}
