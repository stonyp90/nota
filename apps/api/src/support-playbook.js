'use strict';

const domain = require('@nota/domain');

// Reviewed navigation answers, not personal advice. Monetary and operational
// values are supplied by the same fact sheet as the model, never copied here.
function supportPlaybook(facts, policy) {
  const pair = (fr, en) => ({ fr, en });
  const answers = {
    prix: pair('Le total dépend de l’acte et des choix du formulaire; les taxes et les débours sont en sus. Quel acte souhaitez-vous préparer ?', 'The total depends on the service and your form selections; taxes and disbursements are extra. Which service are you preparing?'),
    fonctionnement: pair('Choisissez une date au carnet, remplissez votre demande et vérifiez le montant avant de publier. Lorsqu’un notaire retient votre demande, retrouvez ses coordonnées et vos échanges dans votre espace client.', 'Choose a date in the calendar, complete your request and review the amount before publishing. Once a notary retains your request, their contact details and your messages appear in your client area.'),
    documents: pair('Les pièces à préparer dépendent de l’acte. Aucun document n’est demandé dans cette messagerie : après la retenue, utilisez la conversation de votre dossier avec le notaire. Quel acte préparez-vous ?', 'The documents depend on the service. Do not send documents in this support chat: once your request is retained, use the conversation in your file with the notary. Which service are you preparing?'),
    annulation: pair(`Avant qu’un notaire retienne la demande, le retrait est sans frais. Après la retenue, une annulation peut ouvrir une réclamation justifiée du notaire, selon le barème affiché; aucun prélèvement n’est automatique du seul fait d’annuler. Consultez votre offre pour vérifier son état avant de confirmer.`, 'Before a notary retains the request, withdrawal is free. After retention, cancellation may allow a justified claim by the notary under the displayed schedule; cancelling alone does not trigger an automatic charge. Check the status in your offer before confirming.'),
    services: pair(`Le territoire annoncé est ${policy.catalogue.territoire}. Les actes offerts sont : ${facts.services.map(s => s.nom).join(', ')}. Un acte absent de ce catalogue doit être vérifié auprès de l’équipe; sa disponibilité n’est pas confirmée ici.`, `The advertised area is Québec City and the surrounding area. Available services are: ${facts.services.map(s => s.nomEn).join(', ')}. Ask the team about anything outside this catalogue; availability is not confirmed here.`),
    territoire: pair(`Le territoire annoncé est : ${policy.catalogue.territoire}. Indiquez seulement votre secteur postal, sans adresse complète, pour une question de couverture.`, `The advertised area is Québec City and the surrounding area. For a coverage question, share only your postal area, not your full address.`),
    date: pair('La date demandée ne confirme pas à elle seule une signature. La disponibilité et la préparation du dossier doivent être convenues avec le notaire; cette messagerie ne peut pas garantir une date.', 'A requested date does not by itself confirm a signing appointment. Availability and file preparation must be arranged with the notary; this chat cannot guarantee a date.'),
    deplacement: pair('Le formulaire présente les modes de signature et de déplacement offerts pour votre demande. Après la retenue, convenez du lieu et de l’heure avec votre notaire dans la conversation du dossier.', 'The form shows signing and travel options for your request. After retention, arrange the location and time with your notary in the file conversation.'),
    preteur: pair('Choisissez votre prêteur parmi les options du formulaire. Sa présence dans la liste ne confirme pas l’acceptation de votre dossier : le notaire doit vérifier les exigences applicables.', 'Select your lender from the form options. Being listed does not confirm acceptance of your file: the notary must check the applicable requirements.'),
    paiement: pair(`La carte est enregistrée à la publication. Une réservation est prévue ${domain.CAUTION_LEAD_DAYS} jours avant la signature; l’encaissement se fait à la signature de l’acte. Cette messagerie ne peut pas vérifier une opération sur votre carte.`, `Your card is saved when you publish. A hold is scheduled ${domain.CAUTION_LEAD_DAYS} days before signing; payment is collected when the act is signed. This chat cannot verify a transaction on your card.`),
    carte: pair('Consultez l’avis de paiement dans votre espace client pour enregistrer une autre carte. Ne transmettez aucun numéro de carte ici. Si le problème persiste, décrivez le message d’erreur sans renseignements bancaires.', 'Check the payment notice in your client area to save another card. Do not send card numbers here. If the problem persists, describe the error without banking information.'),
    connexion: pair('Vérifiez l’adresse saisie et le dossier des courriels indésirables, puis demandez un nouveau lien depuis la connexion. Ne collez pas votre lien ni votre code ici. Si le problème persiste, l’équipe peut reprendre la question.', 'Check the address you entered and your spam folder, then request a new link from the sign-in screen. Do not paste your link or code here. If the problem persists, the team can take over.'),
    suivi: pair('Ouvrez votre espace client, puis votre offre pour voir son statut. Après la retenue, la conversation du dossier permet de joindre votre notaire. L’assistant n’a pas accès à votre dossier.', 'Open your client area, then your offer to see its status. After retention, use the file conversation to contact your notary. The assistant cannot access your file.'),
    proposition: pair('Ouvrez l’offre dans votre espace client et consultez le montant proposé avant de répondre avec les commandes affichées. Cette messagerie ne peut ni accepter une proposition ni modifier le prix pour vous.', 'Open the offer in your client area and review the proposed amount before responding with the displayed controls. This chat cannot accept a proposal or change the price for you.'),
    modifier: pair('Ouvrez votre offre pour voir les actions disponibles selon son statut. Si un notaire l’a retenue, discutez du changement avec lui dans la conversation du dossier. Rien n’est modifié en écrivant ici.', 'Open your offer to see the actions available for its status. If a notary has retained it, discuss the change in your file conversation. Writing here does not change anything in your request.'),
    sans_notaire: pair('Consultez le statut de votre offre dans votre espace client. La publication ne garantit pas qu’un notaire la retiendra; l’assistant ne peut pas vérifier les disponibilités ni promettre une prise en charge.', 'Check your offer status in your client area. Publishing does not guarantee that a notary will retain it; the assistant cannot check availability or promise acceptance.'),
    desistement: pair('Lorsqu’un notaire se désiste, la demande revient au carnet et vous en êtes prévenu. Consultez votre offre pour connaître son état actuel; une nouvelle retenue n’est pas garantie.', 'When a notary withdraws, the request returns to the calendar and you are notified. Check your offer for its current status; another notary accepting it is not guaranteed.'),
    confidentialite: pair('L’offre est anonyme par défaut. Après la retenue, échangez les pièces du dossier dans la conversation avec votre notaire, sans les copier ici. Pour une demande concernant vos données personnelles, l’équipe peut vous orienter.', 'Offers are anonymous by default. After retention, exchange file documents in the conversation with your notary, without copying them here. The team can help with requests concerning your personal data.'),
    effacement: pair(`Adressez votre demande d’accès, de rectification ou d’effacement à ${facts.contact.confidentialite || facts.contact.courriel}. Ne joignez pas de pièce d’identité ici; l’équipe indiquera la marche à suivre. Ce message ne supprime aucune donnée.`, `Send access, correction or deletion requests to ${facts.contact.confidentialite || facts.contact.courriel}. Do not attach identification here; the team will explain the next steps. This message does not delete any data.`),
    inscription_notaire: pair('Ouvrez l’espace notaire pour commencer l’inscription gratuite. Une personne vérifie l’inscription au Tableau de l’Ordre avant l’accès à la console. Aucun délai d’approbation n’est annoncé.', 'Open the notary area to start free registration. A person checks registration with the Order before console access. No approval time is promised.'),
    technique: pair('Indiquez la page concernée, l’action tentée et le message d’erreur, sans code de connexion ni renseignement bancaire. Avant de recommencer une publication ou un paiement, vérifiez son état dans votre espace client pour éviter un doublon.', 'Tell us the page, the action you tried and the error message, without sign-in codes or banking details. Before retrying a publication or payment, check its status in your client area to avoid a duplicate.'),
    juridique: pair('Nota n’est pas un notaire et cette messagerie ne donne pas d’avis juridique. Le notaire chargé du dossier peut examiner votre situation et les documents; l’équipe peut vous aider à trouver le bon interlocuteur.', 'Nota is not a notary and this chat does not provide legal advice. The notary handling your file can review your situation and documents; the team can help direct your question.'),
  };
  answers.modification = answers.modifier;
  answers.notaire = answers.suivi;
  return domain.SUPPORT_TOPICS.map(topic => ({ ...topic, answer: answers[topic.id] || null,
    escalade: ({ humain: 'humain', plainte: 'plainte', juridique: 'conseil_juridique', suivi: 'dossier_precis', modification: 'dossier_precis' })[topic.id] || null }));
}

