import type { Translated } from "../translated";

import type { MarketingLocale } from "./footer";

export const legalDeleteMyDataEn = {
  metaTitle: "Delete your data",
  metaDescription:
    "How to delete your Loonext account or close your workspace, what happens to your data when you do, what we are required to keep, and for how long.",
  title: "Delete your data",
  breadcrumbLabel: "Delete your data",
  lastUpdated: "July 26, 2026",
  summary:
    "You can delete your own account, or close a whole workspace, from inside Loonext. No email to us, and no waiting on support. Deleting your account signs you out everywhere and takes your name off the product. Closing a workspace ends it for everyone on it, releases the phone number, stops billing, and erases everything in it after 30 days. Two things outlive both, and we say plainly why: anyone who replied STOP stays on the do-not-text list, and a stripped record that consent existed is kept for three years because the law requires it.",

  sectionAccount: "Delete your account",
  sectionWorkspace: "Close a workspace",
  sectionWhatGoes: "What is deleted",
  sectionWhatStays: "What we have to keep",
  sectionWhen: "When it happens",
  sectionBoundary: "What closing a workspace does not reach",
  sectionHelp: "If you cannot sign in",

  accountOne:
    "In Loonext, go to **Settings → Account → Delete your account**. It is in the same place in the web app, the iPhone app and the Android app. You will see exactly what will happen, and you type **delete** to confirm.",
  accountTwo:
    "If you own a workspace you will be asked to hand it to someone else or close it first. A workspace cannot be left with nobody in charge of it: the phone number, the billing and the customer history all belong to somebody.",
  workspaceOne:
    "The owner of a workspace can close it from **Settings → Workspace → Close this workspace** in the web app. It ends the account for everyone on it, so it is deliberately the owner's decision alone, and you type the workspace name to confirm.",
  whatGoesAccount:
    "Deleting your **account** removes your name, your notification settings, everything that sends alerts to your devices, and your ability to sign in. You are signed out everywhere immediately.",
  whatGoesWorkspace:
    "Closing a **workspace** erases everything in it: messages and their photos, voicemail recordings, contacts, tasks, notes, call history and saved replies, along with the files behind them and the billing record at our payment processor. The phone number is released straight away: it returns to the phone company and can be reassigned to another business, so anyone who still has it saved will eventually reach someone else. We cannot get it back for you. If you want to keep the number, port it out to another carrier before you close.",
  whatStaysIntro:
    "Two things survive, and we would rather say so than imply an erasure we cannot perform.",
  whatStaysStop:
    "**Do-not-text records.** If someone replied STOP to a business using Loonext, that record stays. It belongs to the person who sent it, not to the business that received it. Deleting it would let the same business text them again from a new account. It contains their phone number and the date, and nothing else.",
  whatStaysConsent:
    "**Proof that consent existed.** Canadian anti-spam law requires us to be able to show that a business had permission to text someone, for three years. We keep the minimum that proves it (a phone number, a date, and how consent was given) and erase everything around it: names, email addresses, street addresses, message contents, photos, and voicemail audio.",
  whatStaysWork:
    "Your own work is not kept as personal data, but it does stay with the business you did it for. Texts you sent to customers, jobs you logged and notes you wrote belong to that business's records, and after you delete your account they no longer carry your name.",
  whenAccount:
    "**Account deletion is immediate.** There is no waiting period and no way to undo it.",
  whenWorkspace:
    "**Closing a workspace takes effect immediately and finishes in 30 days.** Access ends, the number is released and billing stops the moment you confirm. The erasing itself happens 30 days later, which is deliberate: it is a window in which a workspace closed by mistake can still be recovered by contacting us. Once that window passes, nobody can undo it, including us.",
  boundaryIntro:
    "Closing a workspace erases what is in it. One thing sits outside every workspace, so it is worth naming rather than leaving to be discovered.",
  boundaryItem:
    "If you sent us a message through the contact form on our website, that is held outside any workspace, so closing one does not remove it. It is deleted on its own schedule after a year, and you can ask us to remove it sooner.",
  helpUser:
    "If you have lost access to your account and cannot use the in-app controls, email {privacyEmail} from the address on the account and we will handle it. Under PIPEDA and Quebec Law 25 we respond within the timelines the law sets.",
  helpCustomer:
    "If you are a *customer* of a business that uses Loonext rather than a Loonext user, meaning you received a text from one of our customers, then that business controls your information, and we will route your request to them. To stop the texts immediately, reply **STOP** to any message from them.",
} as const;

