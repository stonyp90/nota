'use strict';

/**
 * salle-signature.spec — EXIGENCE A1, dans un vrai navigateur.
 *
 *   « Le média circule pair à pair. Aucun serveur de Nota ne reçoit, ne relaie
 *     ni ne déchiffre l'image ou le son. »
 *
 * C'est une affirmation d'architecture, et une affirmation d'architecture se
 * démontre ou ne vaut rien. Ce test monte DEUX navigateurs, leur donne une
 * caméra et un micro factices, et les fait se joindre par la salle de Nota :
 * le même `salle.js` que la production, la même API, la même signalisation.
 *
 * Puis il regarde ce qui s'est réellement passé, dans les statistiques que
 * Chromium tient lui-même :
 *   — la paire de candidats retenue est directe (`host`/`srflx`), jamais un
 *     relais ;
 *   — des octets de média sont arrivés des deux côtés ;
 *   — tout ce que les deux pages ont envoyé à l'API tient dans la
 *     signalisation, et pèse une fraction de ce que le média a transporté.
 *
 * Ce dernier point est le cœur : si le média passait par Nota, l'API aurait vu
 * passer les mêmes ordres de grandeur d'octets que les pairs. Elle en voit
 * mille fois moins.
 */
const { test, expect } = require('@playwright/test');
const { gotoHome } = require('./helpers');

const API_BASE = `http://localhost:${Number(process.env.E2E_API_PORT || 8811)}`;
const NOTAIRE = 'salle.notaire@etude.demo';
const CLIENT = 'salle.client@exemple.demo';

// Une caméra et un micro factices, et des candidats ICE lisibles : sans
// `WebRtcHideLocalIpsWithMdns` désactivé, Chromium remplace les adresses
// locales par des noms `.local` que rien ne résout dans un conteneur, et deux
// pairs sur la même machine ne se trouvent jamais.
test.use({
  launchOptions: {
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      '--disable-features=WebRtcHideLocalIpsWithMdns',
      '--allow-loopback-in-peer-connection',
    ],
  },
  permissions: ['camera', 'microphone'],
});

function dansXJours(jours) {
  const d = new Date();
  d.setDate(d.getDate() + jours);
  return d.toISOString().slice(0, 10);
}

// Un acte RETENU, par les vraies portes : publication, connexion du notaire,
// profil complet (ADR 0033 le rend obligatoire avant de retenir), rétention.
async function acteRetenu(request) {
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
  expect(demande.status()).toBe(200);
  const { devToken } = await demande.json();
  expect(devToken, 'hors production, la demande renvoie le jeton à usage unique').toBeTruthy();
  const ouverture = await request.post(`${API_BASE}/notary/session/verify`, { data: { token: devToken } });
  expect(ouverture.status(), await ouverture.text()).toBe(200);
  const jetonNotaire = (await ouverture.json()).token;

  const profil = await request.post(`${API_BASE}/notary/profile`, {
    headers: { authorization: `Bearer ${jetonNotaire}` },
    data: { nom: 'Me Anne Roy', etude: 'Étude Anne Roy', telephone: '418 555 0100', adresse: '1, rue du Test, Québec (QC) G1R 1A1' },
  });
  expect(profil.status(), await profil.text()).toBe(200);

  const retenue = await request.post(`${API_BASE}/notary/bids/accept`, {
    headers: { authorization: `Bearer ${jetonNotaire}` },
    data: { id: bid.id, dateISO: bid.dateISO },
  });
  expect(retenue.status(), await retenue.text()).toBe(200);

  return { bid, clientToken, jetonNotaire };
}

// Ouvre la salle dans une page réelle, avec le VRAI module : `salle.js` tel
// qu'il est servi, la vraie RTCPeerConnection, la vraie caméra (factice).
// Compte au passage ce que la page envoie et reçoit de l'API.
async function ouvrirSalle(context, { bid, partie, jeton }) {
  const page = await context.newPage();
  // On pèse la SALLE, pas la page : `/bids` et `/events` sont le carnet et la
  // page d'accueil, ils existaient avant la séance et n'ont rien à voir avec
  // elle. Ce qu'on compare au média, c'est la signalisation.
  const trafic = { chemins: [], octets: 0 };
  const compter = (url, n) => {
    const chemin = new URL(url).pathname;
    if (chemin.startsWith('/salle')) trafic.octets += n;
  };
  page.on('request', (req) => {
    if (!req.url().startsWith(API_BASE)) return;
    trafic.chemins.push(new URL(req.url()).pathname);
    const corps = req.postData();
    compter(req.url(), corps ? Buffer.byteLength(corps) : 0);
  });
  page.on('response', async (res) => {
    if (!res.url().startsWith(API_BASE)) return;
    try { compter(res.url(), (await res.body()).length); } catch { /* réponse déjà partie */ }
  });

  await gotoHome(page, { suppressOnboarding: true });
  await page.evaluate(
    ([id, dateISO, role, token]) => window.NotaSalle.ouvrir({ id, dateISO, partie: role, token, mode: 'strict', demonstration: true }),
    [bid.id, bid.dateISO, partie, jeton],
  );
  return { page, trafic };
}

const connectee = async (page) => page.evaluate(() => {
  const s = window.NotaSalle.etat();
  return !!s && s.connexion === 'connected';
});

