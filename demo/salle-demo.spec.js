'use strict';

/**
 * LA VIDÉO DE DÉMONSTRATION DE LA SALLE DE SIGNATURE — ADR 0047.
 *
 * Ce fichier n'est pas un test : il ne défend aucune exigence et il ne doit
 * jamais bloquer la CI. C'est un RÉALISATEUR. Il joue la cérémonie complète
 * dans deux navigateurs réels — le notaire et la personne — et il en sort :
 *
 *   demo/sortie/notaire.webm    ce que le notaire voit, du début à la fin
 *   demo/sortie/client.webm     ce que la personne voit, en même temps
 *   demo/sortie/chapitres.json  l'horodatage de chaque moment, pour le montage
 *   demo/sortie/salle-demo.webm les deux côte à côte, si ffmpeg est là
 *
 * Rien n'est mis en scène : les deux navigateurs se joignent par la vraie
 * salle, la vraie API, la vraie signalisation, et le lien vidéo est un vrai
 * lien pair à pair. Ce qui se voit à l'écran est ce que le produit fait.
 *
 * Le seul ajout est un FILIGRANE « bêta » incrusté dans la page, permanent :
 * une capture d'écran d'une vidéo circule sans son titre, et une salle de
 * signature notariée ne peut pas se laisser prendre pour un service prêt.
 *
 * Le scénario, la narration et le texte de publication :
 * docs/go-to-market/video-salle-signature.md
 */
const { test, expect } = require('@playwright/test');
const { mkdirSync, writeFileSync, renameSync, rmSync } = require('node:fs');
const { join, dirname } = require('node:path');
const { spawnSync } = require('node:child_process');

const API_BASE = `http://localhost:${Number(process.env.DEMO_API_PORT || 8821)}`;
const SORTIE = join(__dirname, 'sortie');
const NOTAIRE = 'me.anne.roy@etude.demo';
const CLIENT = 'personne@exemple.demo';

// Le filigrane. Incrusté dans la PAGE, donc dans l'enregistrement, donc dans
// toute capture d'écran qu'on en tirera.
const FILIGRANE = `
  (function () {
    function poser() {
      if (document.getElementById('demo-filigrane')) return;
      var s = document.createElement('style');
      // En bas à GAUCHE : la vignette de retour occupe le coin droit et les
      // commandes du notaire la colonne de droite. Un filigrane qui recouvre un
      // bouton se fait recadrer au montage, donc ne protège plus rien.
      s.textContent = '#demo-filigrane{position:fixed;z-index:2147483647;left:16px;bottom:16px;'
        + 'font:600 13px/1.3 system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase;'
        + 'color:#fff;background:rgba(17,17,17,.82);border:1px solid rgba(255,255,255,.35);'
        + 'padding:8px 12px;pointer-events:none}';
      document.head.appendChild(s);
      var d = document.createElement('div');
      d.id = 'demo-filigrane';
      d.textContent = 'Bêta \\u00b7 démonstration \\u00b7 aucun acte réel';
      document.body.appendChild(d);
    }
    if (document.body) poser();
    else document.addEventListener('DOMContentLoaded', poser);
  })();
`;

function dansXJours(jours) {
  const d = new Date();
  d.setDate(d.getDate() + jours);
  return d.toISOString().slice(0, 10);
}

// Le chemin de ffmpeg : celui qu'on nous donne, ou celui du système. PAS celui
// que Playwright installe avec ses navigateurs — c'est une compilation réduite
// à ce dont Playwright a besoin pour enregistrer, sans `hstack` ni VP9, et
// l'appeler ne produirait qu'une erreur déroutante.
function trouverFfmpeg() {
  if (process.env.FFMPEG) return process.env.FFMPEG;
  const surLeChemin = spawnSync('sh', ['-c', 'command -v ffmpeg'], { encoding: 'utf8' });
  if (surLeChemin.status === 0 && surLeChemin.stdout.trim()) return surLeChemin.stdout.trim();
  return null;
}

// Le master 1080p : les deux côtés à parts égales, centrés, sur fond noir.
// Deux fois 1280x720 empilés bruts donneraient du 2560x720, que rien ne lit
// confortablement.
const MONTAGE = '[0:v]scale=960:540[g];[1:v]scale=960:540[d];'
  + 'color=c=black:s=1920x1080:d=1[fond];[fond][g]overlay=0:270:shortest=1[t];[t][d]overlay=960:270';

