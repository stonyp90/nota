'use strict';

/**
 * LE PORT DE STOCKAGE — quatre gestes, et rien d'autre (ADR 0032).
 *
 * Les octets d'un document ne traversent JAMAIS l'API. Le navigateur parle
 * directement au stockage, par une autorisation signée à durée courte que
 * l'API émet après avoir vérifié qui demande quoi. Ce n'est pas une
 * optimisation : ce qui ne traverse pas un service ne peut pas fuir par ses
 * journaux, sa mémoire, ses traces d'erreur ni son observabilité.
 *
 * Le port est délibérément l'INTERSECTION de ce que savent faire S3, Google
 * Cloud Storage et Azure Blob — une URL signée en écriture, une en lecture, une
 * expiration, un type et une taille contraints, un effacement, une lecture de
 * métadonnées. Écrire un adaptateur pour un autre fournisseur ne demande donc
 * aucune modification du domaine ni des routes.
 *
 * Une couche d'abstraction plus riche serait un piège : elle exposerait le plus
 * petit dénominateur de chacun sous un nom trompeur. Ici, ce qui n'est pas dans
 * les quatre gestes n'existe pas pour les appelants.
 */

// Le contrat, énoncé une fois. Un adaptateur qui exposerait davantage laisserait
// fuir un fournisseur dans les appelants, et la portabilité mourrait là, en
// silence — d'où le test qui compare les clés exactes.
const STORAGE_PORT = ['presignUpload', 'presignDownload', 'remove', 'head'];

// Bornes de vie d'une autorisation. Une URL signée est un secret porteur :
// quiconque l'a s'en sert. Elle se compte donc en minutes, jamais en heures, et
// elle n'est jamais la frontière d'autorisation — le serveur a déjà décidé.
const EXPIRY_MIN_S = 30;
const EXPIRY_MAX_S = 900; // un quart d'heure

function bornerExpiration(s) {
  const n = Number(s);
  if (!Number.isFinite(n)) return EXPIRY_MIN_S;
  return Math.max(EXPIRY_MIN_S, Math.min(EXPIRY_MAX_S, Math.round(n)));
}

/**
 * Un en-tête de disposition sûr. Deux exigences :
 *   • `attachment` — un document déposé par un inconnu ne doit jamais
 *     s'exécuter dans l'origine de Nota ;
 *   • le nom encodé en RFC 5987 — un accent, un guillemet ou un retour de ligne
 *     dans un nom de fichier ne doit pas pouvoir casser l'en-tête, encore moins
 *     en injecter un second.
 */