export const legalDeleteMyDataFr: Translated<typeof legalDeleteMyDataEn> = {
  metaTitle: "Supprimer vos données",
  metaDescription:
    "Comment supprimer votre compte Loonext ou fermer votre espace de travail, ce qui arrive à vos données, ce que la loi nous oblige à conserver et pendant combien de temps.",
  title: "Supprimer vos données",
  breadcrumbLabel: "Supprimer vos données",
  lastUpdated: "26 juillet 2026",
  summary:
    "Vous pouvez supprimer votre propre compte ou fermer tout un espace de travail directement dans Loonext. Aucun courriel à nous envoyer et aucune attente auprès du soutien. La suppression de votre compte vous déconnecte partout et retire votre nom du produit. La fermeture d'un espace de travail y met fin pour tous ses membres, libère le numéro de téléphone, arrête la facturation et efface tout son contenu après 30 jours. Deux éléments subsistent, et nous expliquons clairement pourquoi : toute personne qui a répondu STOP demeure sur la liste d'exclusion des textos, et une preuve minimale du consentement est conservée pendant trois ans parce que la loi l'exige.",

  sectionAccount: "Supprimer votre compte",
  sectionWorkspace: "Fermer un espace de travail",
  sectionWhatGoes: "Ce qui est supprimé",
  sectionWhatStays: "Ce que nous devons conserver",
  sectionWhen: "Quand la suppression a lieu",
  sectionBoundary: "Ce que la fermeture ne peut pas supprimer",
  sectionHelp: "Si vous ne pouvez pas ouvrir une session",

  accountOne:
    "Dans Loonext, allez à **Paramètres → Compte → Supprimer votre compte**. La commande se trouve au même endroit dans l'application Web, l'application iPhone et l'application Android. Vous verrez exactement ce qui arrivera, puis vous taperez **supprimer** pour confirmer.",
  accountTwo:
    "Si vous êtes propriétaire d'un espace de travail, on vous demandera d'abord d'en confier la responsabilité à quelqu'un d'autre ou de le fermer. Un espace de travail ne peut pas rester sans responsable : le numéro de téléphone, la facturation et l'historique des clients doivent relever de quelqu'un.",
  workspaceOne:
    "La personne propriétaire d'un espace de travail peut le fermer dans l'application Web à **Paramètres → Espace de travail → Fermer cet espace de travail**. La fermeture met fin au compte pour tous ses membres; cette décision revient donc uniquement à la personne propriétaire, qui doit taper le nom de l'espace de travail pour confirmer.",
  whatGoesAccount:
    "La suppression de votre **compte** retire votre nom, vos réglages de notification, tout ce qui envoie des alertes à vos appareils et votre capacité à ouvrir une session. Vous êtes déconnecté partout immédiatement.",
  whatGoesWorkspace:
    "La fermeture d'un **espace de travail** efface tout son contenu : les messages et leurs photos, les enregistrements de messagerie vocale, les contacts, les tâches, les notes, l'historique des appels et les réponses enregistrées, ainsi que les fichiers connexes et le dossier de facturation chez notre fournisseur de paiement. Le numéro de téléphone est libéré immédiatement : il retourne à la compagnie de téléphone et peut être attribué à une autre entreprise. Une personne qui l'a encore dans ses contacts pourrait donc finir par joindre quelqu'un d'autre. Nous ne pouvons pas le récupérer pour vous. Si vous voulez le garder, transférez-le à un autre fournisseur avant de fermer l'espace.",
  whatStaysIntro:
    "Deux éléments subsistent, et nous préférons le dire plutôt que de laisser croire à un effacement que nous ne pouvons pas effectuer.",
  whatStaysStop:
    "**Registres d'exclusion des textos.** Si une personne a répondu STOP à une entreprise qui utilise Loonext, ce registre demeure. Il appartient à la personne qui a envoyé la demande, et non à l'entreprise qui l'a reçue. Le supprimer permettrait à la même entreprise de lui envoyer de nouveau des textos à partir d'un autre compte. Il contient seulement son numéro de téléphone et la date.",
  whatStaysConsent:
    "**Preuve qu'un consentement existait.** La loi canadienne antipourriel nous oblige à pouvoir montrer, pendant trois ans, qu'une entreprise avait la permission d'envoyer un texto à une personne. Nous conservons le minimum qui le prouve (un numéro de téléphone, une date et la façon dont le consentement a été donné) et effaçons tout le reste : noms, adresses courriel et postales, contenu des messages, photos et audio de messagerie vocale.",
  whatStaysWork:
    "Votre propre travail n'est pas conservé comme donnée personnelle, mais il reste auprès de l'entreprise pour laquelle vous l'avez effectué. Les textos envoyés aux clients, les travaux consignés et les notes rédigées appartiennent aux dossiers de cette entreprise; après la suppression de votre compte, ils ne portent plus votre nom.",
  whenAccount:
    "**La suppression du compte est immédiate.** Il n'y a aucun délai d'attente et aucune façon de l'annuler.",
  whenWorkspace:
    "**La fermeture d'un espace de travail prend effet immédiatement et se termine après 30 jours.** L'accès prend fin, le numéro est libéré et la facturation s'arrête dès votre confirmation. L'effacement lui-même a lieu 30 jours plus tard, volontairement : cette période permet encore de récupérer un espace fermé par erreur en communiquant avec nous. Après ce délai, personne ne peut revenir en arrière, pas même nous.",
  boundaryIntro:
    "La fermeture d'un espace de travail efface ce qu'il contient. Un élément se trouve à l'extérieur de tous les espaces de travail; mieux vaut le nommer que vous laisser le découvrir plus tard.",
  boundaryItem:
    "Si vous nous avez envoyé un message au moyen du formulaire de contact de notre site Web, il est conservé à l'extérieur de tout espace de travail; la fermeture d'un espace ne le supprime donc pas. Il est supprimé selon son propre calendrier après un an, et vous pouvez nous demander de le supprimer plus tôt.",
  helpUser:
    "Si vous avez perdu l'accès à votre compte et ne pouvez pas utiliser les commandes dans l'application, écrivez à {privacyEmail} à partir de l'adresse associée au compte et nous nous en occuperons. En vertu de la LPRPDE et de la Loi 25 du Québec, nous répondons dans les délais prévus par la loi.",
  helpCustomer:
    "Si vous êtes *client ou cliente* d'une entreprise qui utilise Loonext, plutôt qu'une personne qui utilise Loonext, c'est-à-dire si vous avez reçu un texto de l'un de nos clients, cette entreprise contrôle vos renseignements et nous lui transmettrons votre demande. Pour arrêter immédiatement les textos, répondez **STOP** à n'importe lequel de ses messages.",
};

const COPY = {
  en: legalDeleteMyDataEn,
  "fr-CA": legalDeleteMyDataFr,
} as const;

export function legalDeleteMyDataCopy(locale: MarketingLocale = "en") {
  return COPY[locale] ?? legalDeleteMyDataEn;
}
