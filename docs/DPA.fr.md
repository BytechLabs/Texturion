# Entente de traitement des données (#285, #228)

**Statut : jumeau français de `docs/DPA.md`, publié à `/fr/entente-traitement-donnees`.**
Les douze clauses numérotées ci-dessous sont la traduction fidèle de celles de
`docs/DPA.md`; la version anglaise reste la source des faits, et chaque
changement à l'une doit être fait dans l'autre. Un test
(`apps/web/src/components/marketing/legal/legal-twins.test.tsx`) échoue si les
deux versions n'ont pas les mêmes clauses, les mêmes puces et les mêmes
citations. Cette traduction n'a pas été révisée par un avocat québécois.

Loonext agit à titre de sous-traitant à l'égard du contenu client qu'un espace
de travail envoie et reçoit. Voici le document à remettre à un acheteur qui
demande une entente de traitement des données.

---

## 1. Rôles

Loonext (BytechLabs) agit à titre de **sous-traitant** à l'égard du contenu
client qu'un espace de travail envoie et reçoit (messages, contacts,
enregistrements d'appels, messagerie vocale) et à titre de **responsable du
traitement** à l'égard de ses propres dossiers de compte et de facturation.

Le client est le responsable du traitement du contenu de son espace de travail
et doit s'assurer d'avoir un fondement licite pour joindre les personnes qui s'y
trouvent. Cette responsabilité est déjà énoncée dans la politique d'utilisation
acceptable et n'est pas atténuée ici.

> Source: `/legal/aup`, `/legal/privacy`

## 2. Objet, durée, nature et finalité

- **Objet :** exploiter un numéro de téléphone d'entreprise partagé : envoyer et
  recevoir des SMS/MMS, passer et répondre à des appels, conserver l'historique
  des conversations qui en résulte, et envoyer les messages automatisés que
  l'espace de travail configure.
- **Durée :** aussi longtemps que l'espace de travail existe, plus le délai de
  suppression prévu à la section 9.
- **Nature et finalité :** fournir le service auquel le client s'est abonné.
  Pas pour nos propres analyses au-delà des comptages décrits à la section 5, et
  pas pour entraîner des modèles; voir la section 7.

**Catégories de personnes concernées :** les membres de l'équipe du client, et
les clients du client qui écrivent ou téléphonent au numéro de l'espace de
travail.

**Types de renseignements personnels :** énumérés par champ et par plateforme,
avec la raison de chacun, dans `docs/DATA-INVENTORY.md`. Ce document, plutôt que
la présente clause, est la liste de référence, parce qu'il est tenu à jour par
rapport au schéma.

> Source: `docs/DATA-INVENTORY.md` §"Data collected"

## 3. Traitement selon des instructions documentées

Nous traitons le contenu client pour fournir le service et selon les
instructions du client, qui, pour ce produit, sont exprimées par les paramètres
de l'espace de travail : qui fait partie de l'équipe, quelles automatisations
sont activées, ce que dit le message d'absence.

Nous ne vendons pas le contenu client, et nous n'utilisons pas le corps des
messages pour établir des profils ou des audiences publicitaires.

## 4. Confidentialité

L'accès aux données de production est limité aux personnes qui en ont besoin
pour exploiter le service. Les identifiants sont conservés sous forme de secrets
chiffrés et jamais dans le dépôt de code; la clé de la base de données peut être
révoquée indépendamment et la clé de paiement est restreinte à la facturation.

**Le nombre de ces personnes n'est pas indiqué ici**, parce qu'aucun document de
ce dépôt ne le consigne et qu'un chiffre inventé pour un contrat est le genre de
clause que ce document existe pour éviter. C'est une question légitime pour un
acheteur, et il faudrait y répondre à partir des faits avant la signature.

> Source: `docs/SECURITY-QUESTIONNAIRE.md` §3

## 5. Mesures de sécurité

- Chiffrement en transit et au repos.
- Le contenu des messages est exclu des analyses et des rapports d'erreurs. C'est
  appliqué plutôt que simplement voulu : chaque rapport d'erreur est épuré avant
  d'être envoyé (corps de requête supprimés, numéros de téléphone et adresses
  courriel masqués), et il n'y a aucune relecture de session.
- L'isolement des locataires est effectué par l'API à chaque requête. **C'est une
  couche, pas deux** : la clé de base de données du Worker contourne la sécurité
  au niveau des lignes, de sorte qu'une requête sans portée dans notre propre
  code serait exécutée telle qu'écrite. SPEC §10 le dit en ces termes plutôt que
  de parler de défense en profondeur.
- Les analyses ne contiennent que des UUID, des comptages et des événements de
  fonctionnalités.