test('la cérémonie de bout en bout, enregistrée', async ({ browser, request }) => {
  rmSync(SORTIE, { recursive: true, force: true });
  mkdirSync(SORTIE, { recursive: true });

  // --- L'acte, par les vraies portes ---------------------------------------
  const publication = await request.post(`${API_BASE}/bids`, {
    data: {
      serviceId: 'refinancement', dateISO: dansXJours(21), montant: 2400,
      courriel: CLIENT, prefixe: 'G1R',
      pricing: { valeur_pret: 250000, succession: 'non', approbation_bancaire: 'obtenue', preteur: 'banque_nationale', deplacement: 'client_50' },
    },
  });
  expect(publication.status(), await publication.text()).toBe(201);
  const { bid, clientToken } = await publication.json();

  const demande = await request.post(`${API_BASE}/notary/session/request`, { data: { email: NOTAIRE } });
  const { devToken } = await demande.json();
  const ouverture = await request.post(`${API_BASE}/notary/session/verify`, { data: { token: devToken } });
  const jetonNotaire = (await ouverture.json()).token;
  await request.post(`${API_BASE}/notary/profile`, {
    headers: { authorization: `Bearer ${jetonNotaire}` },
    data: { nom: 'Me Anne Roy', etude: 'Roy & Associés, notaires', telephone: '418 555 0100', adresse: '1, rue Saint-Jean, Québec (QC) G1R 1A1' },
  });
  const retenue = await request.post(`${API_BASE}/notary/bids/accept`, {
    headers: { authorization: `Bearer ${jetonNotaire}` },
    data: { id: bid.id, dateISO: bid.dateISO },
  });
  expect(retenue.status(), await retenue.text()).toBe(200);

  // --- Les deux navigateurs -------------------------------------------------
  const contexte = async () => {
    const c = await browser.newContext({
      permissions: ['camera', 'microphone'],
      viewport: { width: 1280, height: 720 },
      recordVideo: { dir: SORTIE, size: { width: 1280, height: 720 } },
    });
    await c.addInitScript(FILIGRANE);
    return c;
  };
  const cN = await contexte();
  const cC = await contexte();

  const debut = Date.now();
  const chapitres = [];
  const chapitre = (titre, dit) => {
    chapitres.push({ a: Math.round((Date.now() - debut) / 1000), titre, dit });
    // eslint-disable-next-line no-console
    console.log(`  ${String(chapitres[chapitres.length - 1].a).padStart(3)}s  ${titre}`);
  };

  const ouvrirPage = async (contexteNav, partie, jeton) => {
    const page = await contexteNav.newPage();
    await page.addInitScript(() => {
      try { localStorage.setItem('nota.introSeen', '1'); localStorage.setItem('nota.onboarded.v1', '1'); } catch (e) {}
    });
    await page.goto('/?lang=fr');
    await page.evaluate(
      ([id, dateISO, role, token]) => window.NotaSalle.ouvrir({ id, dateISO, partie: role, token, mode: 'strict', demonstration: true }),
      [bid.id, bid.dateISO, partie, jeton],
    );
    return page;
  };

  const etat = (page) => page.evaluate(() => {
    const s = window.NotaSalle.etat();
    return s && s.salle ? { connexion: s.connexion, statut: s.salle.statut, etape: s.salle.etape, sas: s.salle.sas, fermees: s.salle.fermees, scelle: s.salle.scelle } : null;
  });

  // Le notaire clique ce qu'un notaire clique : un bouton de la salle, par son
  // libellé. Rien n'est poussé par-dessous l'interface.
  const cliquer = async (page, motif) => {
    const b = page.locator('#salle-actions button').filter({ hasText: motif }).first();
    await expect(b, `bouton « ${motif} »`).toBeVisible({ timeout: 20_000 });
    await b.click();
    await page.waitForTimeout(1200);
  };

  let notaire; let client;
  try {
    chapitre('Ouverture de la séance', 'Le notaire ouvre la salle. La personne la rejoint.');
    notaire = await ouvrirPage(cN, 'notaire', jetonNotaire);
    client = await ouvrirPage(cC, 'client', clientToken);

    await expect.poll(async () => (await etat(notaire))?.connexion, { timeout: 60_000 }).toBe('connected');
    await expect.poll(async () => (await etat(client))?.connexion, { timeout: 60_000 }).toBe('connected');
    chapitre('Le lien est établi', 'Deux vidéos, pair à pair. Aucun serveur de Nota n’est sur le chemin du média.');
    await notaire.waitForTimeout(4000);

    const { sas } = await etat(notaire);
    chapitre('La chaîne d’authentification : ' + sas, 'Les deux écrans affichent la même chaîne. On la lit à voix haute.');
    await notaire.waitForTimeout(4000);

    chapitre('Vérification de l’identité', 'Elle se fait hors du canal vidéo. L’attestation porte sa méthode et son heure.');
    await cliquer(notaire, 'Attester');
    await cliquer(notaire, 'Attester');

    chapitre('Confirmation du lien privé', 'Le notaire confirme que les deux chaînes concordent. La porte du lien s’ouvre.');
    await cliquer(notaire, 'Les deux chaînes concordent');

    chapitre('Portée et consentement', 'La question est posée à chacun séparément, et la réponse est horodatée.');
    await cliquer(notaire, 'J’accepte');
    await cliquer(client, 'J’accepte');
    await cliquer(notaire, 'Passer à');   // identité
    await cliquer(notaire, 'Passer à');   // lien
    await cliquer(notaire, 'Passer à');   // consentement

    chapitre('Lecture de l’acte', 'Le texte que le notaire a à dire vient du domaine, pas d’une maquette.');
    await cliquer(notaire, 'Passer à');   // lecture
    await notaire.waitForTimeout(4000);

    // Le moment qui vaut la démonstration : on débranche la personne.
    chapitre('La personne perd son réseau', 'Le notaire doit voir et entendre PENDANT toute la séance. Une coupure n’est pas un incident à ravaler.');
    await cC.setOffline(true);
    await expect.poll(async () => (await etat(notaire))?.statut, { timeout: 90_000 }).toBe('suspendue');
    chapitre('La séance se suspend d’elle-même', 'Personne n’a cliqué. Le serveur a constaté le silence, et la signature est redevenue impossible.');
    await notaire.waitForTimeout(3000);

    await cC.setOffline(false);
    await expect.poll(async () => (await etat(notaire))?.fermees?.includes('presence'), { timeout: 90_000 }).toBe(false);
    chapitre('Le lien revient — et la séance ne repart pas toute seule', 'La reprise est un geste du notaire. Elle repart de l’étape en cours, jamais plus loin.');
    await cliquer(notaire, 'Reprendre la séance');

    chapitre('Questions', 'Le notaire répond avant que quoi que ce soit soit signé.');
    await cliquer(notaire, 'Passer à');   // questions

    chapitre('Libération de la signature', 'Les quatre portes sont ouvertes. Nota libère vers le flux admis ; l’acte prend sa forme définitive là, pas ici.');
    await cliquer(notaire, 'Libérer la signature');
    await notaire.waitForTimeout(3000);

    chapitre('Clôture et sceau', 'Le procès-verbal se ferme sur une empreinte. Retirer une ligne la change : la preuve tient sans qu’on ait à croire Nota sur parole.');
    await cliquer(notaire, 'Passer à');   // clôture
    await cliquer(notaire, 'Sceller le procès-verbal');
    await expect.poll(async () => !!(await etat(notaire))?.scelle, { timeout: 30_000 }).toBe(true);
    await notaire.waitForTimeout(6000);

    const final = await etat(notaire);
    chapitre('Fin', 'Empreinte du procès-verbal : ' + (final.scelle ? final.scelle.empreinte : '—'));
  } finally {
    const fichiers = [];
    for (const [nom, page] of [['notaire', notaire], ['client', client]]) {
      if (!page) continue;
      const video = page.video();
      await page.context().close();
      if (!video) continue;
      const source = await video.path();
      const cible = join(SORTIE, nom + '.webm');
      mkdirSync(dirname(cible), { recursive: true });
      renameSync(source, cible);
      fichiers.push(cible);
    }
    writeFileSync(join(SORTIE, 'chapitres.json'), JSON.stringify({ chapitres }, null, 2) + '\n');

    // Les deux côtés côte à côte, quand ffmpeg est disponible. Sinon, la
    // commande exacte, pour que la promesse ne dépende pas de l'outillage.
    const commande = ['-y', '-i', join(SORTIE, 'notaire.webm'), '-i', join(SORTIE, 'client.webm'),
      '-filter_complex', MONTAGE, '-c:v', 'libvpx-vp9', '-b:v', '2M', join(SORTIE, 'salle-demo.webm')];
    const ffmpeg = fichiers.length === 2 ? trouverFfmpeg() : null;
    if (ffmpeg) {
      const r = spawnSync(ffmpeg, commande, { encoding: 'utf8' });
      // eslint-disable-next-line no-console
      console.log(r.status === 0 ? '\n  Montage : ' + join(SORTIE, 'salle-demo.webm') : '\n  ffmpeg a refusé le montage :\n' + (r.stderr || '').slice(-800));
    } else {
      // eslint-disable-next-line no-console
      console.log('\n  Deux fichiers sont prêts : ' + join(SORTIE, 'notaire.webm') + ' et ' + join(SORTIE, 'client.webm')
        + '\n  ffmpeg n\u2019est pas installé. Pour les assembler en un master 1080p :\n  ffmpeg '
        + commande.map((a) => (/[\s[\]]/.test(a) ? JSON.stringify(a) : a)).join(' '));
    }
    // eslint-disable-next-line no-console
    console.log('  Chapitres : ' + join(SORTIE, 'chapitres.json') + '\n');
  }
});
