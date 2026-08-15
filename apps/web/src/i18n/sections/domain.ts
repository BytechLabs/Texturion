/**
 * #228 — the words the SHARED modules say, in both languages.
 *
 * Every other section in this directory belongs to a screen. This one belongs
 * to `packages/shared`, and it exists because that package turned out to be the
 * largest untranslated surface in the product: 325 English sentences that no
 * ledger was counting, rendered on all three clients.
 *
 * Both phones already translate them. `DomainStrings.kt` and
 * `DomainStrings.swift` hold 330 keys under `domain.`, hand-ported when each
 * shared module was ported, while the web kept calling the shared function and
 * rendering whatever English came back. So a French reader saw a French app
 * with English underneath it — "Not delivered" under a message bubble, in an
 * app whose every other word had been translated.
 *
 * KEYS MATCH THE PHONES EXACTLY, and `send-failures.parity.test.ts` fails if
 * the three tables ever disagree. That is the whole value of this file: the
 * shared module names a key, and three clients look it up in three catalogues
 * that are checked against each other rather than against a comment asking
 * somebody to keep them identical.
 *
 * It grows one shared module at a time. Send failures first, because they are
 * the ones a person reads while wondering whether to try again.
 */
import type { Translated } from "../translated";

export const domainEn = {
  /*
   * Why a text did not arrive, in words the reader can act on.
   *
   * Deliberately different sentences for the temporary and permanent cases —
   * "Carriers are blocking this right now" invites another try in a minute,
   * "Carriers blocked this as spam" does not, and a person deciding whether to
   * retry needs the difference.
   */
  sendFailureGeneric: "Not delivered",
  sendFailureOptedOut: "This customer opted out",
  sendFailureUnreachable: "That number can't receive texts",
  sendFailureNotTextable: "That number isn't textable",
  sendFailureBlockedNow: "Carriers are blocking this right now",
  sendFailureSpam: "Carriers blocked this as spam",
  sendFailureRateLimited: "Sent too fast for carriers. Try again shortly",
  sendFailureHandsetRejected: "Their phone rejected it",
  sendFailureHandsetUnavailable: "Their phone couldn't receive it",
  sendFailureExpired: "It expired before it could send",
  sendFailureContent: "Carriers wouldn't accept this message",
  sendFailureEmpty: "There was nothing to send",
  sendFailureAttachment: "Carriers wouldn't accept that attachment",
  sendFailureTooLong: "Too long to send",
  sendFailureRegistration: "Your US texting registration isn't approved yet",
  sendFailureNumberNotReady: "This number isn't set up for texting yet",
  sendFailureTextingOff: "Texting is turned off for this number",
  sendFailureNoSms: "This number can't send texts",
  sendFailureNoMms: "This number can't send pictures",

  /*
   * #352 — a carrier rejection, said in words the customer can act on.
   *
   * `what` names the objection, `fix` names the one thing to change, one
   * sentence each (G10). Read by somebody who has already paid, already waited
   * days, and has just been told no — so nothing here runs past two sentences.
   *
   * The MATCH phrases that select these stay in English, in the shared module.
   * They match text a carrier wrote, and a carrier writes
   * BRAND_LEGAL_NAME_MISMATCH in English to everybody.
   */
  rejectRegEinWhat: "The tax ID you gave does not match what the government registry holds for your business.",
  rejectRegEinFix: "Check the EIN or business number on a tax document and enter it exactly, digits only.",
  rejectRegNameWhat: "The business name you gave does not match the one on your government registration.",
  rejectRegNameFix: "Use the exact legal name from your registration paperwork, including any Ltd, Inc or LLC — the name customers see is set separately.",
  rejectRegAddressWhat: "The business address does not match the one on your government registration.",
  rejectRegAddressFix: "Enter the registered business address rather than a mailing or job-site address.",
  rejectRegWebsiteWhat: "The carrier could not confirm your business from the website you gave.",
  rejectRegWebsiteFix: "Give a website that names your business and describes what you do, and make sure it loads publicly.",
  rejectRegConsentWhat: "The carrier was not satisfied that customers agree to be texted before you text them.",
  rejectRegConsentFix: "Describe exactly where a customer gives you their number and what they are told at that moment.",
  rejectRegSampleWhat: "The sample texts did not show the carrier what you actually send.",
  rejectRegSampleFix: "Use real messages you would send a customer, and include your business name in each one.",
  rejectRegUseCaseWhat: "The use case you picked does not match what your samples and website describe.",
  rejectRegUseCaseFix: "Pick the category that matches the texts you actually send to customers.",
  rejectRegDuplicateWhat: "This business is already registered with the carriers, most likely by a provider you used before.",
  rejectRegDuplicateFix: "Reply to us and we will get the existing registration released or transferred — this is not something the form can fix.",
  rejectRegEntityWhat: "The business type you chose does not match how your business is registered.",
  rejectRegEntityFix: "Choose the type that matches your paperwork — a sole trader and a limited company are registered differently.",
  rejectRegContactWhat: "The carrier could not reach the contact details on the registration.",
  rejectRegContactFix: "Give a business email and phone number that reach a person and are not auto-replied.",
  rejectPortAccountWhat: "The account number does not match the one your current provider has on file.",
  rejectPortAccountFix: "Copy it from a recent bill from that provider — it is usually not the phone number itself.",
  rejectPortPinWhat: "The transfer PIN was missing or wrong.",
  rejectPortPinFix: "Ask your current provider for a port-out PIN — most will only give it to the account holder, and it often expires within a few days.",
  rejectPortAuthWhat: "The person named on the request is not authorised on the account.",
  rejectPortAuthFix: "Use the name of the person your current provider has as the account holder, spelled the same way.",
  rejectPortEntityWhat: "The account holder name does not match your current provider's records.",
  rejectPortEntityFix: "Use the name exactly as it appears on the bill, including any Ltd, Inc or LLC.",
  rejectPortAddressWhat: "The service address does not match the one your current provider has on file.",
  rejectPortAddressFix: "Use the address on the bill for this line, even if the business has since moved.",
  rejectPortPendingWhat: "Your current provider has another change in progress on this line.",
  rejectPortPendingFix: "Ask them to cancel or finish it, then tell us and we will resubmit.",
  rejectPortInactiveWhat: "Your current provider says this number is not active on the account we asked about.",
  rejectPortInactiveFix: "Check the number is still in service and on the account you gave us — a number already cancelled cannot be moved.",

  /*
   * How long a resubmission takes, stated because its absence is where people
   * give up. A range, and deliberately vague at the top end: the carriers do
   * not commit to a time, and inventing a precise one would be a worse promise
   * than an honest range.
   */
  resubmitWaitRegistration: "Most resubmissions are decided within a business day or two.",
  resubmitWaitPort: "Most resubmitted transfers are accepted within a few business days.",
} as const;