**Une note historique, et pourquoi ce n'est pas une clause de divulgation.** Du
2026-07-01 au 2026-08-09, les fils d'Ariane de notre outil de rapport d'erreurs
ont consigné les URL sortantes complètes, y compris les chaînes de requête. La
cause est corrigée, ces événements ont quitté la période de conservation de
l'outil de suivi des erreurs le 2026-11-07, et cet outil n'est plus utilisé. Le
produit n'était pas offert au public durant cette période; les données en cause
sont donc notre propre trafic de test et celui d'espaces de travail que le
fondateur contrôle. Aucun client n'est concerné et il n'y a donc rien à lui
divulguer dans le cadre du présent contrat.

> Source: SPEC §10

## 6. Sous-traitants ultérieurs

Liste actuelle, tenue publique et à jour : **Cloudflare, OpenAI, PostHog, Resend,
Stripe, Supabase, Telnyx et Cloudflare Workers AI.**

> Source: `/legal/subprocessors`

Nous publierons les changements à cette liste sur la même page. Un client qui
s'oppose à un nouveau sous-traitant ultérieur peut résilier; nous n'avons aucun
moyen d'exploiter le service pour un espace de travail avec un ensemble de
fournisseurs différent, et prétendre le contraire serait une clause que nous ne
pourrions pas respecter.

## 7. Traitement par l'IA

Le texte des messages des clients et l'audio de la messagerie vocale sont traités
par Cloudflare Workers AI et OpenAI pour les fonctionnalités que l'espace de
travail a activées. La divulgation indique le **cheminement** plutôt que de
laisser entendre un confinement, parce que l'inférence ne peut pas être confinée
à un pays.

Le contenu client n'est pas utilisé pour entraîner des modèles. Cloudflare
l'affirme pour Workers AI dans des termes que nous citons textuellement plutôt
que de les paraphraser.

> Source: `docs/DATA-INVENTORY.md` §AI, `packages/shared/src/ai-disclosure.ts`

## 8. Violation de données personnelles

Nous avisons les espaces de travail touchés **dans les 72 heures suivant la
confirmation** d'une atteinte aux mesures de sécurité qui crée un risque réel de
préjudice grave, en indiquant ce que nous savons et ce que nous ne savons pas
encore. Lorsque nous agissons comme sous-traitant pour les données du client,
nous avisons le client, et le client avise les personnes touchées et l'autorité
de réglementation.

> Source: `/security`

## 9. Suppression et restitution

- Un client peut supprimer son espace de travail. La suppression est réversible
  pendant **30 jours** et irréversible par la suite.
- **La suppression n'est pas complète dans tous les magasins de données, et les
  exceptions sont énumérées plutôt que sous-entendues.** Aujourd'hui, il y en a
  une : un message envoyé par le formulaire de contact du site est conservé hors
  de tout espace de travail, est supprimé selon son propre calendrier au bout
  d'un an, et peut être retiré plus tôt sur demande.
- Un utilisateur qui détient la permission `records.delete` peut supprimer un
  message, une conversation, un appel, un message vocal ou un contact. Il est
  masqué de toutes les vues à la fois, récupérable dans la corbeille pendant
  **30 jours**, puis effacé avec ses fichiers stockés, ses enregistrements de
  messagerie vocale, ses transcriptions et ses résumés dérivés (une suppression
  par le client, selon ses instructions). Les compteurs de facturation et les
  registres d'exclusion des textos ne contiennent aucun contenu de message
  et sont conservés.
- Les contacts peuvent être exportés. **Une exportation plus large n'existe pas
  encore** (#304).

> Source: `packages/shared/src/deletion-promises.ts`
> (`DELETION_GRACE_DAYS`, `DELETION_GAPS`), `docs/DELETION.md`

## 10. Audits et information

Nous répondrons à un questionnaire de sécurité et fournirons l'information
contenue dans `docs/SECURITY-QUESTIONNAIRE.md` et dans les documents qu'il cite.

**Nous n'offrons pas aux clients d'audits sur place ni de tests d'intrusion de la
production**, et il n'existe aucun rapport SOC 2 ou ISO 27001 pour en tenir lieu.
Une clause accordant des droits d'audit que nous n'avons aucun moyen d'honorer
serait le genre de promesse que tout ce document est écrit pour éviter.

> Source: `/security`, `docs/SECURITY-QUESTIONNAIRE.md` §"What we do not have"

## 11. Transferts internationaux

Les données sont stockées aux **États-Unis**. C'est un énoncé de l'endroit où
elles se trouvent, **et non une garantie de résidence** : nous n'en offrons pas,
et l'inférence de l'IA en particulier ne peut pas être confinée à un pays. La
divulgation transfrontalière exigée par la LPRPDE et par la Loi 25 du Québec se
trouve sur la page de confidentialité.

> Source: `/legal/privacy`, `docs/ACCEPTED-RISKS.md` R4

## 12. Ce que ce document ne fait pas

- Il ne revendique aucune certification que nous ne détenons pas.
- Il ne promet ni résidence, ni droit d'audit, ni exhaustivité de la suppression
  que le produit ne peut pas offrir.
- Il ne remplace pas les conditions d'utilisation; lorsque les deux divergent,
  c'est un défaut du présent document et les conditions l'emportent jusqu'à ce
  qu'il soit corrigé.
