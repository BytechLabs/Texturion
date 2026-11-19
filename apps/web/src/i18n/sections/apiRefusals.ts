import type { Translated } from "../translated";

export const apiRefusalsEn = {
  areaCodeCountryMismatch: "requested_area_code must be a {country} area code (the company's country).",
  areaCodeNotAssigned: "requested_area_code is not an assigned US/CA geographic area code.",
  billingAlreadySubscribed: "This company already has a subscription.",
  contactNumberNotFound: "No such contact number.",
  contactUnmergeMainNumberInUse: "Choose a different main number before undoing this merge.",
  inviteAlreadyPending: "A pending invite for this email already exists.",
  numberCountryMismatch: "chosen_number_e164 must be a {country} number (the company's country).",
  numberNotAssigned: "chosen_number_e164 is not an assigned US/CA geographic number.",
  outboundSendPaused: "Texting is paused while we deal with an issue. Nothing you sent was lost.",
  paymentsNotSetUp: "This workspace has not set up payments yet.",
  portAlreadyPending: "A transfer for this number is already in progress.",
  textEnablementAlreadyPending: "This number already has a text-enablement in progress.",
  textEnablementNumberInUse: "This number is already in service on Loonext and can't be text-enabled.",
  textEnablementWrongCode: "That code didn't match. Request a new code and try again.",
} as const;

export const apiRefusalsFr: Translated<typeof apiRefusalsEn> = {
  areaCodeCountryMismatch: "Choisissez un indicatif régional du pays où votre espace de travail est enregistré ({country}).",
  areaCodeNotAssigned: "Choisissez un indicatif régional géographique attribué au Canada ou aux États-Unis.",
  billingAlreadySubscribed: "Cet espace de travail a déjà un abonnement.",
  contactNumberNotFound: "Ce numéro ne figure pas dans cette fiche de contact.",
  contactUnmergeMainNumberInUse: "Choisissez un autre numéro principal avant d’annuler la fusion.",
  inviteAlreadyPending: "Une invitation à cette adresse courriel est déjà en attente.",
  numberCountryMismatch: "Choisissez un numéro du pays où votre espace de travail est enregistré ({country}).",
  numberNotAssigned: "Choisissez un numéro géographique attribué au Canada ou aux États-Unis.",
  outboundSendPaused: "L’envoi de textos est suspendu pendant que nous réglons un problème. Vos textos ont été conservés.",
  paymentsNotSetUp: "Les paiements ne sont pas encore configurés dans cet espace de travail.",
  portAlreadyPending: "Un transfert est déjà en cours pour ce numéro.",
  textEnablementAlreadyPending: "L’activation des textos est déjà en cours pour ce numéro.",
  textEnablementNumberInUse: "Ce numéro est déjà en service sur Loonext. Vous ne pouvez pas y activer les textos de cette façon.",
  textEnablementWrongCode: "Ce code ne correspond pas. Demandez un nouveau code, puis réessayez.",
};
