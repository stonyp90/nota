/** Retired acquisition URLs: overwrite old pages with localized, non-indexable redirects. */
export const pages = [
  { slug: 'notaire-refinancement-quebec', en: 'mortgage-refinancing-notary-quebec-city' },
  { slug: 'notaire-financement-quebec', en: 'mortgage-financing-notary-quebec-city' },
];
export const pagePath = (page, lang) => `/${lang === 'en' ? page.en : page.slug}.html`;
export function renderPage(page, lang = 'fr') {
  const target = `/?lang=${lang}#t=carnet`;
  const title = lang === 'en' ? 'Continue to Nota' : 'Continuer vers Nota';
  return `<!doctype html>
<html lang="${lang}-CA"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title><meta name="robots" content="noindex,follow">
<link rel="canonical" href="https://gonota.ca/${lang === 'en' ? '?lang=en' : ''}">
<meta http-equiv="refresh" content="0;url=${target}">
</head><body><main><h1>${title}</h1><a href="${target}">${title}</a></main></body></html>`;
}