const normalize = value => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[’']/g, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
// The domain's frozen questions are shared across requests. Index their text
// once; answers remain scoped to the current fact sheet and policy.
const topicIds = new Map(domain.SUPPORT_TOPICS.flatMap(topic =>
  [topic.fr, topic.en].map(phrase => [normalize(phrase), topic.id])));
function preparedTopic(question, playbook) {
  // Full utterance only: a keyword match must never swallow a complaint,
  // personal question, or instruction appended to an otherwise familiar FAQ.
  const id = topicIds.get(normalize(question));
  return id ? playbook.find(topic => topic.id === id) : undefined;
}

function sensitiveInput(question) {
  const text = String(question || '').normalize('NFKC');
  return domain.supportQuestionGuard(text) === 'renseignements_sensibles' ||
    /(?:\d[ -]?){13,19}|\b\d{3}[ -]\d{3}[ -]\d{3}\b|\b(?:token|access[_ -]?token|api[_ -]?key|password|mot de passe|cvv|cvc|otp|recovery[_ -]?code|verification[_ -]?code|code de connexion)\s*(?:[:=]|\b(?:is|est)\b)\s*\S+/i.test(text);
}

function inputGuard(question) {
  // Test secrets independently, before other intents: a message can contain
  // both a human request / instruction attack and credentials.
  if (sensitiveInput(question)) return 'renseignements_sensibles';
  const text = normalize(question);
  if (/\b(?:humain|humaine|parler a (?:une personne|quelqu un)|speak to (?:a person|someone)|human|real person)\b/.test(text)) return 'inconnu';
  if (/\b(?:plainte|porter plainte|complaint|dispute a (?:charge|payment)|contester un paiement)\b/.test(text)) return 'plainte';
  if (/\b(?:ignore|ignorez|oublie|forget|bypass)\b.{0,60}\b(?:instructions|regles|rules|prompt|consignes)\b|\b(?:system prompt|invite systeme)\b/.test(text)) return 'inconnu';
  return null;
}

function troubleshootingFailed(question) {
  return /\b(?:still (?:doesn t|does not|not|can t|cannot|won t)|(?:that|it|this) (?:didn t|did not) (?:work|help)|already tried|same (?:error|problem)|ca ne (?:marche|fonctionne) (?:toujours|encore) pas|(?:toujours|encore) (?:pas|impossible|le meme probleme|la meme erreur)|deja (?:essaye|fait))\b/.test(normalize(question));
}

// Technical capabilities, checked independently of the model's refusal flag.
function unsafeOutput(text, sources = []) {
  if (sensitiveInput(text)) return true;
  const urls = String(text || '').match(/https?:\/\/[^\s<>]+/gi) || [];
  const allowed = new Set(sources.map(source => source.url));
  if (urls.some(url => !allowed.has(url.replace(/[.,;!?)\]]+$/, '')))) return true;
  return /(?:\b(?:j[’']ai|nous avons|i have|i[’']ve|we have|we[’']ve)\s+(?:bien\s+)?(?:annul[ée]|modifi[ée]|supprim[ée]|rembours[ée]|v[ée]rifi[ée]|consult[ée]|cancelled|canceled|changed|deleted|refunded|checked|accessed))/i.test(String(text || ''));
}

module.exports = { supportPlaybook, preparedTopic, inputGuard, sensitiveInput, troubleshootingFailed, unsafeOutput };