function dispositionPieceJointe(nom) {
  const propre = String(nom == null ? 'document' : nom)
    .replace(/[\u0000-\u001f\u007f"\\]/g, '')
    .trim() || 'document';
  return "attachment; filename*=UTF-8''" + encodeURIComponent(propre);
}

/**
 * L'adaptateur en mémoire — les tests et le développement local. Il n'appelle
 * aucun service : le dépôt s'y fait par `__deposer`, que seuls les tests
 * utilisent (le préfixe dit qu'il ne fait pas partie du port).
 */
function createMemoryStorage({ now = () => Date.now(), baseUrl = 'memory://storage' } = {}) {
  const objets = new Map(); // cle -> { corps, contentType, deposeA }

  const port = {
    async presignUpload({ cle, contentType, maxBytes, expiresInSeconds }) {
      return {
        url: baseUrl + '/' + encodeURIComponent(String(cle)) + '?depot=1',
        methode: 'PUT',
        entetes: { 'content-type': String(contentType || 'application/octet-stream') },
        expireA: new Date(now() + bornerExpiration(expiresInSeconds) * 1000).toISOString(),
        maxBytes: Number(maxBytes) || 0,
      };
    },
    async presignDownload({ cle, nom, expiresInSeconds }) {
      return {
        url: baseUrl + '/' + encodeURIComponent(String(cle)) + '?lecture=1',
        methode: 'GET',
        disposition: dispositionPieceJointe(nom),
        expireA: new Date(now() + bornerExpiration(expiresInSeconds) * 1000).toISOString(),
      };
    },
    // L'effacement est idempotent : effacer deux fois, ou effacer ce qui n'a
    // jamais existé, n'est pas une erreur. Un appelant qui rattrape une
    // exception d'effacement finit toujours par ne plus effacer du tout.
    async remove(cle) {
      objets.delete(String(cle));
    },
    async head(cle) {
      const o = objets.get(String(cle));
      return o ? { taille: o.corps.length, contentType: o.contentType, deposeA: o.deposeA } : null;
    },
  };
  // Hors port, réservé aux tests : simule ce que le navigateur aurait déposé.
  Object.defineProperty(port, '__deposer', {
    enumerable: false,
    value: (cle, corps, contentType) => {
      objets.set(String(cle), { corps, contentType, deposeA: new Date(now()).toISOString() });
    },
  });
  return port;
}

/**
 * L'adaptateur S3. Le SDK est requis PARESSEUSEMENT, comme `stripe-port.js` :
 * la suite de tests injecte un client et un signataire, et ne charge jamais
 * `@aws-sdk`.
 */
function createS3Storage({ bucket, region, kmsKeyId, client, signer, commands, endpoint, publicEndpoint, forcePathStyle } = {}) {
  if (!bucket) throw new Error('createS3Storage: bucket is required');

  // Le SDK est requis PARESSEUSEMENT, et il est injectable — même couture que
  // `stripe-port.js`. La suite de tests fournit ses propres constructeurs de
  // commandes et n'installe donc aucun paquet AWS pour vérifier ce que cet
  // adaptateur SIGNE, ce qui est la seule chose intéressante ici.
  let commandes = commands || null;
  const cmds = () => {
    if (!commandes) commandes = require('@aws-sdk/client-s3');
    return commandes;
  };
  // `endpoint` + `forcePathStyle` rendent l'adaptateur utilisable contre tout
  // stockage compatible S3 — MinIO en développement, Cloudflare R2, Backblaze.
  // C'est la preuve concrète de la portabilité que l'ADR 0032 revendique : le
  // même adaptateur, un autre fournisseur, zéro ligne changée ailleurs.
  const faireClient = (ep) => {
    const { S3Client } = cmds();
    return new S3Client({
      region,
      ...(ep ? { endpoint: ep, forcePathStyle: forcePathStyle !== false } : {}),
    });
  };
  // Deux clients, parce qu'il y a deux points de vue.
  //
  // L'API parle au stockage par une adresse INTERNE ; le navigateur, lui, doit
  // atteindre l'URL signée par une adresse PUBLIQUE. Sur AWS les deux sont la
  // même et `publicEndpoint` reste vide — un seul client, comme avant. Derrière
  // un réseau privé, un CDN, ou une pile Docker locale, elles diffèrent : et
  // comme la signature couvre l'hôte, réécrire l'URL après coup la casse
  // (SignatureDoesNotMatch). Il faut donc SIGNER avec l'adresse publique.
  const s3 = client || faireClient(endpoint);
  const s3Public = client || (publicEndpoint ? faireClient(publicEndpoint) : s3);
  const sign = signer || ((cmd, opts) => require('@aws-sdk/s3-request-presigner').getSignedUrl(s3Public, cmd, opts));

  return {
    async presignUpload({ cle, contentType, maxBytes, expiresInSeconds }) {
      const { PutObjectCommand } = cmds();
      const expiresIn = bornerExpiration(expiresInSeconds);
      const cmd = new PutObjectCommand({
        Bucket: bucket,
        Key: String(cle),
        // Le type et la taille sont IMPOSÉS dans l'autorisation : une
        // autorisation émise pour un PDF de 15 Mo ne peut pas servir à déposer
        // autre chose, ni davantage. La contrainte vit dans la signature, pas
        // dans une vérification que le client pourrait sauter.
        ContentType: String(contentType || 'application/octet-stream'),
        ContentLength: Number(maxBytes) || undefined,
        // Le chiffrement au repos est imposé ici, et pas seulement par la
        // politique du seau : sans cela un dépôt non chiffré échouerait CHEZ LE
        // CLIENT, après le téléversement — trop tard, et illisible pour lui.
        // Le chiffrement est imposé DANS l'autorisation quand une clé existe :
        // sans cela un dépôt non chiffré échouerait chez le client, après le
        // téléversement. Sans clé (MinIO local), on ne l'exige pas — le seau de
        // production, lui, le refuse par sa propre politique.
        ...(kmsKeyId ? { ServerSideEncryption: 'aws:kms', SSEKMSKeyId: kmsKeyId } : {}),
      });
      return {
        url: await sign(cmd, { expiresIn }),
        methode: 'PUT',
        entetes: { 'content-type': String(contentType || 'application/octet-stream') },
        expireA: new Date(Date.now() + expiresIn * 1000).toISOString(),
        maxBytes: Number(maxBytes) || 0,
      };
    },

    async presignDownload({ cle, nom, expiresInSeconds }) {
      const { GetObjectCommand } = cmds();
      const expiresIn = bornerExpiration(expiresInSeconds);
      const disposition = dispositionPieceJointe(nom);
      const cmd = new GetObjectCommand({
        Bucket: bucket,
        Key: String(cle),
        ResponseContentDisposition: disposition,
      });
      return {
        url: await sign(cmd, { expiresIn }),
        methode: 'GET',
        disposition,
        expireA: new Date(Date.now() + expiresIn * 1000).toISOString(),
      };
    },

    async remove(cle) {
      const { DeleteObjectCommand } = cmds();
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: String(cle) }));
    },

    async head(cle) {
      const { HeadObjectCommand } = cmds();
      try {
        const out = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: String(cle) }));
        return {
          taille: Number(out.ContentLength) || 0,
          contentType: out.ContentType || null,
          deposeA: out.LastModified ? new Date(out.LastModified).toISOString() : null,
        };
      } catch {
        // Absent, ou illisible : les deux se lisent « pas là » par l'appelant,
        // qui n'a rien de plus intelligent à faire de la distinction.
        return null;
      }
    },
  };
}

module.exports = { STORAGE_PORT, createMemoryStorage, createS3Storage };
