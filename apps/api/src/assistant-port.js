'use strict';

/**
 * Port de l'assistant — l'adaptateur qui va CHERCHER une réponse (ADR 0046).
 *
 * Même forme que notify-port.js et stripe-port.js : le SDK n'est requis que
 * PARESSEUSEMENT, dans la fabrique, pour que la suite de tests n'ait jamais
 * ni le paquet ni le réseau dans son graphe. Les tests injectent
 * `createFakeAssistant()`, qui répond à partir d'un scénario en mémoire ; le
 * reste du code ne peut pas distinguer les deux.
 *
 * La surface du port est UNE méthode :
 *
 *   answer({ systeme, historique, question, locale }) -> {
 *     texte,        // la réponse, dans la langue du visiteur
 *     repond,       // false = l'assistant refuse de répondre
 *     niveau,       // 1 | 2 | 3 — quel palier de la fiche a fondé la réponse
 *     motif,        // un id de domain.SUPPORT_ESCALADE_MOTIFS, si repond=false
 *     usage,        // { in, out } — pour la piste de coût, jamais pour le client
 *   }
 *
 * L'adaptateur ne connaît RIEN de Nota : il reçoit une invite système déjà
 * construite (support-assistant.js la bâtit à partir de la fiche de faits du
 * domaine) et rend une structure. Toute la connaissance produit vit du côté
 * hexagone ; ici il n'y a que le transport.
 */

// Le schéma de sortie : le modèle ne rend pas du texte libre qu'il faudrait
// deviner, il rend CETTE structure (output_config.format). Un `repond: false`
// est une réponse valide et attendue — c'est l'escalade.
const ANSWER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['repond', 'niveau', 'motif', 'texte'],
  properties: {
    repond: {
      type: 'boolean',
      description:
        'true si la fiche de faits fonde entièrement la réponse ; false s’il faut un humain.',
    },
    niveau: {
      type: ['integer', 'null'],
      enum: [1, 2, 3, null],
      description: 'Le palier de la fiche qui fonde la réponse ; null si repond=false.',
    },
    motif: {
      type: ['string', 'null'],
      description: 'Si repond=false : l’identifiant du motif d’escalade. Sinon null.',
    },
    texte: {
      type: 'string',
      description:
        'La réponse au visiteur, dans SA langue. Si repond=false, une phrase qui dit ' +
        'que la personne nommée dans l’invite reprend la question — jamais une excuse vide.',
    },
  },
};

const DEFAULT_MODEL = 'claude-opus-5';
// Une réponse de messagerie est courte par construction ; le plafond n'est là
// que pour qu'une dérive ne coûte pas une page.
const DEFAULT_MAX_TOKENS = 1500;

/**
 * L'adaptateur Anthropic. `apiKey` absente ⇒ la fabrique rend null : la
 * messagerie retombe alors sur l'humain, ce qui est le comportement d'avant
 * l'ADR 0046. Une clé manquante dégrade, elle ne casse jamais.
 */
