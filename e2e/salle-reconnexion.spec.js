'use strict';

/**
 * salle-reconnexion.spec — CE QUI ARRIVE QUAND QUELQU'UN FERME SA PAGE.
 *
 * Une séance de signature ne se déroule pas dans des conditions de laboratoire.
 * Un client ferme l'onglet par réflexe, son portable s'endort, son réseau
 * change de main. La seule question qui compte est : peut-il revenir ?
 *
 * Le 2026-09-12, non. Le notaire voyait bien « Séance suspendue » au bout d'une
 * demi-minute — l'observation du silence marchait —, mais le client qui
 * rouvrait la salle n'y rentrait plus JAMAIS : la page du notaire avait posé
 * son offre une fois pour toutes (`S.offreFaite`, un verrou à sens unique) et
 * ne la referait pour rien au monde. Personne n'offrait, personne ne répondait,
 * la porte de présence restait fermée et « Reprendre la séance » était refusé
 * jusqu'à la fin des temps. L'acte était perdu pour un onglet fermé.
 *
 * Ce test refait exactement ce parcours, dans deux vrais navigateurs, avec une
 * vraie négociation WebRTC : le client se connecte, ferme sa page, rouvre la
 * salle — et le lien doit revenir de lui-même, puis la séance reprendre par le
 * bouton du notaire.
 *
 * Il tient aussi la phrase que le notaire lit pendant ce temps : quand c'est le
 * CLIENT qui est parti, on ne dit pas au notaire que sa propre caméra a lâché.
 */
const { test, expect } = require('@playwright/test');
const { gotoHome } = require('./helpers');

const API_BASE = `http://localhost:${Number(process.env.E2E_API_PORT || 8811)}`;
const NOTAIRE = 'salle.reconnexion.notaire@etude.demo';
const CLIENT = 'salle.reconnexion.client@exemple.demo';

