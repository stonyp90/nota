/**
 * Generate the launch copy and safe UTM links from the staged video manifest.
 * It never publishes, deletes, contacts, or calls a social platform.
 *
 * Preview:
 *   npm run marketing:launch:kit
 * Write a local handoff file after the owner has approved the copy:
 *   npm run marketing:launch:kit -- --write output/nota-launch-kit.md
 * Add a public YouTube URL only after publication:
 *   --video customer-fr-CA=https://youtu.be/example
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outputDir = resolve(here, '../../../output');

// The video build is dated, and a rebrand makes a new one: pinning a single
// folder name is how the kit came to advertise a build recorded before the
// brand shipped. The newest manifest wins, and --manifest overrides it.
function newestManifest() {
  const flag = process.argv.indexOf('--manifest');
  if (flag !== -1) {
    const given = process.argv[flag + 1];
    if (!given) throw new Error('--manifest requires a path');
    return resolve(given);
  }
  const found = readdirSync(outputDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => resolve(outputDir, entry.name, 'youtube-manifest.json'))
    .filter(existsSync)
    .sort();
  if (!found.length) throw new Error(`No youtube-manifest.json under ${outputDir}`);
  return found[found.length - 1];
}

const manifestPath = newestManifest();
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const base = 'https://gonota.ca';
const campaign = 'lancement_quebec_202609';
const args = process.argv.slice(2);
const videoUrls = new Map();
let outputPath = '';

for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--write') {
    outputPath = args[++i] || '';
    if (!outputPath) throw new Error('--write requires a path');
    continue;
  }
  if (args[i] === '--video') {
    const value = args[++i] || '';
    const split = value.indexOf('=');
    if (split < 1) throw new Error('--video expects stem=https://youtu.be/...');
    const stem = value.slice(0, split);
    const url = value.slice(split + 1);
    if (!/^https:\/\/(?:www\.)?(?:youtube\.com|youtu\.be)\//.test(url)) {
      throw new Error(`Invalid YouTube URL for ${stem}`);
    }
    videoUrls.set(stem, url);
    continue;
  }
  throw new Error(`Unknown argument: ${args[i]}`);
}

const roleFor = stem => stem.startsWith('customer-') ? 'client'
  : stem.startsWith('notary-') ? 'notaire' : 'partenaire';
const langFor = entry => entry.lang_badge === 'EN' ? 'EN' : 'FR';
const destinationFor = (role, source, medium, content) => {
  const url = new URL(base);
  url.searchParams.set('utm_source', source);
  url.searchParams.set('utm_medium', medium);
  url.searchParams.set('utm_campaign', campaign);
  url.searchParams.set('utm_content', content);
  if (role === 'notaire') url.hash = 't=notaires';
  if (role === 'partenaire') url.hash = 't=partenaires';
  return url.toString();
};

const copyFor = (role, lang) => {
  const copy = {
    client: {
      FR: 'Voici comment publier gratuitement une demande de financement ou de refinancement hypothécaire sur Nota : vous proposez votre date et votre offre, puis un notaire de Québec peut retenir la demande.',
      EN: 'Here is how to post a free mortgage financing or refinancing request on Nota: propose your date and offer, then a Quebec City notary can take on the request.',
    },
    notaire: {
      FR: 'Notaires de Québec : voici l’espace Nota en action. Consultez les demandes actives, vérifiez le contexte et choisissez les dossiers qui correspondent à votre pratique.',
      EN: 'Québec City notaries: here is Nota’s workspace in action. Browse active requests, review the context and choose files that fit your practice.',
    },
    partenaire: {
      FR: 'Vous accompagnez des clients au Québec? Découvrez comment le programme partenaires de Nota crée un lien simple vers une demande de financement ou de refinancement.',
      EN: 'Do you work with clients in Québec? See how Nota’s partner program creates a simple link to a mortgage financing or refinancing request.',
    },
  };
  return copy[role][lang];
};

for (const entry of manifest) {
  for (const key of ['video', 'captions', 'thumbnail']) {
    if (!existsSync(entry[key])) throw new Error(`Missing staged asset: ${entry[key]}`);
  }
}

const lines = [
  '# Nota — launch handoff',
  '',
  '> Generated from `output/youtube-nota-v2/youtube-manifest.json`. This file is a handoff: it does not publish or send anything.',
  '',
  '## YouTube sequence',
  '',
  '| Order | Audience | Language | Title | Public video |',
  '| ---: | --- | :---: | --- | --- |',
];

const ordered = [...manifest].sort((a, b) => {
  const order = { customer: 0, notary: 1, partner: 2 };
  return order[roleFor(a.stem)] - order[roleFor(b.stem)] || a.stem.localeCompare(b.stem);
});
for (const entry of ordered) {
  const role = roleFor(entry.stem);
  lines.push(`|  | ${role} | ${langFor(entry)} | ${entry.title} | ${videoUrls.get(entry.stem) || 'À ajouter après publication'} |`);
}

lines.push('', '## Ready-to-post copy and links', '');
for (const entry of ordered) {
  const role = roleFor(entry.stem);
  const lang = langFor(entry);
  const source = 'youtube';
  const medium = 'organic-video';
  const content = entry.stem.replace(/-CA$/, '').replace(/-/g, '_');
  lines.push(`### ${entry.title}`, '', copyFor(role, lang), '');
  lines.push(`CTA: ${destinationFor(role, source, medium, content)}`, '');
  lines.push(`YouTube: ${videoUrls.get(entry.stem) || 'À compléter après publication'}`, '');
}

lines.push('## Paired language links', '', 'Use these two explicit links when a platform cannot route viewers by language reliably.', '');
for (const role of ['client', 'notaire', 'partenaire']) {
  const pair = ordered.filter(entry => roleFor(entry.stem) === role);
  const fr = pair.find(entry => langFor(entry) === 'FR');
  const en = pair.find(entry => langFor(entry) === 'EN');
  lines.push(
    `### ${role}`,
    '',
    `- FR: ${fr ? (videoUrls.get(fr.stem) || 'À compléter après publication') : 'Version à ajouter'}`,
    `- EN: ${en ? (videoUrls.get(en.stem) || 'À compléter après publication') : 'Version à ajouter'}`,
    '',
  );
}

lines.push(
  '## Cross-post destinations',
  '',
  'Use the same approved copy and the same short clip; change only the destination URL and keep the captions.',
  '',
  '| Source | Medium | Example destination |',
  '| --- | --- | --- |',
);
for (const source of ['linkedin', 'facebook', 'instagram', 'tiktok']) {
  lines.push(`| ${source} | organic-social | ${destinationFor('client', source, 'organic-social', 'launch_client_fr')} |`);
}

lines.push(
  '',
  '## Final gate',
  '',
  '- Confirm the animations, captions, thumbnail and exact destination for each video.',
  '- Keep the existing videos until the owner explicitly approves the replacement.',
  '- Publish only after that approval; then add the public YouTube URLs with `--video` and regenerate this handoff.',
  '- Request indexing for the deployed site; never submit private or draft YouTube URLs.',
  '',
);

const output = `${lines.join('\n')}\n`;
if (outputPath) {
  writeFileSync(resolve(outputPath), output, 'utf8');
  console.log(`Wrote ${resolve(outputPath)}`);
} else {
  process.stdout.write(output);
}
