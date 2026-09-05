// Une table DynamoDB en mémoire, juste assez fidèle pour faire tourner le MÊME
// scénario sur les deux adaptateurs.
//
// Pourquoi elle existe : `repo-memory.js` et `repo-dynamo.js` doivent avoir la
// même sémantique observable, et jusqu'ici rien ne l'éprouvait — chaque
// adaptateur avait ses propres tests, écrits séparément, donc une divergence
// passait. Ce double stocke de vrais items, évalue les ConditionExpression et
// pagine, de sorte qu'un test unique puisse être exécuté contre l'un et
// l'autre et exiger la même réponse.
//
// Ce n'est PAS un émulateur : tout ce que le dépôt n'émet pas lève, pour que le
// double ne mente jamais en silence sur une expression qu'il n'a pas comprise.
// Simplification assumée : `LastEvaluatedKey` n'est rendu que s'il reste
// vraiment des items (DynamoDB peut en rendre un sur une page pleine mais
// terminale ; nos lectures bouclent, donc les deux comportements convergent).

function conditionFailed() {
  const err = new Error('The conditional request failed');
  err.name = 'ConditionalCheckFailedException';
  return err;
}

function validationFailed(message) {
  const err = new Error(message);
  err.name = 'ValidationException';
  return err;
}

// DynamoDB « collate and compare strings using the bytes of the underlying UTF-8
// string encoding ». Le double doit trier PAREIL : avec `localeCompare` il
// rangeait « marie_t » avant « marie.tremblay » (là où l'octet 0x5F vient après
// 0x2E), donc il rendait des pages dans un ordre que la production n'aurait
// jamais rendu — et une divergence d'ordre entre les deux adaptateurs pouvait
// passer verte ici. La règle est écrite ICI plutôt qu'importée de `keys.js`
// exprès : le double modélise la PLATEFORME, pas notre schéma, et un oracle qui
// emprunte sa règle au code testé ne prouve plus rien. Un test compare les deux.
const ordreCles = (a, b) => Buffer.compare(Buffer.from(String(a), 'utf8'), Buffer.from(String(b), 'utf8'));

function attrPresent(item, attr) {
  return item != null && Object.prototype.hasOwnProperty.call(item, attr) && item[attr] !== undefined;
}

// DynamoDB ne compare que des valeurs de MÊME type : une chaîne face à un NULL
// (ou à un attribut absent) rend la condition fausse, elle ne lève pas et ne
// coerce rien. Le double doit se tromper de la même façon, sinon une garde
// d'ordre passerait en test et échouerait en production.
function compare(gauche, op, droite) {
  if (typeof gauche !== typeof droite) return false;
  // L'ÉGALITÉ porte sur tout scalaire — un booléen compris. Le double
  // l'interdisait, si bien que la garde `#consumed = :false` du lien magique
  // admin échouait toujours ici : la connexion à la console ne pouvait pas
  // aboutir côté dynamo, alors qu'elle aboutit en production. L'ORDRE, lui,
  // reste réservé aux chaînes et aux nombres, comme le service.
  const ordonnable = typeof gauche === 'string' || typeof gauche === 'number';
  if (!ordonnable && typeof gauche !== 'boolean') return false;
  if (!ordonnable && op !== '=' && op !== '<>') return false;
  switch (op) {
    case '=': return gauche === droite;
    case '<>': return gauche !== droite;
    case '<': return gauche < droite;
    case '<=': return gauche <= droite;
    case '>': return gauche > droite;
    case '>=': return gauche >= droite;
    default: throw new Error('fake-table : opérateur non supporté — ' + op);
  }
}