export const domainFr: Translated<typeof domainEn> = {
  sendFailureGeneric: "Non livré",
  sendFailureOptedOut: "Ce client s'est désabonné",
  sendFailureUnreachable: "Ce numéro ne peut pas recevoir de textos",
  sendFailureNotTextable: "Ce numéro n'accepte pas les textos",
  sendFailureBlockedNow: "Les fournisseurs bloquent ce message en ce moment",
  sendFailureSpam: "Les fournisseurs l'ont bloqué comme pourriel",
  sendFailureRateLimited: "Envoyé trop vite pour les fournisseurs. Réessayez sous peu",
  sendFailureHandsetRejected: "Son téléphone l'a refusé",
  sendFailureHandsetUnavailable: "Son téléphone n'a pas pu le recevoir",
  sendFailureExpired: "Il a expiré avant de pouvoir partir",
  sendFailureContent: "Les fournisseurs ont refusé ce message",
  sendFailureEmpty: "Il n'y avait rien à envoyer",
  sendFailureAttachment: "Les fournisseurs ont refusé cette pièce jointe",
  sendFailureTooLong: "Trop long pour être envoyé",
  sendFailureRegistration:
    "Votre inscription pour les textos américains n'est pas encore approuvée",
  sendFailureNumberNotReady: "Ce numéro n'est pas encore configuré pour les textos",
  sendFailureTextingOff: "Les textos sont désactivés pour ce numéro",
  sendFailureNoSms: "Ce numéro ne peut pas envoyer de textos",
  sendFailureNoMms: "Ce numéro ne peut pas envoyer d'images",

  rejectRegEinWhat: "Le numéro d'identification fiscale que vous avez donné ne correspond pas à ce que le registre gouvernemental détient pour votre entreprise.",
  rejectRegEinFix: "Vérifiez l'EIN ou le numéro d'entreprise sur un document fiscal et saisissez-le exactement, chiffres seulement.",
  rejectRegNameWhat: "La dénomination sociale que vous avez donnée ne correspond pas à celle de votre inscription gouvernementale.",
  rejectRegNameFix: "Utilisez la dénomination sociale exacte figurant sur vos documents d'inscription, y compris tout Ltd, Inc ou LLC — le nom que vos clients voient se règle séparément.",
  rejectRegAddressWhat: "L'adresse de l'entreprise ne correspond pas à celle de votre inscription gouvernementale.",
  rejectRegAddressFix: "Entrez l'adresse d'entreprise inscrite plutôt qu'une adresse postale ou de chantier.",
  rejectRegWebsiteWhat: "Le fournisseur n'a pas pu confirmer votre entreprise à partir du site web que vous avez donné.",
  rejectRegWebsiteFix: "Donnez un site web qui nomme votre entreprise et décrit ce que vous faites, et assurez-vous qu'il s'affiche publiquement.",
  rejectRegConsentWhat: "Le fournisseur n'a pas été convaincu que vos clients acceptent de recevoir vos textos avant que vous leur écriviez.",
  rejectRegConsentFix: "Décrivez exactement où un client vous donne son numéro et ce qu'on lui dit à ce moment-là.",
  rejectRegSampleWhat: "Les exemples de textos n'ont pas montré au fournisseur ce que vous envoyez réellement.",
  rejectRegSampleFix: "Utilisez de vrais messages que vous enverriez à un client, et incluez le nom de votre entreprise dans chacun.",
  rejectRegUseCaseWhat: "Le cas d'utilisation que vous avez choisi ne correspond pas à ce que décrivent vos exemples et votre site web.",
  rejectRegUseCaseFix: "Choisissez la catégorie qui correspond aux textos que vous envoyez réellement à vos clients.",
  rejectRegDuplicateWhat: "Cette entreprise est déjà inscrite auprès des fournisseurs, fort probablement par un service que vous utilisiez auparavant.",
  rejectRegDuplicateFix: "Répondez-nous et nous ferons libérer ou transférer l'inscription existante — le formulaire ne peut rien y changer.",
  rejectRegEntityWhat: "Le type d'entreprise que vous avez choisi ne correspond pas à la façon dont votre entreprise est inscrite.",
  rejectRegEntityFix: "Choisissez le type qui correspond à vos documents — une entreprise individuelle et une société par actions ne s'inscrivent pas de la même façon.",
  rejectRegContactWhat: "Le fournisseur n'a pas pu joindre les coordonnées inscrites sur la demande.",
  rejectRegContactFix: "Donnez un courriel et un numéro de téléphone d'entreprise qui joignent une personne et qui ne répondent pas automatiquement.",
  rejectPortAccountWhat: "Le numéro de compte ne correspond pas à celui que votre fournisseur actuel a au dossier.",
  rejectPortAccountFix: "Copiez-le sur une facture récente de ce fournisseur — ce n'est habituellement pas le numéro de téléphone lui-même.",
  rejectPortPinWhat: "Le NIP de transfert était absent ou erroné.",
  rejectPortPinFix: "Demandez un NIP de transfert à votre fournisseur actuel — la plupart ne le donnent qu'au titulaire du compte, et il expire souvent en quelques jours.",
  rejectPortAuthWhat: "La personne nommée sur la demande n'est pas autorisée sur le compte.",
  rejectPortAuthFix: "Utilisez le nom de la personne que votre fournisseur actuel a comme titulaire du compte, écrit de la même façon.",
  rejectPortEntityWhat: "Le nom du titulaire du compte ne correspond pas aux dossiers de votre fournisseur actuel.",
  rejectPortEntityFix: "Utilisez le nom exactement tel qu'il apparaît sur la facture, y compris tout Ltd, Inc ou LLC.",
  rejectPortAddressWhat: "L'adresse de service ne correspond pas à celle que votre fournisseur actuel a au dossier.",
  rejectPortAddressFix: "Utilisez l'adresse figurant sur la facture de cette ligne, même si l'entreprise a déménagé depuis.",
  rejectPortPendingWhat: "Votre fournisseur actuel a un autre changement en cours sur cette ligne.",
  rejectPortPendingFix: "Demandez-lui de l'annuler ou de le terminer, puis dites-le-nous et nous renverrons la demande.",
  rejectPortInactiveWhat: "Votre fournisseur actuel indique que ce numéro n'est pas actif sur le compte que nous avons cité.",
  rejectPortInactiveFix: "Vérifiez que le numéro est encore en service et rattaché au compte que vous nous avez donné — un numéro déjà résilié ne peut pas être transféré.",

  resubmitWaitRegistration:
    "La plupart des renvois sont tranchés en un ou deux jours ouvrables.",
  resubmitWaitPort:
    "La plupart des transferts renvoyés sont acceptés en quelques jours ouvrables.",
};
