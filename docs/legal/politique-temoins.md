# Politique relative aux témoins et au stockage local

> **BROUILLON NON RÉVISÉ.** Rédigé à partir du code, non par un juriste. Voir
> [`README.md`](README.md).

**Version : 0.1 (brouillon) · Date d'entrée en vigueur : à déterminer**

---

## 1. Nota n'utilise aucun témoin

**Le site de Nota ne dépose aucun témoin (« cookie ») sur votre appareil.**

Vérification : la recherche des chaînes `cookie` et `témoin` dans
`apps/web/public/index.html`, `app.js`, `i18n.js`, `styles.css` et `sw.js` ne
retourne **aucun résultat**. Il n'existe ni témoin de session, ni témoin
publicitaire, ni témoin de mesure d'audience.

Nota **n'utilise aucun outil d'analyse tiers**, aucun pixel de suivi, aucun
réseau publicitaire, et ne pratique **aucun suivi entre sites**.

C'est pourquoi il n'y a **aucune bannière de consentement** : il n'y a rien à
consentir.

---

## 2. Ce que Nota conserve à la place : le stockage local de votre navigateur

Nota utilise le **stockage local** (`localStorage`) de votre navigateur. À la
différence d'un témoin, ces données **ne sont jamais envoyées automatiquement à
un serveur** : elles restent sur votre appareil et servent uniquement à ce que
l'application se souvienne de votre travail entre deux visites.

### Ce qui est stocké

| Clé | À quoi elle sert | Nature |
| --- | --- | --- |
| `nota.lang` | la langue choisie (FR / EN) | préférence |
| `nota.bids.v1`, `nota.bids.sig.v1` | copie locale du carnet, pour un affichage instantané | cache |
| `nota.myoffers.v1`, `nota.offerstatus.v1` | vos offres et leur état | fonctionnel |
| `nota.dossier.v1` | **le brouillon de votre dossier**, pour ne pas le ressaisir | **fonctionnel — contient des renseignements personnels** |
| `nota.profile.v1`, `nota.role.v1` | votre profil local et votre rôle (client / notaire) | préférence |
| `nota.notifs.v1` | les avis déjà affichés, pour ne pas les répéter | fonctionnel |
| `nota.onboarded.v1`, `nota.onboarded.dismissed.v1`, `nota.onb.stats.v1` | l'introduction déjà vue | préférence |
| `nota.ref.v1` | **le code du partenaire qui vous a référé**, s'il y en a un | fonctionnel |
| `nota.notary.token`, `nota.notary.feedtoken`, `nota.notary.email`, `nota.notary.retained.v1`, `nota.notary.view.v1`, `nota.notary.prefs.v1` | la session et les préférences de la console notaire | **fonctionnel — contient un jeton d'accès** |
| `nota.support.*` | le fil de la messagerie d'assistance | fonctionnel |

*(Sources : `apps/web/public/app.js:40-41, 289-290, 352, 592, 717, 849-850, 929,
4012, 4452-4458, 5286, 7328`.)*

### Ce que cela implique

- **Toutes ces données sont fonctionnelles.** Aucune n'est publicitaire, aucune
  n'est de mesure d'audience, aucune n'est partagée.
- **Deux entrées méritent votre attention** : le brouillon de dossier
  (`nota.dossier.v1`) peut contenir des renseignements personnels, et le jeton de
  console notaire (`nota.notary.token`) donne accès à cette console. **Sur un
  appareil partagé, videz le stockage du site** ou utilisez une fenêtre privée.
- **Les documents que vous joignez ne sont jamais téléversés** : seul leur nom est
  transmis (`packages/domain/index.js:1821-1830`).

### Comment les effacer

Effacer les « données de site » ou « données de navigation » pour le domaine de
Nota, dans les réglages de votre navigateur, supprime la totalité de ces entrées.
L'application se réinitialise ; rien n'est perdu côté serveur.

---

## 3. Le service worker

Nota installe un **service worker** (`apps/web/public/sw.js`) qui met en cache les
fichiers de l'application pour qu'elle s'ouvre vite et fonctionne hors ligne. Il
ne collecte rien et ne transmet rien.

Le désinstaller : effacer les données de site (ci-dessus).

---

## 4. Chez nos sous-traitants

Lorsque vous êtes redirigé vers **Stripe** pour autoriser un paiement, ou vers
l'inscription **Stripe Connect** en tant que notaire, vous quittez le site de
Nota. **Stripe dépose ses propres témoins**, notamment à des fins de prévention
de la fraude, selon sa propre politique. Nota n'y a pas accès et ne les contrôle
pas.

---

## 5. Ce document doit être publié

> ⚠️ **Manque.** Cette politique **n'existe pas dans l'application**. Le produit
> utilise le stockage local — y compris pour un brouillon de dossier et un jeton
> de session — **sans en informer l'utilisateur nulle part**. Le fait qu'il
> n'y ait pas de témoin est une bonne nouvelle qu'il faut dire, pas une raison de
> ne rien dire.