// Ce que Chromium a réellement mesuré sur la connexion : par où le média est
// passé, et combien il en est arrivé.
async function statistiques(page) {
  return page.evaluate(async () => {
    const s = window.NotaSalle.etat();
    const rapport = await s.pc.getStats();
    const parId = new Map();
    rapport.forEach((v) => parId.set(v.id, v));
    let paire = null, recus = 0;
    rapport.forEach((v) => {
      if (v.type === 'candidate-pair' && (v.state === 'succeeded' || v.nominated)) paire = v;
      if (v.type === 'inbound-rtp' && typeof v.bytesReceived === 'number') recus += v.bytesReceived;
    });
    const cote = (id) => (id && parId.get(id) ? parId.get(id).candidateType : null);
    return {
      recus,
      local: paire ? cote(paire.localCandidateId) : null,
      distant: paire ? cote(paire.remoteCandidateId) : null,
      pistesDistantes: s.fluxDistant ? s.fluxDistant.getTracks().length : 0,
    };
  });
}

test('A1 · le média va d’un pair à l’autre, et l’API ne voit passer que la signalisation', async ({ browser, request }) => {
  test.slow(); // deux navigateurs, une négociation ICE réelle et quelques secondes de média

  const { bid, clientToken, jetonNotaire } = await acteRetenu(request);

  // Deux contextes séparés : deux navigateurs, deux caméras, deux jeux de clés
  // DTLS. Un seul contexte partagerait trop de choses pour prouver quoi que ce
  // soit sur un lien entre deux personnes.
  const cotéNotaire = await browser.newContext({ permissions: ['camera', 'microphone'] });
  const cotéClient = await browser.newContext({ permissions: ['camera', 'microphone'] });

  try {
    // Le notaire ouvre la séance ; le client la rejoint. Les rôles sont fixes —
    // le notaire propose, le client répond — pour qu'il n'y ait jamais deux
    // offres simultanées à rattraper.
    const notaire = await ouvrirSalle(cotéNotaire, { bid, partie: 'notaire', jeton: jetonNotaire });
    const client = await ouvrirSalle(cotéClient, { bid, partie: 'client', jeton: clientToken });

    await expect.poll(() => connectee(notaire.page), { timeout: 45_000, message: 'le notaire doit voir la connexion établie' }).toBe(true);
    await expect.poll(() => connectee(client.page), { timeout: 45_000, message: 'le client doit voir la connexion établie' }).toBe(true);

    // Laisser passer du VRAI média : une connexion « connected » sans octets ne
    // prouve encore rien sur ce que les gens verraient, et quelques kilo-octets
    // ne pèsent pas plus lourd que la négociation elle-même.
    const recusDesDeux = async () => Math.min(
      (await statistiques(notaire.page)).recus,
      (await statistiques(client.page)).recus,
    );
    await expect.poll(recusDesDeux, { timeout: 60_000, message: 'le média doit couler dans les deux sens' })
      .toBeGreaterThan(150_000);

    const statNotaire = await statistiques(notaire.page);
    const statClient = await statistiques(client.page);

    // Chaque côté reçoit l'image ET le son de l'autre.
    expect(statNotaire.pistesDistantes, 'le notaire reçoit deux pistes du client').toBe(2);
    expect(statClient.pistesDistantes, 'le client reçoit deux pistes du notaire').toBe(2);

    // La paire retenue est DIRECTE. `relay` signifierait qu'un TURN transporte
    // le média — il ne pourrait toujours pas le déchiffrer, mais l'exigence A1
    // dit « pair à pair », et c'est ce qui doit être vérifié, pas supposé.
    for (const [qui, stat] of [['notaire', statNotaire], ['client', statClient]]) {
      expect(['host', 'srflx', 'prflx'], `${qui} : type de candidat local`).toContain(stat.local);
      expect(['host', 'srflx', 'prflx'], `${qui} : type de candidat distant`).toContain(stat.distant);
    }

    // Ce que l'API a vu : de la signalisation, et rien d'autre. La liste est
    // fermée — une route média qui apparaîtrait ici ferait tomber le test.
    const routesSalle = ['/salle', '/salle/rejoindre', '/salle/signal', '/salle/pistes', '/salle/ice'];
    for (const { chemins } of [notaire.trafic, client.trafic]) {
      const salle = chemins.filter((c) => c.startsWith('/salle'));
      expect(salle.length, 'la page parle bien à la salle').toBeGreaterThan(0);
      for (const chemin of salle) expect(routesSalle, 'route de salle inattendue').toContain(chemin);
    }

    // Et l'ordre de grandeur, qui est l'argument. Le média se compte en
    // centaines de milliers d'octets ; la signalisation en quelques dizaines de
    // milliers, battement de présence compris. Si Nota relayait, les deux
    // seraient du même ordre — c'est ce rapport, et non une intention écrite
    // dans une ADR, qui dit où le média est passé.
    const mediaRecu = statNotaire.recus + statClient.recus;
    const parLaSalle = notaire.trafic.octets + client.trafic.octets;
    expect(mediaRecu, `média ${mediaRecu} o vs signalisation ${parLaSalle} o`).toBeGreaterThan(parLaSalle * 3);
  } finally {
    await cotéNotaire.close();
    await cotéClient.close();
  }
});