function evalCondition(expr, item, names = {}, values = {}) {
  if (!expr) return true;
  // Un seul niveau de OR au-dessus des AND — exactement ce que le dépôt écrit.
  return String(expr)
    .split(/\s+OR\s+/)
    .some((ou) =>
      ou
        .split(/\s+AND\s+/)
        .every((clause) => {
          const brut = clause.trim();
          const m = /^\(?\s*attribute_(not_)?exists\(\s*([#\w]+)\s*\)\s*\)?$/.exec(brut);
          if (m) {
            const attr = names[m[2]] || m[2];
            const present = attrPresent(item, attr);
            return m[1] ? !present : present;
          }
          // `attribute_type(chemin, :type)` — comment on reconnaît un attribut
          // NULL, la forme des lignes de consentement héritées. Seuls les types
          // que le dépôt émet sont modélisés : le reste lève, comme le promet
          // l'en-tête de ce fichier.
          const ty = /^\(?\s*attribute_type\(\s*([#\w]+)\s*,\s*(:\w+)\s*\)\s*\)?$/.exec(brut);
          if (ty) {
            const attr = names[ty[1]] || ty[1];
            const attendu = values[ty[2]];
            if (attendu !== 'NULL') throw new Error('fake-table : attribute_type non modélisé — ' + attendu);
            return attrPresent(item, attr) && item[attr] === null;
          }
          const c = /^\(?\s*([#\w]+)\s*(<=|>=|<>|<|>|=)\s*(:\w+)\s*\)?$/.exec(brut);
          if (!c) throw new Error('fake-table : condition non supportée — ' + clause);
          const attr = names[c[1]] || c[1];
          if (!attrPresent(item, attr)) return false;
          return compare(item[attr], c[2], values[c[3]]);
        })
    );
}

function applyUpdate(item, expr, names = {}, values = {}) {
  const brut = String(expr);
  const set = /^\s*SET\s+(.+)$/i.exec(brut);
  if (set) {
    for (const clause of set[1].split(',')) {
      const a = /^\s*([#\w]+)\s*=\s*(:\w+)\s*$/.exec(clause);
      if (!a) throw new Error('fake-table : affectation non supportée — ' + clause);
      item[names[a[1]] || a[1]] = values[a[2]];
    }
    return item;
  }
  // `ADD` — l'incrément ATOMIQUE des compteurs analytiques (applyStatsDeltas).
  // Le dépôt l'émet depuis toujours ; le double, lui, levait, donc aucun
  // scénario de statistiques ne pouvait tourner côté dynamo — exactement le
  // genre de trou que ce fichier existe pour fermer. Sémantique DynamoDB : sur
  // un attribut absent, ADD crée l'attribut à la valeur ajoutée.
  const add = /^\s*ADD\s+(.+)$/i.exec(brut);
  if (add) {
    for (const clause of add[1].split(',')) {
      const a = /^\s*([#\w]+)\s+(:\w+)\s*$/.exec(clause);
      if (!a) throw new Error('fake-table : incrément non supporté — ' + clause);
      const attr = names[a[1]] || a[1];
      const n = values[a[2]];
      if (typeof n !== 'number') throw new Error('fake-table : ADD non numérique — ' + clause);
      const courant = attrPresent(item, attr) ? item[attr] : 0;
      if (typeof courant !== 'number') throw new Error('fake-table : ADD sur un attribut non numérique — ' + attr);
      item[attr] = courant + n;
    }
    return item;
  }
  throw new Error('fake-table : UpdateExpression non supportée — ' + expr);
}

export function createFakeTable({ name = 'nota-main' } = {}) {
  const items = new Map(); // JSON.stringify([PK, SK]) -> item
  const sent = [];
  // Une paire sérialisée, pas une concaténation : un séparateur littéral
  // (l'octet NUL d'hier) fait classer ce fichier BINAIRE par git — invisible
  // en diff, non fusionnable ligne à ligne, illisible au grep.
  const cle = (pk, sk) => JSON.stringify([String(pk), String(sk)]);
  const clone = (it) => JSON.parse(JSON.stringify(it));

  function checkTable(input) {
    if (input.TableName !== name) {
      throw new Error(`fake-table : table inattendue — ${input.TableName} (attendue : ${name})`);
    }
  }

  // Les index secondaires du schéma, par leurs VRAIES clés. Un seul existe
  // (GSI1, l'index creux qui énumère offres ouvertes, notaires et partenaires) ;
  // le double refusait toute `IndexName`, donc aucun scénario ne pouvait
  // éprouver une lecture d'index côté dynamo — `listNotaries`, `listPartners`
  // et `listOpenBids` passaient toutes par là.
  const INDEX = { GSI1: ['GSI1PK', 'GSI1SK'] };

  function query(input) {
    const nomIndex = input.IndexName;
    if (nomIndex && !INDEX[nomIndex]) throw new Error('fake-table : index inconnu — ' + nomIndex);
    const [pkAttr, skAttr] = nomIndex ? INDEX[nomIndex] : ['PK', 'SK'];

    const values = input.ExpressionAttributeValues || {};
    const noms = input.ExpressionAttributeNames || {};
    // Un nom de clé peut arriver ALIASÉ (`#g = :n`) : le dépôt le fait dès que
    // l'attribut frôle un mot réservé. Le double doit résoudre l'alias comme le
    // service, sinon une lecture parfaitement valide « n'est pas supportée ».
    const resoudre = (jeton) => noms[jeton] || jeton;
    const kc = String(input.KeyConditionExpression || '');
    const pkm = /^\s*([#\w]+)\s*=\s*(:\w+)/.exec(kc);
    if (!pkm || resoudre(pkm[1]) !== pkAttr) {
      throw new Error('fake-table : KeyConditionExpression non supportée — ' + kc);
    }
    pkm[1] = pkm[2]; // la suite ne lit que le jeton de valeur
    // Index CREUX : un item sans les deux attributs de clé n'y figure pas.
    let rows = [...items.values()].filter(
      (it) => it[pkAttr] === values[pkm[1]] && (!nomIndex || attrPresent(it, skAttr)),
    );

    const reste = kc.slice(pkm[0].length).replace(/^\s*AND\s*/, '').trim();
    if (reste) {
      let m;
      const mauvaiseCle = (jeton) => {
        if (resoudre(jeton) !== skAttr) throw new Error('fake-table : condition de tri non supportée — ' + reste);
      };
      if ((m = /^begins_with\(\s*([#\w]+)\s*,\s*(:\w+)\s*\)$/.exec(reste))) {
        mauvaiseCle(m[1]);
        const prefixe = String(values[m[2]]);
        rows = rows.filter((it) => String(it[skAttr]).startsWith(prefixe));
      } else if ((m = /^([#\w]+)\s+BETWEEN\s+(:\w+)\s+AND\s+(:\w+)$/.exec(reste))) {
        mauvaiseCle(m[1]);
        // Bornes comparées EN OCTETS, comme le tri : une condition de tri qui
        // n'emploierait pas l'ordre de la table couperait ailleurs qu'elle.
        const [a, b] = [values[m[2]], values[m[3]]];
        rows = rows.filter((it) => ordreCles(it[skAttr], a) >= 0 && ordreCles(it[skAttr], b) <= 0);
      } else if ((m = /^([#\w]+)\s*(>=|<=|>|<)\s*(:\w+)$/.exec(reste))) {
        mauvaiseCle(m[1]);
        const borne = values[m[3]];
        const cmp = { '>=': (n) => n >= 0, '<=': (n) => n <= 0, '>': (n) => n > 0, '<': (n) => n < 0 };
        rows = rows.filter((it) => cmp[m[2]](ordreCles(it[skAttr], borne)));
      } else {
        throw new Error('fake-table : condition de tri non supportée — ' + reste);
      }
    }

    rows.sort((a, b) => ordreCles(a[skAttr], b[skAttr]) || ordreCles(a.PK, b.PK));
    if (input.ScanIndexForward === false) rows.reverse();

    // `ExclusiveStartKey` reprend STRICTEMENT après la clé nommée — DynamoDB
    // n'exige pas qu'elle existe encore. Chercher la ligne (et repartir du
    // début quand elle a disparu) ferait tourner la boucle de l'appelant sans
    // fin sur la même page.
    //
    // La clé de départ doit en revanche DÉSIGNER la partition interrogée : le
    // vrai service lève une ValidationException quand elle ne correspond pas à
    // la KeyCondition. Le double ne regardait que le SK, donc un curseur minté
    // pour « camp-2 » et rejoué contre « camp-1 » rendait tranquillement le
    // milieu d'une autre campagne — toute une classe de mauvais usage du
    // curseur ne pouvait être QUE verte en test.
    if (input.ExclusiveStartKey) {
      const depart = input.ExclusiveStartKey;
      if (String(depart[pkAttr]) !== String(values[pkm[1]]) || depart[skAttr] === undefined) {
        throw validationFailed('The provided starting key is invalid');
      }
      const borne = depart[skAttr];
      const apres = input.ScanIndexForward === false
        ? (it) => ordreCles(it[skAttr], borne) < 0
        : (it) => ordreCles(it[skAttr], borne) > 0;
      rows = rows.filter(apres);
    }

    const limite = Number(input.Limit) || 0;
    const projeter = projection(input);
    if (limite && rows.length > limite) {
      const page = rows.slice(0, limite);
      const dernier = page[page.length - 1];
      // Sur un index, la clé de reprise porte les DEUX paires : celle de la
      // table et celle de l'index, exactement comme le vrai service.
      const suite = { PK: dernier.PK, SK: dernier.SK };
      if (nomIndex) { suite[pkAttr] = dernier[pkAttr]; suite[skAttr] = dernier[skAttr]; }
      return { Items: page.map(projeter), LastEvaluatedKey: suite };
    }
    return { Items: rows.map(projeter) };
  }

  // `ProjectionExpression` : DynamoDB ne rend QUE les attributs demandés. Un
  // double qui rendrait tout laisserait passer un dépôt qui lit un attribut
  // qu'il n'a pas projeté — il marcherait en test, pas en production.
  function projection(input) {
    const expr = input.ProjectionExpression;
    if (!expr) return clone;
    const names = input.ExpressionAttributeNames || {};
    const champs = String(expr)
      .split(',')
      .map((c) => c.trim())
      .map((c) => {
        if (!/^[#\w]+$/.test(c)) throw new Error('fake-table : projection non supportée — ' + c);
        return names[c] || c;
      });
    return (it) => {
      const out = {};
      for (const champ of champs) if (attrPresent(it, champ)) out[champ] = clone(it[champ]);
      return out;
    };
  }

  const doc = {
    async send(cmd) {
      const nom = cmd.constructor.name;
      const input = cmd.input;
      sent.push({ name: nom, input });
      checkTable(input);

      if (nom === 'PutCommand') {
        const k = cle(input.Item.PK, input.Item.SK);
        if (!evalCondition(
          input.ConditionExpression, items.get(k),
          input.ExpressionAttributeNames, input.ExpressionAttributeValues
        )) {
          throw conditionFailed();
        }
        // Le vrai DocumentClient est construit avec removeUndefinedValues.
        const item = {};
        for (const [f, v] of Object.entries(input.Item)) if (v !== undefined) item[f] = v;
        items.set(k, item);
        return {};
      }
      if (nom === 'GetCommand') {
        const it = items.get(cle(input.Key.PK, input.Key.SK));
        return it ? { Item: clone(it) } : {};
      }
      if (nom === 'DeleteCommand') {
        items.delete(cle(input.Key.PK, input.Key.SK));
        return {};
      }
      if (nom === 'QueryCommand') {
        return query(input);
      }
      if (nom === 'UpdateCommand') {
        const k = cle(input.Key.PK, input.Key.SK);
        const existant = items.get(k);
        if (!evalCondition(
          input.ConditionExpression, existant,
          input.ExpressionAttributeNames, input.ExpressionAttributeValues
        )) {
          throw conditionFailed();
        }
        const item = existant ? clone(existant) : { ...input.Key };
        applyUpdate(item, input.UpdateExpression, input.ExpressionAttributeNames, input.ExpressionAttributeValues);
        items.set(k, item);
        return input.ReturnValues ? { Attributes: clone(item) } : {};
      }
      throw new Error('fake-table : commande non supportée — ' + nom);
    },
  };

  // SEMER une ligne telle quelle, sans passer par le dépôt : c'est la seule
  // façon d'éprouver ce que le code NEUF n'écrit plus mais que la production
  // porte encore — par exemple un `at` de type NULL, la forme que l'ancien
  // `putEmailConsent` laissait dans la projection de consentement. Une suite de
  // parité dont tous les scénarios partent d'une table écrite par le nouveau
  // code ne peut pas voir une rétro-compatibilité cassée.
  const semer = (item) => {
    items.set(cle(item.PK, item.SK), clone(item));
    return item;
  };

  return { doc, sent, items, name, semer };
}