// Les mêmes drapeaux que salle-signature.spec : une caméra et un micro
// factices, et des candidats ICE lisibles — sans `WebRtcHideLocalIpsWithMdns`
// désactivé, deux pairs sur la même machine ne se trouvent jamais.
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
// profil complet (ADR 0033), rétention.
async function acteRetenu(request) {
  const publication = await request.post(`${API_BASE}/bids`, {
    data: {
      serviceId: 'refinancement', dateISO: dansXJours(23), montant: 2400,
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
    data: { nom: 'Me Claire Dubé', etude: 'Étude Claire Dubé', telephone: '418 555 0142', adresse: '2, rue du Test, Québec (QC) G1R 1A1' },
  });
  expect(profil.status(), await profil.text()).toBe(200);

  const retenue = await request.post(`${API_BASE}/notary/bids/accept`, {
    headers: { authorization: `Bearer ${jetonNotaire}` },
    data: { id: bid.id, dateISO: bid.dateISO },
  });
  expect(retenue.status(), await retenue.text()).toBe(200);

  return { bid, clientToken, jetonNotaire };
}

// La salle telle qu'elle est servie : le vrai `salle.js`, la vraie
// RTCPeerConnection, la vraie caméra (factice).
async function ouvrirSalle(context, { bid, partie, jeton }) {
  const page = await context.newPage();
  await gotoHome(page, { suppressOnboarding: true });
  await page.evaluate(
    ([id, dateISO, role, token]) => window.NotaSalle.ouvrir({ id, dateISO, partie: role, token, mode: 'strict', demonstration: true }),
    [bid.id, bid.dateISO, partie, jeton],
  );
  return page;
}

const connectee = (page) => page.evaluate(() => {
  const s = window.NotaSalle.etat();
  return !!s && s.connexion === 'connected';
});

// Ce que Chromium a réellement mesuré : des octets de média reçus, ou rien.
const octetsRecus = (page) => page.evaluate(async () => {
  const s = window.NotaSalle.etat();
  if (!s || !s.pc) return 0;
  let recus = 0;
  (await s.pc.getStats()).forEach((v) => { if (v.type === 'inbound-rtp' && typeof v.bytesReceived === 'number') recus += v.bytesReceived; });
  return recus;
});

const vueSalle = (page) => page.evaluate(() => {
  const s = window.NotaSalle.etat();
  return (s && s.salle) || null;
});

test('un client qui ferme sa page et rouvre la salle y revient, et la séance reprend', async ({ browser, request }) => {
  // Deux navigateurs, une négociation ICE réelle, une demi-minute de silence à
  // laisser passer pour que le serveur le remarque, puis une seconde
  // négociation. Rien de tout cela ne tient dans les 30 s par défaut.
  test.setTimeout(240_000);

  const { bid, clientToken, jetonNotaire } = await acteRetenu(request);

  const cotéNotaire = await browser.newContext({ permissions: ['camera', 'microphone'] });
  const cotéClient = await browser.newContext({ permissions: ['camera', 'microphone'] });

  try {
    const notaire = await ouvrirSalle(cotéNotaire, { bid, partie: 'notaire', jeton: jetonNotaire });
    let client = await ouvrirSalle(cotéClient, { bid, partie: 'client', jeton: clientToken });

    await expect.poll(() => connectee(notaire), { timeout: 60_000, message: 'le notaire doit voir la connexion établie' }).toBe(true);
    await expect.poll(() => connectee(client), { timeout: 60_000, message: 'le client doit voir la connexion établie' }).toBe(true);
    await expect.poll(() => octetsRecus(notaire), { timeout: 60_000, message: 'du média doit couler avant qu’on le coupe' }).toBeGreaterThan(0);

    // LE GESTE. Le client ferme sa page — il ne prévient personne, c'est tout
    // l'intérêt : personne n'envoie « je suis parti ».
    await client.close();

    // Le serveur le remarque au silence, et suspend. C'est la partie qui
    // marchait déjà ; elle est ici parce que la suite n'a de sens qu'après.
    await expect.poll(async () => (await vueSalle(notaire) || {}).statut, {
      timeout: 90_000, message: 'le silence du client doit suspendre la séance',
    }).toBe('suspendue');

    // Et ce que le notaire LIT pendant ce temps. Sa caméra n'a rien fait : la
    // page d'en face s'est fermée. Une porte qui accuse le mauvais appareil
    // envoie le notaire débrancher un matériel qui marche.
    const presence = (await vueSalle(notaire)).portes.presence;
    expect(presence.ouverte).toBe(false);
    expect(presence.message, 'la porte de présence doit nommer ce qui s’est passé').toMatch(/client/i);
    expect(presence.message, 'ce n’est pas la caméra du notaire qui a lâché').not.toMatch(/caméra du notaire|micro du notaire/i);

    // LE RETOUR. Le client rouvre la salle, exactement comme il l'avait
    // ouverte : une page neuve, les mêmes portes.
    client = await ouvrirSalle(cotéClient, { bid, partie: 'client', jeton: clientToken });

    // C'EST ICI QUE TOUT SE JOUE. Sans relance côté notaire, aucune offre ne
    // repart, le client attend une négociation qui n'aura pas lieu, et rien
    // au monde ne rouvre la porte de présence.
    await expect.poll(() => connectee(client), { timeout: 90_000, message: 'le client qui revient doit se reconnecter' }).toBe(true);
    await expect.poll(() => connectee(notaire), { timeout: 90_000, message: 'le notaire doit retrouver le lien avec le client revenu' }).toBe(true);
    await expect.poll(() => octetsRecus(client), { timeout: 60_000, message: 'le média doit couler de nouveau, pas seulement l’état' }).toBeGreaterThan(0);

    // La porte de présence se rouvre d'elle-même — les deux navigateurs
    // déclarent de nouveau des pistes vivantes.
    await expect.poll(async () => ((await vueSalle(notaire) || {}).portes || {}).presence.ouverte, {
      timeout: 30_000, message: 'la présence doit être rétablie pour que la reprise soit possible',
    }).toBe(true);

    // Et la reprise appartient au notaire : par SON bouton, pas par l'API.
    // Les pages du banc d'essai sont en anglais (`?lang=en`), ce qui met au
    // passage la barre de conduite sous le nez du dictionnaire : « Les deux
    // chaînes concordent » y restait en français, seule phrase française d'un
    // écran anglais — et c'est le geste qui ouvre la porte du lien.
    const rail = notaire.locator('#salle-actions');
    await expect(rail.locator('button', { hasText: 'Both strings match' }),
      'la confirmation anti-interception doit être lisible en anglais').toBeVisible();
    await expect(rail).not.toContainText('chaînes concordent');

    const reprendre = rail.locator('button', { hasText: 'Resume the session' });
    await expect(reprendre).toBeVisible();
    await reprendre.click();

    await expect.poll(async () => (await vueSalle(notaire) || {}).statut, {
      timeout: 30_000, message: '« Reprendre la séance » doit être accepté une fois le lien revenu',
    }).toBe('ouverte');
    await expect(notaire.locator('#salle-refus')).toBeHidden();
  } finally {
    await cotéNotaire.close();
    await cotéClient.close();
  }
});
