/** Static acquisition pages; French copy is translated by the shared dictionary.
 * Explicit .html URLs work on the existing S3/CloudFront origin without rewrites.
 * No price duplication: the current quote remains authoritative in the carnet.
 */
import { readFileSync } from 'node:fs';
const mod = { exports: {} };
new Function('module', 'exports', readFileSync(new URL('./public/i18n.js', import.meta.url), 'utf8'))(mod, mod.exports);
const I18N = mod.exports;
// The mark and the wordmark are drawn ONCE, in index.html (ADR 0048); every
// acquisition page inlines that same symbol block and <use>s it, so a change to
// the lockup reaches these pages without a second drawing to keep in step.
const INDEX_HTML = readFileSync(new URL('./public/index.html', import.meta.url), 'utf8');
const BRAND_SYMBOLS = (INDEX_HTML.match(/<svg class="svg-defs"[\s\S]*?<\/svg>/) || [''])[0];
if (!BRAND_SYMBOLS.includes('id="nota-logomark"') || !BRAND_SYMBOLS.includes('id="nota-wordmark"')) {
  throw new Error('seo-pages: index.html no longer carries the #nota-logomark / #nota-wordmark symbols');
}
const LOCKUP = '<span class="brand-lockup" aria-hidden="true"><svg class="brand-mark-svg" viewBox="0 0 64 64" focusable="false"><use href="#nota-logomark"/></svg><span class="brand-word"><svg class="brand-word-svg" viewBox="0 0 91.8 28" focusable="false"><use href="#nota-wordmark"/></svg><span class="visually-hidden">OTA</span></span></span><span class="brand-sub">Québec</span>';
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
<script>try{var t=JSON.parse(localStorage.getItem('nota.theme')||'null');document.documentElement.setAttribute('data-theme',t==='dark'?'dark':'light');}catch(e){}</script>
<meta name="theme-color" content="#101820" media="(prefers-color-scheme: dark)"><meta name="theme-color" content="#386888">
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
<link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Sora:wght@700;800&display=swap">
<link rel="stylesheet" href="/styles.css">
<style>.search-page{max-width:760px;margin:auto;padding:24px 20px 60px}.search-page header{display:flex;justify-content:space-between;align-items:center;gap:20px;margin-bottom:40px}.search-page header .brand{min-height:44px;text-decoration:none}.search-page header .lang-link{display:inline-flex;align-items:center;min-height:44px;padding:0 12px;border:1px solid var(--border);border-radius:var(--radius, 8px);color:var(--brand);text-decoration:none}.search-page p,.search-page li{font-size:var(--type-lead);line-height:var(--type-lead-lh)}.search-page section{margin:32px 0}.search-page h2{margin-top:0}.search-page .btn{white-space:normal;text-align:center;margin:12px 0}.search-page footer{border-top:1px solid var(--border);padding-top:24px}.search-page nav{display:flex;gap:16px;flex-wrap:wrap}.search-page nav a{display:inline-flex;align-items:center;min-height:44px}.search-page a:focus-visible{outline:3px solid var(--ring);outline-offset:4px}</style>
<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'WebPage', '@id': url, url, name: lang === 'en' ? I18N.tEn(page.title) : page.title, description: lang === 'en' ? I18N.tEn(page.description) : page.description, inLanguage: lang + '-CA', isPartOf: { '@id': origin + '/#website' } }).replaceAll('<', '\\u003c')}</script>
<script src="/landing.js" defer></script>
</head><body>${BRAND_SYMBOLS}<div class="search-page">
<header><a class="brand" href="${cta}" data-acquisition-link aria-label="${lang === 'en' ? 'Nota, home' : 'Nota, accueil'}">${LOCKUP}</a><a class="lang-link" href="${pagePath(page, lang === 'en' ? 'fr' : 'en')}" lang="${lang === 'en' ? 'fr' : 'en'}" hreflang="${lang === 'en' ? 'fr' : 'en'}-CA" data-acquisition-link>${lang === 'en' ? 'Français' : 'English'}</a></header>
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
