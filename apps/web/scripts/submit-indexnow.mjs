/** Submit only published public URLs. Preview by default; --submit sends. */
import { readFileSync } from 'node:fs';
const base = new URL('../public/', import.meta.url);
const key = readFileSync(new URL('indexnow-key.txt', base), 'utf8').trim();
if (!/^[a-zA-Z0-9-]{8,128}$/.test(key)) throw new Error('Invalid IndexNow key');
const xml = readFileSync(new URL('sitemap.xml', base), 'utf8');
const urlList = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
if (!urlList.length || urlList.some(s => {
  const url = new URL(s);
  return url.origin !== 'https://gonota.ca' || url.hash || url.search || url.pathname.startsWith('/api');
})) throw new Error('Only canonical public URLs may be submitted');
const payload = { host: 'gonota.ca', key, keyLocation: 'https://gonota.ca/indexnow-key.txt', urlList };
if (!process.argv.includes('--submit')) {
  console.log(JSON.stringify({ mode: 'preview', ...payload }, null, 2));
  console.log('After deployment: node apps/web/scripts/submit-indexnow.mjs --submit');
} else {
  const get = async url => {
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    return response.text();
  };
  if ((await get(payload.keyLocation)).trim() !== key) throw new Error('Deploy the ownership key first');
  for (const url of urlList) {
    const html = await get(url);
    if (!html.includes(`rel="canonical" href="${url}"`) || /name="robots"[^>]*noindex/i.test(html)) {
      throw new Error(`URL is not published with its expected indexable canonical: ${url}`);
    }
  }
  const response = await fetch('https://api.indexnow.org/indexnow', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(20000),
  });
  if (![200, 202].includes(response.status)) throw new Error(`IndexNow: HTTP ${response.status}`);
  console.log(`IndexNow HTTP ${response.status}: ${urlList.length} URLs received; indexing is not guaranteed.`);
}
