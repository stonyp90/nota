/** Static acquisition pages; French copy is translated by the shared dictionary.
 * Explicit .html URLs work on the existing S3/CloudFront origin without rewrites.
 * No price duplication: the current quote remains authoritative in the carnet.
 */
import { readFileSync } from 'node:fs';
const mod = { exports: {} };
new Function('module', 'exports', readFileSync(new URL('./public/i18n.js', import.meta.url), 'utf8'))(mod, mod.exports);
const I18N = mod.exports;
export const origin = 'https://gonota.ca';
export const pages = [
  { slug: 'notaire-refinancement-quebec', en: 'mortgage-refinancing-notary-quebec-city',
    title: 'Notaire pour un refinancement hypothécaire à Québec',
    description: 'Vous refinancez votre propriété? Proposez votre date de signature et votre offre sur Nota. Un notaire décide de prendre votre demande.',
    heading: 'Préparer un refinancement',
    preparation: 'Indiquez où en est votre approbation bancaire et la date visée. Le notaire précisera les pièces nécessaires à votre dossier et vérifiera les démarches liées à votre hypothèque actuelle.' },
  { slug: 'notaire-financement-quebec', en: 'mortgage-financing-notary-quebec-city',
    title: 'Notaire pour un financement hypothécaire à Québec',
    description: 'Vous préparez un financement hypothécaire? Affichez votre date souhaitée et votre offre pour trouver un notaire dans la région de Québec.',
    heading: 'Préparer un financement',
    preparation: 'Indiquez le montant du prêt, le prêteur et la date souhaitée. Si le financement accompagne un achat, confirmez avec le notaire quels actes et débours sont inclus dans son mandat.' },
];
export const pagePath = (page, lang) => `/${lang === 'en' ? page.en : page.slug}.html`;
const escape = (s) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
export function renderPage(page, lang = 'fr') {
  const t = (s) => escape(lang === 'en' ? I18N.tEn(s) : s);
  const url = origin + pagePath(page, lang);
  const cta = `/?lang=${lang}#t=carnet`;
  const section = (heading, body) => `<section><h2>${t(heading)}</h2><p>${t(body)}</p></section>`;
  return `<!doctype html>
<html lang="${lang}-CA" data-theme="light"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${t(page.title)} | Nota</title>
<meta name="description" content="${t(page.description)}">
<meta name="robots" content="index,follow,max-image-preview:large">
<link rel="canonical" href="${url}">
<link rel="alternate" hreflang="fr-CA" href="${origin + pagePath(page, 'fr')}">
<link rel="alternate" hreflang="en-CA" href="${origin + pagePath(page, 'en')}">
<link rel="alternate" hreflang="x-default" href="${origin + pagePath(page, 'fr')}">
<meta property="og:type" content="website"><meta property="og:site_name" content="Nota">
<meta property="og:title" content="${t(page.title)}"><meta property="og:description" content="${t(page.description)}">
<meta property="og:url" content="${url}"><meta property="og:locale" content="${lang}_CA">
<meta property="og:image" content="${origin}/og.png"><meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/favicon.svg"><link rel="stylesheet" href="/styles.css">
<style>.search-page{max-width:760px;margin:auto;padding:24px 20px 60px}.search-page header{display:flex;justify-content:space-between;gap:20px;margin-bottom:48px}.search-page h1{font-size:clamp(2rem,6vw,3.4rem);line-height:1.12}.search-page p,.search-page li{font-size:1.05rem;line-height:1.7}.search-page section{margin:36px 0}.search-page .btn{white-space:normal;text-align:center;margin:12px 0}.search-page footer{border-top:1px solid #ccc;padding-top:24px}.search-page nav{display:flex;gap:16px;flex-wrap:wrap}.search-page a:focus-visible{outline:3px solid #315b43;outline-offset:4px}</style>
<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'WebPage', '@id': url, url, name: lang === 'en' ? I18N.tEn(page.title) : page.title, description: lang === 'en' ? I18N.tEn(page.description) : page.description, inLanguage: lang + '-CA', isPartOf: { '@id': origin + '/#website' } }).replaceAll('<', '\\u003c')}</script>
<script src="/analytics.js" defer></script>
<script src="/landing.js" defer></script>
</head><body><div class="search-page">
<header><a href="${cta}" data-acquisition-link>Nota · Québec</a><a href="${pagePath(page, lang === 'en' ? 'fr' : 'en')}" lang="${lang === 'en' ? 'fr' : 'en'}" data-acquisition-link>${lang === 'en' ? 'Français' : 'English'}</a></header>
<main><h1>${t(page.title)}</h1><p>${t(page.description)}</p>
<a class="btn btn-primary btn-lg" href="${cta}" data-acquisition-link>${t('Voir les dates et proposer mon offre')}</a>
<p>${t('Publier une demande est gratuit. La date reste à confirmer avec le notaire.')}</p>
<section><h2>${t('Comment trouver votre notaire')}</h2><ol>${['Choisissez le service et votre date souhaitée dans le carnet.', 'Consultez le prix présenté et proposez votre offre.', 'Un notaire peut accepter, faire une contre-offre ou passer. Vous préparez ensuite le dossier ensemble.'].map(s => `<li>${t(s)}</li>`).join('')}</ol></section>
${section('Quel budget prévoir?', 'Consultez le devis dans le carnet : il distingue les honoraires du notaire du prix du service Nota. Vérifiez aussi les taxes, les débours et les conditions de paiement avant de poursuivre.')}
${section(page.heading, page.preparation)}
${section('Faut-il avoir tous les documents avant de commencer?', 'Vous pouvez commencer par votre demande. Le notaire vous indiquera ensuite les documents à fournir selon votre situation; ne publiez aucun document personnel dans le carnet public.')}
${section('La date est-elle garantie?', 'Non. Une demande publiée ne constitue pas une réservation confirmée. La prise en charge dépend des disponibilités du notaire et de la préparation du dossier.')}
${section('À qui s’adresse Nota?', 'Nota met en relation des clients et des notaires dans la région de Québec pour le financement et le refinancement hypothécaires. Nota n’est pas un notaire et ne fournit pas de conseils juridiques.')}
<a class="btn btn-primary" href="${cta}" data-acquisition-link>${t('Voir les dates et proposer mon offre')}</a></main>
<footer><h2>${t('Explorer les services')}</h2><nav>${pages.map(p => `<a href="${pagePath(p, lang)}" data-acquisition-link>${t(p.title)}</a>`).join('')}<a href="${cta}" data-acquisition-link>${t('Consulter le carnet')}</a></nav></footer>
</div></body></html>`;
}
