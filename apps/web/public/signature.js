/* Nota signing beta. No third-party scripts; no media recording; no legal signature.
   State and authorization are server-owned. Only two browsers terminate media. */
(function () {
  'use strict';
  var D = window.NotaSigning;
  var $ = function (id) { return document.getElementById(id); };
  var params = new URLSearchParams(location.search);
  var role = params.get('role') === 'notary' ? 'notary' : 'client';
  var bidId = params.get('bidId') || params.get('id') || '';
  var dateISO = params.get('dateISO') || '';
  var base = window.__NOTA_API__ || ((location.hostname === 'localhost' || location.hostname === '127.0.0.1') ? 'http://localhost:8788' : '/api');
  var apiPath = base + '/signing-beta';
  var session = null, capabilities = null, iceServers = [], token = '', keyPair = null, publicKey = null;
  var localStream = null, remoteStream = null, testStream = null, pc = null;
  var entered = false, documentValid = false, pollBusy = false, operationBusy = false, signaling = false;
  var lastSignalSequence = 0, offerSent = false, peerCodeGeneration = 0, fingerprintVerified = false;
  var identityVerified = false, joinedSession = '', heartbeatTimer = null, pollTimer = null, noticeTimer = null;
  var lang = readText('nota.lang') === 'en' ? 'en' : 'fr';
  if (params.get('lang') === 'en' || params.get('lang') === 'fr') lang = params.get('lang');
  var EN = {
    'Aller au contenu':'Skip to content','Salle de signature':'Signing room','BÊTA':'BETA','Thème clair':'Light theme','Thème sombre':'Dark theme','Mon espace Nota':'My Nota space',
    'L’expérience notariale, réunie.':'The notarial experience, together.', 'Votre notaire. Votre document. Un même espace.':'Your notary. Your document. One shared space.',
    'Un rendez-vous vidéo privé, une lecture accompagnée et chaque étape sous le contrôle de votre notaire. Directement dans Nota.':'A private video appointment, a guided reading, and every step under your notary’s control. Right here in Nota.',
    'Ouvrir mon espace Nota':'Open my Nota space','Tester ma caméra':'Test my camera','La salle s’ouvre depuis un dossier retenu, après votre connexion.':'Open the room from a retained file after signing in.',
    'Répétition technique disponible. Signature d’un acte notarié : à venir, après validation du parcours et intégration du fournisseur autorisé.':'Technical rehearsal available. Notarial deed signing is coming after workflow validation and authorized provider integration.',
    'LE RENDEZ-VOUS, RÉINVENTÉ':'THE APPOINTMENT, REIMAGINED','Dans Nota':'Inside Nota','Présence humaine':'Human presence','Connexion chiffrée':'Encrypted connection','Vous entrez en confiance':'Arrive with confidence','Accès lié au dossier. Caméra et micro vérifiés avant d’entrer.':'Access tied to your file. Camera and microphone checked before you enter.','Votre notaire vous accompagne':'Your notary guides you','Admission, vérification en direct, explications et consentement.':'Admission, live checks, explanations and consent.','Chaque étape laisse une trace':'Every step leaves a record','Document d’essai figé, signatures de test et reçu vérifiable.':'A fixed test document, test signatures and a verifiable receipt.',
    'Entre vous deux':'Between the two of you','Audio et vidéo chiffrés entre les navigateurs avec WebRTC. Aucun enregistrement de la séance par Nota.':'Audio and video encrypted between browsers with WebRTC. Nota does not record the session.','Le droit de faire pause':'The right to pause','Une question, une interruption ou un doute? La signature de test s’arrête. Votre notaire décide de la reprise.':'A question, an interruption or a concern? Test signing stops. Your notary decides when to resume.','Des limites explicites':'Clear boundaries','La bêta sert aux essais. Elle ne produit pas d’acte authentique et ne représente pas une approbation de la Chambre des notaires.':'This beta is for testing. It does not produce an authentic deed or represent approval by the Chambre des notaires.',
    'VOTRE RENDEZ-VOUS NOTA':'YOUR NOTA APPOINTMENT','Un moment important. Toute votre attention.':'An important moment. Your full attention.','Copier l’invitation':'Copy invitation','Plein écran':'Full screen','Quitter le plein écran':'Exit full screen','BÊTA · ESSAI':'BETA · REHEARSAL','Cette séance est une répétition. Document fictif uniquement. La signature notariale officielle est à venir.':'This session is a rehearsal. Fictional document only. Official notarial signing is coming soon.','Aucun enregistrement':'No recording','Préparation':'Preparation','Vérification':'Verification','Lecture ensemble':'Read together','Signature de test':'Test signing','Reçu':'Receipt',
    'Votre rendez-vous commence ici.':'Your appointment starts here.','Vérifiez votre caméra et votre micro, puis rejoignez la salle.':'Check your camera and microphone, then join the room.','Hors connexion':'Offline','Votre caméra':'Your camera','Vous':'You','Micro':'Microphone','Caméra':'Camera','Pause':'Pause','Quitter':'Leave','Prenez un instant pour vous installer.':'Take a moment to get comfortable.','Choisissez un endroit calme et privé. Aucune pièce d’identité réelle n’est nécessaire pour cet essai.':'Choose a quiet, private location. No real identity document is needed for this rehearsal.',
    'Avant d’entrer':'Before you enter','Sur votre appareil':'On your device','Navigateur compatible et connexion HTTPS':'Compatible browser and HTTPS connection','Caméra et microphone autorisés':'Camera and microphone allowed','Accès au dossier confirmé par le serveur':'File access confirmed by the server','Je comprends qu’il s’agit d’un essai technique sans valeur d’acte notarié. Je n’utiliserai aucun document ni renseignement d’identité réel.':'I understand that this is a technical rehearsal with no notarial deed status. I will not use real documents or identity information.','Vérifier caméra et micro':'Check camera and microphone','Rejoindre la salle':'Join the room','Aucune capture audio ou vidéo par Nota. Les participants peuvent toujours enregistrer avec leur appareil.':'Nota does not capture audio or video. Participants can still record using their own device.',
    'LE MÊME DOCUMENT, POUR VOUS DEUX':'THE SAME DOCUMENT, FOR BOTH OF YOU','Lecture accompagnée':'Guided reading','Document':'Document','Journal de séance':'Session log','DOCUMENT D’ESSAI':'TEST DOCUMENT','Répétition de signature':'Signing rehearsal','Sans effet juridique · Aucun acte authentique':'No legal effect · No authentic deed','Le document d’essai sera chargé depuis votre séance authentifiée.':'The test document will load from your authenticated session.','Version figée pour cette séance':'Fixed version for this session','Empreinte SHA-256 du document':'Document SHA-256 fingerprint','Vérification locale en attente':'Local verification pending','Ce journal relate les événements techniques. Il n’enregistre ni votre voix ni la vidéo et ne remplace pas les preuves d’un fournisseur de signature autorisé.':'This log records technical events. It records neither voice nor video and does not replace evidence from an authorized signature provider.',
    'Vérifier la connexion':'Verify the connection','À comparer à voix haute':'Compare out loud','Comparez ces empreintes avec votre interlocuteur par un canal de confiance distinct. Un changement de connexion exige une nouvelle vérification.':'Compare these fingerprints with your counterpart over a separate trusted channel. A new connection requires a new verification.','Les empreintes correspondent sur nos deux appareils.':'The fingerprints match on both our devices.','Votre notaire donne le rythme':'Your notary leads the way','L’entrée, la lecture et la signature de test sont autorisées par votre notaire, une étape à la fois.':'Your notary authorizes entry, reading and test signing, one step at a time.','J’ai effectué les vérifications prévues pour cet essai avec mon interlocuteur. Cette étape n’atteste pas son identité civile.':'I have performed the checks planned for this rehearsal with my counterpart. This step does not attest their civil identity.','Admettre le client':'Admit customer','Confirmer la vérification':'Confirm checks','Commencer la lecture':'Start reading','Autoriser la signature de test':'Authorize test signing',
    'J’ai lu le document d’essai et je consens à y apposer ma signature cryptographique de test, sans valeur d’acte notarié.':'I have read the test document and consent to applying my cryptographic test signature, without notarial deed status.','Signer le document d’essai':'Sign the test document','Télécharger le reçu de l’essai':'Download rehearsal receipt','Signature notariale officielle':'Official notarial signature','À venir · Fournisseur autorisé et parcours à valider':'Coming soon · Authorized provider and workflow validation pending','Votre aperçu privé':'Your private preview','Fermer':'Close','Cet aperçu reste sur votre appareil. Fermer cette fenêtre coupe la caméra et le microphone.':'This preview stays on your device. Closing this window stops your camera and microphone.','Pensé pour la confiance. Construit avec transparence.':'Designed for trust. Built with transparency.','Retour au carnet':'Back to the marketplace',
    'Notaire':'Notary','Client':'Customer','Dossier':'File','Connexion requise':'Sign-in required','Reconnectez-vous à Nota avec votre lien reçu par courriel pour accéder à cette répétition.':'Sign in to Nota again with the link sent to your email to access this rehearsal.','Accès refusé à ce dossier.':'Access to this file was denied.','La salle est momentanément indisponible. Réessayez dans un instant.':'The room is temporarily unavailable. Try again in a moment.','Votre navigateur doit autoriser la caméra et le microphone pour cette répétition.':'Your browser must allow the camera and microphone for this rehearsal.','Cette fonction exige HTTPS, WebRTC et WebCrypto dans un navigateur compatible.':'This feature requires HTTPS, WebRTC and WebCrypto in a compatible browser.','Aucune séance n’est ouverte. Votre notaire doit d’abord créer la salle.':'No session is open. Your notary must create the room first.','Créer la répétition':'Create rehearsal','Nouvelle répétition':'New rehearsal','En attente du client':'Waiting for the customer','Votre client se connecte à son espace Nota et ouvre ce dossier. Vous déciderez de son admission.':'Your customer signs in to Nota and opens this file. You decide when to admit them.','Votre notaire vous accueille bientôt.':'Your notary will welcome you shortly.','Votre caméra est prête. Votre notaire doit vous admettre pour établir la connexion vidéo.':'Your camera is ready. Your notary must admit you before the video connection starts.','Connexion en cours':'Connecting','La connexion vidéo se prépare.':'The video connection is being established.','Gardez cette page ouverte pendant la connexion avec votre interlocuteur.':'Keep this page open while connecting with your counterpart.','Vidéo chiffrée · WebRTC':'Encrypted video · WebRTC','Connexion à vérifier':'Connection to verify','Vidéo connectée. Comparez les empreintes.':'Video connected. Compare the fingerprints.','Comparez le code avec votre interlocuteur avant de poursuivre. La vidéo et le son doivent rester actifs.':'Compare the code with your counterpart before continuing. Video and audio must remain active.','Connexion vérifiée pour cet essai.':'Connection verified for this rehearsal.','Le notaire accompagne les vérifications et la lecture. Vous pouvez demander une pause à tout moment.':'The notary guides the checks and reading. You can request a pause at any time.','La lecture se fait ensemble.':'Read through the document together.','Posez vos questions. Votre notaire autorisera la signature de test seulement après la lecture.':'Ask your questions. Your notary will authorize test signing only after the reading.','Le document d’essai est prêt à signer.':'The test document is ready to sign.','Le client signe d’abord, puis le notaire. Chaque confirmation porte sur cette version exacte du document.':'The customer signs first, then the notary. Each confirmation covers this exact version of the document.','La répétition est terminée.':'The rehearsal is complete.','Les deux signatures de test ont été vérifiées par le serveur. Téléchargez le reçu pour conserver le document, les preuves et le journal technique.':'The server has verified both test signatures. Download the receipt to keep the document, evidence and technical log.','La séance est en pause.':'The session is paused.','La signature de test est suspendue. Rétablissez caméra, micro et connexion; votre notaire devra autoriser une nouvelle lecture.':'Test signing is suspended. Restore camera, microphone and connection; your notary must authorize a new reading.','La séance est fermée.':'The session is closed.','Votre caméra et votre microphone sont coupés. Une nouvelle répétition exige une nouvelle salle.':'Your camera and microphone are off. A new rehearsal requires a new room.','Répétition expirée.':'Rehearsal expired.','Le notaire doit créer une nouvelle répétition.':'The notary must create a new rehearsal.','Document vérifié sur cet appareil':'Document verified on this device','Le document reçu ne correspond pas au document d’essai attendu. La signature est bloquée.':'The received document does not match the expected test document. Signing is blocked.','Invitation copiée. Votre interlocuteur devra se connecter à son propre espace Nota.':'Invitation copied. Your counterpart must sign in to their own Nota space.','Votre navigateur ne permet pas la copie automatique.':'Your browser does not allow automatic copying.','Le mode plein écran n’est pas disponible dans ce navigateur.':'Full screen is unavailable in this browser.','Vérification confirmée pour cet essai.':'Checks confirmed for this rehearsal.','Signature de test vérifiée':'Test signature verified','La séance a changé. Vérifiez son état, puis réessayez.':'The session has changed. Check its status and try again.','La présence vidéo des deux participants est requise.':'Both participants must be present on video.','La connexion a été interrompue. La signature de test est suspendue.':'The connection was interrupted. Test signing is suspended.','La clé de cette séance n’est plus sur cet appareil. Le notaire doit créer une nouvelle répétition.':'This session’s key is no longer on this device. The notary must create a new rehearsal.','Le défi de signature ne correspond pas à cette séance.':'The signing challenge does not match this session.','Aucun événement pour le moment.':'No events yet.','Séance créée':'Session created','Client arrivé':'Customer joined','Client admis':'Customer admitted','Lecture confirmée':'Reading confirmed','Signature de test autorisée':'Test signing authorized','Séance suspendue':'Session paused','Confirmation cryptographique':'Cryptographic confirmation','Séance fermée':'Session closed','Connexion média mise à jour':'Media connection updated','Échange de connexion':'Connection exchange','Événement technique':'Technical event','Connexion requise pour ce dossier':'Sign in to access this file','Une nouvelle connexion par courriel est nécessaire.':'A new email sign-in is required.','Reprendre la lecture':'Resume reading','Les contrôles sont effectués par le notaire pendant cette répétition. Ils ne constituent pas une preuve d’identité civile.':'The notary performs the checks during this rehearsal. They do not constitute proof of civil identity.','Le relais réseau n’est pas configuré; certains réseaux peuvent empêcher la connexion.':'A network relay is not configured; some networks may prevent the connection.','La séance a été fermée sur un autre appareil.':'The session was closed on another device.','Le serveur ne répond plus. La signature de test est suspendue.':'The server is not responding. Test signing is suspended.',
    'Rétablir la vidéo':'Reconnect video','Étapes du rendez-vous':'Appointment steps','Vidéoconférence':'Video conference','Exercice de signature — document sans effet juridique':'Signing exercise — document with no legal effect','Le document signé reste en français pour préserver exactement les mêmes octets sur les deux appareils.':'The signed document remains in French to preserve exactly the same bytes on both devices.'
  };
  function readText(key) { try { var raw = localStorage.getItem(key); try { var value = JSON.parse(raw); return typeof value === 'string' ? value : raw; } catch (_) { return raw; } } catch (_) { return null; } }
  function T(fr) { return lang === 'en' ? (EN[fr] || fr) : fr; }
  function label(id, fr) { var el = $(id); el.textContent = T(fr); el.dataset.i18n = fr; }
  function applyLanguage() {
    document.documentElement.lang = lang === 'en' ? 'en-CA' : 'fr-CA';
    document.title = lang === 'en' ? 'Nota — signing room · Beta' : 'Nota — salle de signature · Bêta';
    document.querySelectorAll('[data-i18n]').forEach(function (el) { var fr = el.dataset.i18n; if (el.matches('.welcome h1')) { el.replaceChildren(); var parts = lang === 'en' ? ['Your notary.', 'Your document.', 'One shared space.'] : ['Votre notaire.', 'Votre document.', 'Un même espace.']; parts.forEach(function (part, i) { var node = document.createElement(i === 2 ? 'span' : 'span'); node.textContent = part; if (i !== 2) node.style.color = 'inherit'; el.appendChild(node); if (i !== 2) el.appendChild(document.createElement('br')); }); } else el.textContent = T(fr); });
    document.querySelector('.progress-track').setAttribute('aria-label', T('Étapes du rendez-vous'));
    document.querySelector('.video-column').setAttribute('aria-label', T('Vidéoconférence'));
    $('language-toggle').textContent = lang === 'en' ? 'FR' : 'EN';
    $('language-toggle').setAttribute('aria-label', lang === 'en' ? 'Passer au français' : 'Switch to English');
    try { localStorage.setItem('nota.lang', lang); } catch (_) {}
    themeLabel(); render();
  }
  function themeLabel() { label('theme-toggle', document.documentElement.dataset.theme === 'light' ? 'Thème sombre' : 'Thème clair'); }
  function notice(fr, error) { label('notice', fr); $('notice').hidden = false; $('notice').dataset.kind = error ? 'error' : 'info'; clearTimeout(noticeTimer); noticeTimer = setTimeout(function () { $('notice').hidden = true; }, error ? 12000 : 6500); }
  function setStatus(title, description) { label('status-title', title); label('status-description', description); }
  function hasBrowser() { return !!(window.isSecureContext && window.RTCPeerConnection && navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.crypto && crypto.subtle && window.TextEncoder); }
  function showCheck(id, passed) { $(id).textContent = passed ? '✓' : '○'; $(id).classList.toggle('passed', !!passed); }
  function sameKey(a, b) { return !!(a && b && a.kty === 'EC' && b.kty === 'EC' && a.crv === 'P-256' && b.crv === 'P-256' && a.x === b.x && a.y === b.y); }
  function active() { return !!(session && D && D.live(session, Date.now())); }
  function liveTracks(stream) { return !!(stream && ['audio', 'video'].every(function (kind) { return stream.getTracks().some(function (track) { return track.kind === kind && track.readyState === 'live' && track.enabled && !track.muted; }); })); }
  function transportReady() { return !!(pc && pc.connectionState === 'connected' && liveTracks(localStream) && liveTracks(remoteStream)); }
  function mediaReady() { return !!(entered && transportReady() && fingerprintVerified && documentValid && !document.hidden); }
  function pairReady() { return !!(session && D && D.observed(session, Date.now()) && mediaReady()); }
  function authHeaders() { return { authorization:'Bearer ' + token, 'content-type':'application/json', 'Accept-Language':lang }; }
  function body(extra) { return Object.assign({ bidId:bidId,dateISO:dateISO }, extra || {}); }
  function query() { return '?bidId=' + encodeURIComponent(bidId) + '&dateISO=' + encodeURIComponent(dateISO); }
  async function request(path, options) {
    var response = await window.fetch(apiPath + path, Object.assign({ headers:authHeaders(), cache:'no-store', credentials:'omit', referrerPolicy:'no-referrer' }, options || {}));
    var data; try { data = await response.json(); } catch (_) { data = {}; }
    if (!response.ok) { var errorCode = data.code || data.error || data.errors && data.errors[0] && data.errors[0].code || 'server_error'; var error = new Error(errorCode); error.code = errorCode; error.status = response.status; throw error; }
    return data;
  }
  function handleError(error) {
    if (error.status === 401) { token = ''; releaseMedia(); entered = false; showSignIn(); notice('Une nouvelle connexion par courriel est nécessaire.', true); }
    else if (error.status === 403) notice('Accès refusé à ce dossier.', true);
    else if (error.status === 409) { notice(error.code === 'presence_requise' ? 'La présence vidéo des deux participants est requise.' : 'La séance a changé. Vérifiez son état, puis réessayez.', true); refresh().catch(function () {}); }
    else notice(error.userMessage || 'La salle est momentanément indisponible. Réessayez dans un instant.', true);
  }
  function getToken() { if (role === 'notary') return readText('nota.notary.token') || ''; try { var offers = JSON.parse(localStorage.getItem('nota.myoffers.v1') || '[]'); return (Array.isArray(offers) && offers.find(function (offer) { return offer.id === bidId && offer.dateISO === dateISO; }) || {}).clientToken || ''; } catch (_) { return ''; } }
  function saveReturn() { try { if (bidId && dateISO) localStorage.setItem('nota.signing.return', JSON.stringify({ path:location.pathname + location.search,createdAt:Date.now() })); } catch (_) {} }
  function showSignIn() { $('welcome').hidden = false; $('workspace').hidden = true; if (bidId && dateISO) { label('welcome-auth', 'Reconnectez-vous à Nota avec votre lien reçu par courriel pour accéder à cette répétition.'); label('signin-link', 'Connexion requise pour ce dossier'); } $('signin-link').href = role === 'notary' ? '/#t=notaires' : '/#t=profil'; }
  function render() {
    if (!bidId || !dateISO || !token) return;
    $('dossier-label').textContent = T('Dossier') + ' ' + bidId.slice(0, 18) + ' · ' + dateISO + ' · ' + T(role === 'notary' ? 'Notaire' : 'Client');
    showCheck('check-browser', hasBrowser()); showCheck('check-media', liveTracks(localStream)); showCheck('check-access', !!capabilities);
    $('join-button').disabled = !!(operationBusy || entered || !hasBrowser() || !liveTracks(localStream) || !$('beta-consent').checked || !capabilities || (role === 'client' && (!active() || session.participants.client.joined)));
    label('join-button', role === 'notary' ? (session ? 'Nouvelle répétition' : 'Créer la répétition') : 'Rejoindre la salle');
    $('preflight-panel').hidden = entered; $('workspace').classList.toggle('entered',entered);
    $('network-notice').hidden = !capabilities || capabilities.turnConfigured;
    $('reconnect-button').hidden = role !== 'notary' || !entered || !pc || !active() || !session.admitted || transportReady() || signaling;
    $('reconnect-button').disabled = operationBusy;
    $('notary-controls').hidden = role !== 'notary' || !entered;
    $('leave-button').disabled = !entered && !localStream;
    $('microphone-button').disabled = !localStream; $('camera-button').disabled = !localStream;
    $('pause-button').disabled = !entered || !active() || operationBusy;
    $('microphone-button').setAttribute('aria-pressed', String(!!localStream && !localStream.getAudioTracks().some(function (t) { return t.enabled; })));
    $('camera-button').setAttribute('aria-pressed', String(!!localStream && !localStream.getVideoTracks().some(function (t) { return t.enabled; })));
    $('local-placeholder').hidden = !!localStream && localStream.getVideoTracks().some(function (t) { return t.enabled && t.readyState === 'live'; });
    var ready = pairReady(), connected = transportReady();
    $('connection-chip').classList.toggle('connected', connected);
    label('connection-label', connected ? (fingerprintVerified ? 'Vidéo chiffrée · WebRTC' : 'Connexion à vérifier') : (pc ? 'Connexion en cours' : 'Hors connexion'));
    $('remote-placeholder').hidden = !!(remoteStream && remoteStream.getVideoTracks().some(function (t) { return t.readyState === 'live' && !t.muted; }));
    $('remote-nameplate').hidden = !$('remote-placeholder').hidden;
    $('verification-panel').hidden = !connected;
    var other = role === 'notary' ? 'client' : 'notary';
    if (session && session.participants) { $('remote-name').textContent = session.participants[other].name || T(other === 'notary' ? 'Notaire' : 'Client'); label('remote-role', other === 'notary' ? 'Notaire' : 'Client'); }
    $('admit-button').disabled = operationBusy || !session || session.status !== 'waiting' || !session.participants.client.joined;
    $('verify-button').disabled = operationBusy || !connected || !fingerprintVerified || !$('identity-confirmed').checked || identityVerified;
    $('review-button').disabled = operationBusy || !session || !['admitted','paused'].includes(session.status) || !ready || !identityVerified;
    label('review-button', session && session.status === 'paused' ? 'Reprendre la lecture' : 'Commencer la lecture');
    $('release-button').disabled = operationBusy || !session || session.status !== 'reviewed' || !ready || !identityVerified;
    var canSign = !!(session && session.status === 'released' && !session.participants[role].acknowledged && (role === 'client' || session.participants.client.acknowledged));
    $('signing-controls').hidden = !canSign;
    $('sign-button').disabled = !canSign || !ready || !documentValid || !keyPair || !sameKey(publicKey, session.participants[role].publicKeyJwk) || !$('sign-consent').checked || operationBusy;
    $('receipt-button').hidden = !session || session.status !== 'complete';
    $('signature-receipts').hidden = !session || !['client','notary'].some(function (r) { return session.participants[r].acknowledged; });
    $('signature-receipts').replaceChildren();
    if (session) ['client','notary'].forEach(function (r) { if (session.participants[r].acknowledged) { var row = document.createElement('div'); row.className = 'signature-receipt'; row.textContent = '✓ ' + T(r === 'notary' ? 'Notaire' : 'Client') + ' · ' + T('Signature de test vérifiée'); $('signature-receipts').appendChild(row); } });
    var stage = !entered ? 0 : !session || session.status === 'waiting' || session.status === 'admitted' || session.status === 'paused' ? 1 : session.status === 'reviewed' ? 2 : session.status === 'released' ? 3 : session.status === 'complete' ? 4 : 0;
    document.querySelectorAll('.progress-track li').forEach(function (el,i) { el.classList.toggle('current',i === stage); el.classList.toggle('done',i < stage); if (i === stage) el.setAttribute('aria-current','step'); else el.removeAttribute('aria-current'); });
    if (!session) { if (role === 'client') setStatus('Aucune séance n’est ouverte. Votre notaire doit d’abord créer la salle.', 'La salle s’ouvre depuis un dossier retenu, après votre connexion.'); return; }
    if (session.status === 'complete') setStatus('La répétition est terminée.', 'Les deux signatures de test ont été vérifiées par le serveur. Téléchargez le reçu pour conserver le document, les preuves et le journal technique.');
    else if (session.status === 'closed') setStatus('La séance est fermée.', 'Votre caméra et votre microphone sont coupés. Une nouvelle répétition exige une nouvelle salle.');
    else if (!active()) setStatus('Répétition expirée.', 'Le notaire doit créer une nouvelle répétition.');
    else if (!entered) return;
    else if (session.status === 'paused') setStatus('La séance est en pause.', 'La signature de test est suspendue. Rétablissez caméra, micro et connexion; votre notaire devra autoriser une nouvelle lecture.');
    else if (session.status === 'waiting') { var title = role === 'notary' ? 'En attente du client' : 'Votre notaire vous accueille bientôt.'; var description = role === 'notary' ? 'Votre client se connecte à son espace Nota et ouvre ce dossier. Vous déciderez de son admission.' : 'Votre caméra est prête. Votre notaire doit vous admettre pour établir la connexion vidéo.'; setStatus(title,description); label('remote-title',title); label('remote-description',description); }
    else if (!connected) { setStatus('La connexion vidéo se prépare.', 'Gardez cette page ouverte pendant la connexion avec votre interlocuteur.'); label('remote-title','La connexion vidéo se prépare.'); label('remote-description','Gardez cette page ouverte pendant la connexion avec votre interlocuteur.'); }
    else if (!fingerprintVerified) setStatus('Vidéo connectée. Comparez les empreintes.', 'Comparez le code avec votre interlocuteur avant de poursuivre. La vidéo et le son doivent rester actifs.');
    else if (session.status === 'reviewed') setStatus('La lecture se fait ensemble.', 'Posez vos questions. Votre notaire autorisera la signature de test seulement après la lecture.');
    else if (session.status === 'released') setStatus('Le document d’essai est prêt à signer.', 'Le client signe d’abord, puis le notaire. Chaque confirmation porte sur cette version exacte du document.');
    else setStatus('Connexion vérifiée pour cet essai.', 'Le notaire accompagne les vérifications et la lecture. Vous pouvez demander une pause à tout moment.');
  }
  async function digest(text) { var bytes = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)); return Array.from(new Uint8Array(bytes)).map(function (n) { return n.toString(16).padStart(2,'0'); }).join(''); }
  async function applySession(data) {
    if (data.role && data.role !== role) throw Object.assign(new Error('role'),{ status:403 });
    if (data.capabilities) capabilities = data.capabilities;
    if (data.iceServers) iceServers = data.iceServers;
    var next = Object.prototype.hasOwnProperty.call(data,'session') ? data.session : data;
    if (!next || !next.id) { session = null; render(); return; }
    if (session && session.id !== next.id) { releasePeer(); entered = false; keyPair = null; publicKey = null; joinedSession = ''; }
    session = next;
    if (session.document) {
      $('document-title').textContent = T(session.document.title); $('document-title').removeAttribute('data-i18n'); $('document-body').textContent = session.document.text;
      $('document-body').removeAttribute('data-i18n'); $('document-digest').textContent = session.document.sha256;
      var currentId = session.id;
      documentValid = !!(D && session.document.text === D.DOCUMENT.text && await digest(session.document.text) === session.document.sha256);
      if (session && session.id === currentId) label('document-integrity',documentValid ? 'Document vérifié sur cet appareil' : 'Le document reçu ne correspond pas au document d’essai attendu. La signature est bloquée.');
    }
    renderEvents();
    if (session.status === 'closed' || !active() && session.status !== 'complete') { releaseMedia(); entered = false; }
    render();
    if (entered && active()) await advanceConnection();
  }
  function renderEvents() {
    var events = session && (session.events || session.audit || session.history) || [];
    var eventNames = { created:'Séance créée',create:'Séance créée',join:'Client arrivé',admit:'Client admis',review:'Lecture confirmée',release:'Signature de test autorisée',pause:'Séance suspendue',acknowledge:'Confirmation cryptographique',close:'Séance fermée',heartbeat:'Connexion média mise à jour',signal:'Échange de connexion',connection_lost:'Séance suspendue' };
    $('event-list').replaceChildren();
    if (!events.length) { var empty = document.createElement('li'); empty.textContent = T('Aucun événement pour le moment.'); $('event-list').appendChild(empty); }
    events.forEach(function (event) { var li = document.createElement('li'); var action = event.action || event.type || event.event; li.textContent = T(eventNames[action] || 'Événement technique') + (event.role ? ' · ' + T(event.role === 'notary' ? 'Notaire' : 'Client') : ''); var time = document.createElement('time'); var when = new Date(event.at || event.timestamp || event.createdAt); if (Number.isFinite(when.getTime())) { time.dateTime = when.toISOString(); time.textContent = when.toLocaleTimeString(lang === 'en' ? 'en-CA' : 'fr-CA',{ hour:'2-digit',minute:'2-digit',second:'2-digit' }); } li.appendChild(time); $('event-list').appendChild(li); });
  }
  async function refresh() { var result = await request('/sessions' + query()); await applySession(result); return result; }
  async function poll() { if (!token || pollBusy || operationBusy) return; pollBusy = true; try { await refresh(); } catch (e) { if (entered) { fingerprintVerified = false; $('peer-verified').checked = false; render(); notice('Le serveur ne répond plus. La signature de test est suspendue.',true); } if (e.status === 401 || e.status === 403) handleError(e); } finally { pollBusy = false; } }
  async function command(action, extra) {
    if (!session) throw new Error('no_session');
    var data = await request('/sessions/' + encodeURIComponent(session.id) + '/commands',{ method:'POST',body:JSON.stringify(body(Object.assign({ revision:session.revision,action:action },extra || {}))) });
    await applySession(data); return data;
  }
  async function mutate(action, extra) { if (operationBusy) return; operationBusy = true; render(); try { await refresh(); await command(action,extra); } catch (e) { handleError(e); } finally { operationBusy = false; render(); } }
  function watchTracks(stream, remote) { stream.getTracks().forEach(function (track) { track.addEventListener('ended',mediaChanged); track.addEventListener('mute',mediaChanged); track.addEventListener('unmute',mediaChanged); if (!remote) track.addEventListener('ended',function () { notice('La connexion a été interrompue. La signature de test est suspendue.',true); }); }); }
  async function startCamera() { if (!hasBrowser()) throw Object.assign(new Error('unsupported'),{ userMessage:'Cette fonction exige HTTPS, WebRTC et WebCrypto dans un navigateur compatible.' }); if (!localStream) { try { localStream = await navigator.mediaDevices.getUserMedia({ audio:{ echoCancellation:true,noiseSuppression:true },video:{ width:{ ideal:1280 },height:{ ideal:720 },facingMode:'user' } }); } catch (_) { throw Object.assign(new Error('media'),{ userMessage:'Votre navigateur doit autoriser la caméra et le microphone pour cette répétition.' }); } } watchTracks(localStream,false); $('local-video').srcObject = localStream; $('local-video').play().catch(function () {}); render(); }
  function releasePeer() { peerCodeGeneration++; if (pc) { pc.ontrack = null; pc.onconnectionstatechange = null; pc.close(); pc = null; } remoteStream = null; $('remote-video').srcObject = null; offerSent = false; lastSignalSequence = 0; fingerprintVerified = false; identityVerified = false; $('peer-verified').checked = false; $('identity-confirmed').checked = false; $('connection-fingerprint').textContent = '—'; $('sign-consent').checked = false; }
  function releaseMedia() { releasePeer(); if (localStream) localStream.getTracks().forEach(function (track) { track.stop(); }); localStream = null; $('local-video').srcObject = null; clearInterval(heartbeatTimer); heartbeatTimer = null; }
  async function join() {
    if (operationBusy || entered || !token) return;
    operationBusy = true; render();
    try {
      await startCamera(); await refresh();
      keyPair = await crypto.subtle.generateKey({ name:'ECDSA',namedCurve:'P-256' },false,['sign','verify']); publicKey = await crypto.subtle.exportKey('jwk',keyPair.publicKey);
      if (role === 'notary') { if (active()) await command('close'); session = null; var result = await request('/sessions',{ method:'POST',body:JSON.stringify(body({ publicKeyJwk:publicKey })) }); await applySession(result); }
      else { if (!active()) throw Object.assign(new Error('no_session'),{ userMessage:'Aucune séance n’est ouverte. Votre notaire doit d’abord créer la salle.' }); if (session.participants.client.joined) throw Object.assign(new Error('lost_key'),{ userMessage:'La clé de cette séance n’est plus sur cet appareil. Le notaire doit créer une nouvelle répétition.' }); await command('join',{ publicKeyJwk:publicKey }); }
      // Closing a previous rehearsal releases its media; reacquire only after the explicit join gesture.
      if (!localStream) await startCamera();
      entered = true; joinedSession = session.id; heartbeatTimer = setInterval(function () { heartbeat().catch(function () {}); },8000);
      await heartbeat(); render(); await advanceConnection();
    } catch (e) { handleError(e); } finally { operationBusy = false; render(); }
  }
  async function heartbeat() { if (!session || !entered || !active()) return; try { var result = await request('/sessions/' + encodeURIComponent(session.id) + '/heartbeat',{ method:'POST',body:JSON.stringify(body({ connected:mediaReady() })) }); if (result.session) await applySession(result); } catch (e) { fingerprintVerified = false; $('peer-verified').checked = false; render(); throw e; } }
  async function mediaChanged() { render(); if (entered && active()) { try { await heartbeat(); } catch (_) {} if (!mediaReady() && session && ['reviewed','released'].includes(session.status)) await mutate('pause'); } }
  function makePeer() {
    if (pc) return pc;
    pc = new RTCPeerConnection({ iceServers:iceServers || [],iceTransportPolicy:capabilities && capabilities.turnConfigured ? 'relay' : 'all',bundlePolicy:'max-bundle' });
    remoteStream = new MediaStream(); $('remote-video').srcObject = remoteStream;
    localStream.getTracks().forEach(function (track) { pc.addTrack(track,localStream); });
    pc.ontrack = function (event) { if (!remoteStream.getTracks().some(function (t) { return t.id === event.track.id; })) { remoteStream.addTrack(event.track); watchTracks(new MediaStream([event.track]),true); } $('remote-video').play().catch(function () {}); render(); mediaChanged(); };
    pc.onconnectionstatechange = function () { if (!pc) return; if (pc.connectionState === 'connected') { updateFingerprint().catch(handleError); } else { fingerprintVerified = false; identityVerified = false; $('peer-verified').checked = false; $('sign-consent').checked = false; if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') notice('La connexion a été interrompue. La signature de test est suspendue.',true); } mediaChanged(); render(); };
    return pc;
  }
  async function gathered(connection) {
    // Some TURN transports can remain pending after another transport has
    // yielded a usable relay. Send one immutable, signed SDP snapshot rather
    // than failing that successful allocation or sending later trickle ICE.
    var localOrigin = location.hostname === 'localhost' || location.hostname === '127.0.0.1' || location.hostname === '[::1]';
    var requireRelay = !localOrigin || connection.getConfiguration().iceTransportPolicy === 'relay';
    function snapshot() {
      var description = connection.localDescription;
      if (connection.signalingState === 'closed' || !description || !description.sdp) return null;
      var candidates = description.sdp.match(/^a=candidate:[^\r\n]+/gm) || [];
      var usable = candidates.some(function (line) {
        var fields = line.slice('a=candidate:'.length).trim().split(/\s+/);
        var port = Number(fields[5]);
        return fields[1] === '1' && /^(udp|tcp)$/i.test(fields[2]) && port > 0 && port <= 65535 && fields[6] === 'typ' &&
          (requireRelay ? fields[7] === 'relay' : ['host','srflx','prflx','relay'].includes(fields[7]));
      });
      return usable ? Object.freeze({ type:description.type,sdp:description.sdp }) : null;
    }
    function failure() { return Object.assign(new Error('ice_timeout'),{ userMessage:'La connexion a été interrompue. La signature de test est suspendue.' }); }
    if (connection.iceGatheringState === 'complete') { var complete = snapshot(); if (!complete) throw failure(); return complete; }
    return new Promise(function (resolve,reject) {
      var timer = setTimeout(finish,18000);
      function finish() {
        clearTimeout(timer); connection.removeEventListener('icegatheringstatechange',change);
        var description = snapshot(); if (description) resolve(description); else reject(failure());
      }
      function change() { if (connection.iceGatheringState === 'complete') finish(); }
      connection.addEventListener('icegatheringstatechange',change);
    });
  }
  async function sendSignal(type, description) {
    var current = await request('/sessions' + query()); if (!current.session || current.session.id !== joinedSession) throw new Error('session_changed'); session = current.session;
    var signalDigest = await digest(description.sdp);
    var signalProof = D.signalMessage(session.id,role,type,signalDigest);
    var signature = await signBytes(signalProof);
    var result = await request('/sessions/' + encodeURIComponent(session.id) + '/signal',{ method:'POST',body:JSON.stringify(body({ revision:session.revision,type:type,sdp:description.sdp,signature:signature })) });
    if (result.session) session = result.session;
  }
  async function advanceConnection() {
    if (signaling || !entered || !localStream || !session || !['admitted','paused','reviewed','released'].includes(session.status)) return;
    signaling = true;
    try {
      var connection = makePeer();
      if (role === 'notary' && !offerSent) { offerSent = true; await connection.setLocalDescription(await connection.createOffer()); var offerSnapshot = await gathered(connection); await sendSignal('offer',offerSnapshot); }
      var signal = session.peerSignal;
      if (signal && Number.isSafeInteger(signal.seq) && signal.seq > lastSignalSequence) {
        // Consume the sequence before any async work. A failed handshake waits
        // for a new signed offer instead of allocating a new peer on each poll.
        lastSignalSequence = signal.seq;
        await verifySignal(signal);
        if (role === 'client' && signal.type === 'offer') { if (connection.remoteDescription) { releasePeer(); lastSignalSequence = signal.seq; connection = makePeer(); } fingerprintVerified = false; $('peer-verified').checked = false; identityVerified = false; await connection.setRemoteDescription({ type:'offer',sdp:signal.sdp }); await connection.setLocalDescription(await connection.createAnswer()); var answerSnapshot = await gathered(connection); await sendSignal('answer',answerSnapshot); }
        else if (role === 'notary' && signal.type === 'answer' && connection.signalingState === 'have-local-offer') { await connection.setRemoteDescription({ type:'answer',sdp:signal.sdp }); }
      }
      if (connection.localDescription && connection.remoteDescription) await updateFingerprint();
    } catch (e) { handleError(e); } finally { signaling = false; render(); }
  }
  async function signBytes(message) {
    var bytes = new Uint8Array(await crypto.subtle.sign({ name:'ECDSA',hash:'SHA-256' },keyPair.privateKey,new TextEncoder().encode(message)));
    return btoa(String.fromCharCode.apply(null,bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  }
  async function verifySignal(signal) {
    var peerRole = role === 'notary' ? 'client' : 'notary';
    var key = await crypto.subtle.importKey('jwk',session.participants[peerRole].publicKeyJwk,{ name:'ECDSA',namedCurve:'P-256' },false,['verify']);
    if (!/^[A-Za-z0-9_-]{86}$/.test(signal.signature || '')) throw new Error('invalid_signal_signature');
    var raw = atob(signal.signature.replace(/-/g,'+').replace(/_/g,'/'));
    var signature = Uint8Array.from(raw,function (c) { return c.charCodeAt(0); });
    var message = D.signalMessage(session.id,peerRole,signal.type,await digest(signal.sdp));
    if (!await crypto.subtle.verify({ name:'ECDSA',hash:'SHA-256' },key,signature,new TextEncoder().encode(message))) throw new Error('invalid_signal_signature');
  }
  async function updateFingerprint() {
    if (!pc || !pc.localDescription || !pc.remoteDescription) return;
    var generation = peerCodeGeneration;
    var fingerprints = [pc.localDescription.sdp,pc.remoteDescription.sdp].map(function (sdp) { var match = sdp.match(/^a=fingerprint:sha-256 ([A-Fa-f0-9:]+)\r?$/m); if (!match) throw new Error('missing_fingerprint'); return match[1].replace(/:/g,'').toUpperCase(); }).sort();
    var value = (await digest(fingerprints.join('\n') + '\n' + session.id)).slice(0,24).toUpperCase().match(/.{4}/g).join(' ');
    if (generation !== peerCodeGeneration) return;
    if ($('connection-fingerprint').textContent !== value) { fingerprintVerified = false; identityVerified = false; $('peer-verified').checked = false; $('connection-fingerprint').textContent = value; }
    render();
  }
  async function sign() {
    if (operationBusy || !mediaReady() || !documentValid || !$('sign-consent').checked || !keyPair) return;
    operationBusy = true; render();
    try {
      await heartbeat(); await refresh();
      if (!pairReady() || !session.challenge || !sameKey(publicKey,session.participants[role].publicKeyJwk)) throw Object.assign(new Error('lost_key'),{ userMessage:'La clé de cette séance n’est plus sur cet appareil. Le notaire doit créer une nouvelle répétition.' });
      var expected = D.proofMessage(session.id,session.document.sha256,role,session.challenge.nonce);
      if (session.challenge.message !== expected) throw Object.assign(new Error('bad_challenge'),{ userMessage:'Le défi de signature ne correspond pas à cette séance.' });
      var bytes = new Uint8Array(await crypto.subtle.sign({ name:'ECDSA',hash:'SHA-256' },keyPair.privateKey,new TextEncoder().encode(expected)));
      var signature = btoa(String.fromCharCode.apply(null,bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
      if (!mediaReady()) throw Object.assign(new Error('presence_requise'),{ status:409,code:'presence_requise' });
      await command('acknowledge',{ signature:signature }); $('sign-consent').checked = false;
    } catch (e) { handleError(e); } finally { operationBusy = false; render(); }
  }
  async function reconnect() { if (operationBusy || !active() || role !== 'notary') return; await mutate('pause'); if (!active() || session.status !== 'paused') return; releasePeer(); render(); await advanceConnection(); }
  async function downloadReceipt() { try { var receipt = await request('/sessions/' + encodeURIComponent(session.id) + '/evidence' + query()); var url = URL.createObjectURL(new Blob([JSON.stringify(receipt,null,2)],{ type:'application/json' })); var a = document.createElement('a'); a.href = url; a.download = 'nota-repetition-' + session.id + '.json'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(url); },1000); } catch (e) { handleError(e); } }
  function leaveKeepalive() { if (session && token && entered && active()) window.fetch(apiPath + '/sessions/' + encodeURIComponent(session.id) + '/heartbeat',{ method:'POST',headers:authHeaders(),body:JSON.stringify(body({ connected:false })),keepalive:true,credentials:'omit' }).catch(function () {}); releaseMedia(); }
  async function leave() { if (entered && active()) { try { await mutate('close'); } finally { releaseMedia(); entered = false; render(); } } else { releaseMedia(); entered = false; render(); } }
  function bind(id, fn) { $(id).addEventListener('click',function () { Promise.resolve().then(fn).catch(handleError); }); }
  bind('theme-toggle',function () { var theme = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light'; document.documentElement.dataset.theme = theme; try { localStorage.setItem('nota.theme',JSON.stringify(theme)); } catch (_) {} themeLabel(); });
  bind('language-toggle',function () { lang = lang === 'en' ? 'fr' : 'en'; applyLanguage(); renderEvents(); });
  $('signin-link').addEventListener('click',saveReturn);
  bind('camera-test',startCamera); bind('reconnect-button',reconnect); bind('join-button',join); bind('admit-button',function () { return mutate('admit'); });
  bind('verify-button',function () { if (!transportReady() || !fingerprintVerified || !$('identity-confirmed').checked) return; identityVerified = true; render(); notice('Vérification confirmée pour cet essai.'); });
  bind('review-button',function () { if (!identityVerified || !mediaReady()) return; return mutate('review',{ observationConfirmed:true }); });
  bind('release-button',function () { if (!identityVerified || !mediaReady()) return; return mutate('release'); });
  bind('pause-button',function () { $('sign-consent').checked = false; return mutate('pause'); }); bind('leave-button',leave); bind('sign-button',sign); bind('receipt-button',downloadReceipt);
  bind('camera-button',function () { if (!localStream) return; localStream.getVideoTracks().forEach(function (track) { track.enabled = !track.enabled; }); return mediaChanged(); });
  bind('microphone-button',function () { if (!localStream) return; localStream.getAudioTracks().forEach(function (track) { track.enabled = !track.enabled; }); return mediaChanged(); });
  bind('invite-button',async function () { var url = new URL('/signature.html',location.origin); url.searchParams.set('bidId',bidId); url.searchParams.set('dateISO',dateISO); url.searchParams.set('role',role === 'notary' ? 'client' : 'notary'); try { await navigator.clipboard.writeText(url.href); notice('Invitation copiée. Votre interlocuteur devra se connecter à son propre espace Nota.'); } catch (_) { notice('Votre navigateur ne permet pas la copie automatique.',true); } });
  bind('fullscreen-button',async function () { try { if (document.fullscreenElement) await document.exitFullscreen(); else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen(); else throw new Error('unsupported'); } catch (_) { notice('Le mode plein écran n’est pas disponible dans ce navigateur.',true); } });
  document.addEventListener('fullscreenchange',function () { label('fullscreen-button',document.fullscreenElement ? 'Quitter le plein écran' : 'Plein écran'); });
  ['beta-consent','identity-confirmed','sign-consent'].forEach(function (id) { $(id).addEventListener('change',function () { if (id === 'identity-confirmed' && !$(id).checked) identityVerified = false; render(); }); });
  $('peer-verified').addEventListener('change',function () { fingerprintVerified = $('peer-verified').checked && transportReady() && $('connection-fingerprint').textContent !== '—'; if (!fingerprintVerified) identityVerified = false; mediaChanged(); });
  ['document','evidence'].forEach(function (name) { bind('tab-' + name,function () { ['document','evidence'].forEach(function (other) { var selected = other === name; $('tab-' + other).setAttribute('aria-selected',String(selected)); $(other + '-content').hidden = !selected; }); }); });
  function stopTest() { if (testStream) testStream.getTracks().forEach(function (track) { track.stop(); }); testStream = null; $('test-video').srcObject = null; }
  bind('public-camera-test',async function () { if (!hasBrowser()) throw Object.assign(new Error('unsupported'),{ userMessage:'Cette fonction exige HTTPS, WebRTC et WebCrypto dans un navigateur compatible.' }); try { testStream = await navigator.mediaDevices.getUserMedia({ audio:true,video:{ facingMode:'user' } }); $('test-video').srcObject = testStream; $('camera-dialog').showModal(); await $('test-video').play(); } catch (_) { stopTest(); throw Object.assign(new Error('media'),{ userMessage:'Votre navigateur doit autoriser la caméra et le microphone pour cette répétition.' }); } });
  bind('close-camera-dialog',function () { $('camera-dialog').close(); stopTest(); }); $('camera-dialog').addEventListener('close',stopTest); $('camera-dialog').addEventListener('cancel',stopTest);
  window.addEventListener('pagehide',function () { leaveKeepalive(); stopTest(); clearInterval(pollTimer); });
  document.addEventListener('visibilitychange',function () { if (document.hidden && entered) { fingerprintVerified = false; $('peer-verified').checked = false; $('sign-consent').checked = false; mediaChanged(); } });
  async function init() {
    var theme = readText('nota.theme'); if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
    token = getToken(); applyLanguage();
    if (!bidId || !/^\d{4}-\d{2}-\d{2}$/.test(dateISO) || !token) { showSignIn(); return; }
    $('welcome').hidden = true; $('workspace').hidden = false;
    try { await refresh(); pollTimer = setInterval(poll,2000); } catch (e) { handleError(e); }
    render();
  }
  init();
})();