function createAnthropicAssistant({ apiKey, model, maxTokens, effort, timeoutMs, client } = {}) {
  if (typeof apiKey !== 'string' || !apiKey.trim()) return null;

  const timeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 20000;
  const tokens = Number.isSafeInteger(maxTokens) && maxTokens > 0 ? maxTokens : DEFAULT_MAX_TOKENS;
  let provider = client;

  return {
    async answer({ systeme, historique, question, locale } = {}) {
      const messages = [];
      // L'historique du fil : le visiteur et l'assistant, en alternance. Un
      // message de l'humain (« nota ») est rendu comme une parole de
      // l'assistant : du point de vue du visiteur, c'est la même voix.
      for (const m of historique || []) {
        messages.push({
          role: m.de === 'visiteur' ? 'user' : 'assistant',
          content: String(m.texte || ''),
        });
      }
      messages.push({ role: 'user', content: String(question || '') });

      let res;
      try {
        // A prepared answer never loads the SDK or initializes a client.
        if (!provider) {
          const Anthropic = require('@anthropic-ai/sdk');
          const Client = Anthropic.default || Anthropic;
          provider = new Client({ apiKey, timeout, maxRetries: 0, logLevel: 'off' });
        }
        res = await provider.messages.create({
          model: model || DEFAULT_MODEL,
          max_tokens: tokens,
          // L'invite système est STABLE d'une question à l'autre (la fiche de
          // faits ne bouge qu'avec le catalogue) : elle se met en cache, et
          // seule la conversation est facturée plein tarif.
          system: [{ type: 'text', text: String(systeme || ''), cache_control: { type: 'ephemeral' } }],
          messages,
          thinking: { type: 'adaptive' },
          output_config: {
            // Une question de support ne demande pas une longue réflexion ; ce
            // qu'elle demande, c'est de la fidélité à la fiche.
            effort: effort || 'low',
            format: { type: 'json_schema', schema: ANSWER_SCHEMA },
          },
        // Retrying a full timeout can outlast the HTTP request and lose the
        // handoff. One bounded attempt leaves room for the human workflow.
        }, { timeout, maxRetries: 0 });
      } catch {
        // Provider errors can echo credentials or visitor text. Keep those
        // details out of errors propagated to callers and infrastructure.
        throw new Error('Support assistant provider unavailable.');
      }

      // Un refus de sécurité du modèle est traité comme une escalade : la
      // question part à l'humain plutôt que de rester sans réponse.
      if (!res || res.stop_reason !== 'end_turn') {
        return { texte: null, repond: false, niveau: null, motif: 'inconnu', usage: usageOf(res) };
      }
      const parsed = parseAnswer(res);
      if (!parsed) return { texte: null, repond: false, niveau: null, motif: 'inconnu', usage: usageOf(res) };
      return { ...parsed, usage: usageOf(res), locale: locale || null };
    },
  };
}

function usageOf(res) {
  const u = (res && res.usage) || {};
  const count = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;
  return { in: count(u.input_tokens), out: count(u.output_tokens), cacheRead: count(u.cache_read_input_tokens) };
}

// Le bloc texte de la réponse EST le JSON (output_config.format). On le lit
// avec prudence : un corps illisible vaut une escalade, jamais une exception.
function parseAnswer(res) {
  const blocks = res && res.content;
  if (!Array.isArray(blocks) || blocks.some(b => !b || !['text', 'thinking', 'redacted_thinking'].includes(b.type))) return null;
  const texts = blocks.filter(b => b.type === 'text');
  if (texts.length !== 1 || typeof texts[0].text !== 'string') return null;
  const text = texts[0].text.trim();
  if (!text) return null;
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  if (Object.keys(obj).length !== 4 || !Object.keys(ANSWER_SCHEMA.properties).every(key => Object.hasOwn(obj, key))) return null;
  if (typeof obj.repond !== 'boolean' || typeof obj.texte !== 'string' || (obj.motif !== null && typeof obj.motif !== 'string')) return null;
  if (obj.repond ? ![1, 2, 3].includes(obj.niveau) || obj.motif !== null : obj.niveau !== null) return null;
  return {
    texte: obj.texte.trim(),
    repond: obj.repond,
    niveau: obj.niveau,
    motif: obj.motif,
  };
}

/**
 * L'assistant de test et de développement local. `scenario` est une fonction
 * ({ question, historique }) -> la même structure que l'adaptateur réel ;
 * `calls` garde chaque appel pour qu'un test assertionne exactement ce que le
 * modèle aurait reçu — l'invite système comprise.
 */
function createFakeAssistant(scenario) {
  const calls = [];
  return {
    calls,
    async answer(input) {
      calls.push(input);
      const out = typeof scenario === 'function' ? await scenario(input) : scenario;
      if (out && out.throw) throw new Error(String(out.throw));
      return (
        out || { texte: null, repond: false, niveau: null, motif: 'inconnu', usage: { in: 0, out: 0, cacheRead: 0 } }
      );
    },
  };
}

module.exports = { createAnthropicAssistant, createFakeAssistant, ANSWER_SCHEMA, DEFAULT_MODEL };
