# Spec — Pont vocal Pi (parler à la session Pi vivante en marchant)

> Statut : synthese du grill-with-docs 2026-09-19, decisions ADR 0001-0004.
> Cette spec est publiee comme issue parente ; les tickets tracer-bullet en referent.

## Problem Statement

Julien veut parler a la session Pi en cours (pi-web) tout en marchant, ecran eteint,
telephone Android en poche, ecouteurs sur les oreilles. Il doit entendre, au fil du streaming,
le texte que Pi lui ecrit (sous-titres), et une phrase qui decrit ce que Pi fait quand il agit
(audio-description). Ce qu'il dit doit devenir un message utilisateur dans la meme session,
comme s'il l'avait tape.

L'architecture actuelle n'existe pas : c'est un ponte a batir. Les contraintes de l'utilisateur
sont fortes : pas de GPU pour STT/TTS (tout par API), pas de WSL2, session Pi deja vivante a
brancher (pas une nouvelle session headless), reseau via ZeroTier (pas Tailscale), audio qui ne
reste pas sur le mesh (relais VPS accepte).

## Solution

Une extension Pi « pi-voice-bridge » se lie a la session Pi vivante ou `/voice on` a ete tape.
Elle expose un serveur WebSocket local (127.0.0.1, token dedie) que le client Android (PWA
Chrome en phase 0, push-to-talk) rejoint a travers le PC. La parole du Pixel est transcrite
(STT cloud via Pi Daemon /stt), injectee dans la session Pi via `pi.sendUserMessage` (followUp
par defaut, steer en commande explicite). Le texte de Pi est lu tel quel (sous-titres, voix Pi,
TTS edge-tts), et les actions d'outils sont decrites a l'oral : gabarits instantanes, puis un
descripteur (petit modele, hors session) pour le non-litteral. Deux voix distinctes distinguent
la parole de Pi de la description. Push-to-talk en P0 ; VAD mains-libres et fin-de-tour
semantique en v1.1.

## User Stories

1. En tant que marcheur, je veux que le texte que Pi m'ecrit soit lu tel quel au fil du
   streaming, pour ne pas avoir a regarder l'ecran.
2. En tant que marcheur, je veux que les blocs de code, tableaux et diffs soient remplaces a
   l'oral par un marqueur + une description, pour ne pas entendre du markup.
3. En tant que marcheur, je veux entendre une phrase courte des que Pi agit (edite, ecrit, lance
   une commande), pour suivre ce qui se passe.
4. En tant que marcheur, je veux que la description soit dite avec une voix distincte de Pi, pour
   distinguer a l'oreille la parole de Pi de la description d'action.
5. En tant que marcheur, je veux parler au telephone (push-to-talk) et que ma phrase soit injectee
   dans la session Pi comme si je l'avais tapee, sans enveloppe ni instruction ajoutee.
6. En tant que marcheur, je veux qu'une parole envoyee pendant que Pi travaille soit mise en file
   (followUp), sans interrompre le travail en cours.
7. En tant que marcheur, je veux couvrir Pi de la voix pour arreter sa lecture TTS, sans tuer le
   run de Pi.
8. En tant que marcheur, je veux entendre une description precise du resultat d'un outil (ex.
   « deux tests echouent dans auth »), pas seulement « Pi lance npm test ».
9. En tant que marcheur, je ne veux jamais entendre un secret (cles API, tokens, mots de passe)
   que Pi afficherait.
10. En tant que marcheur, je veux choisir le niveau de narration (silencieux/essentiel/bavard).
11. En tant que marcheur en 4G changeant de reseau, je veux que la connexion se retablisse sans
    intervention.
12. En tant qu'utilisateur de pi-web, je veux que les messages venus de ma voix apparaissent dans
    pi-web comme des messages normaux, sans doublon ni enveloppe.
13. En tant qu'utilisateur, je veux activer/desactiver la voix par commande (`/voice on|off|status`),
    et qu'une seule session porte la voix active.
14. En tant qu'utilisateur, je veux que ma session (avec sa sessionFile) se re-active toute seule
    apres un reload de sessiond, sans re-taper la commande.
15. En tant qu'utilisateur, je ne veux pas que quiconque sur le mesh puisse piloter ma session : le
    token WebSocket est distinct du token pi-web.

## Implementation Decisions

Les decisions architecturales sont dans ADR 0001-0004. Rappel des points engages, sans chemins :

- **Cerveau** (0001) : extension pi-voice-bridge (composant A) + Pi Daemon /stt /tts (STT/TTS
  cloud deja cables). Pas de Cicero.
- **Reseau** (0002) : ZeroTier mesh PC↔VPS ; relais nginx `talk.srv759970.hstgr.cloud` (VPS,
  cert LE) → `10.77.208.239:<port>`. Le client PWA parle HTTPS public au VPS, le VPS relaie au PC.
- **STT/TTS** (0003) : v1 cloud (STT Groq whisper via provider Pi Daemon ; TTS edge-tts, deux
  voix FR). v2 local (parakeet/pocket-tts) par changement de provider, aucun nouveau composant.
- **Hote/protocole** (0004) : natif Windows. Injection par `pi.sendUserMessage(text,
  { deliverAs: "followUp" | "steer" })`, source distinguable (`event.source === "extension"`).
  Evenements Pi mappes 1:1 : `message_update` (text_delta → say), `tool_execution_start/end`
  (→ narrate), `agent_start/end/settled` (→ state).
- **Sous-titres** (say) : segmentation en phrases (ponctuation de fin + saut de ligne), tampon
  max 400 car., nettoyage oral (blocs de code/tableau/diff → marqueur + descripteur ; chemin →
  nom de base ; URL → domaine ; puces → un item = une phrase ; secret masque). Jamais de
  troncature.
- **Narration** (narrate) : gabarits FR au present, sujet « Pi » (ecrit/lit/lance/cherche/echoue),
  verbosite silencieux|essentiel|bavard, regroupement 3 s, plus de 4 noms → « et N autres ».
  Narration en file si un say est en cours.
- **Descripteur** : `ctx.modelRegistry.find(...)` + `complete(...)` hors session (haiku-4-5 par
  defaut). Gabarit immediat, descripteur en parallele (dela 2,5 s, `replaces` si avant lecture),
  budget 60 calls/h, `allowCode:false` pour ne jamais filer de code. Appel hors session, ne
  consomme ni contexte ni run.
- **Busy** : followUp par defaut, steer en commande vocale explicite (« stop Pi »). Barge-in = coupe
  la lecture TTS locale du client, jamais le run Pi.
- **Verrou** : `~/.pi/voice-bridge/active.json` (sessionFile, pid, since). `/voice on` dans une
  session prend le verrou et notifie la session precedente. Verrou perime (pid mort) recuperable.
  Au session_start, si le fichier de session correspond au verrou, auto-reactivation.
- **Serveur WS** : 127.0.0.1:<port> (client localhost only), token dedie au premier message
  (hello), 1 client, port libre (8766 propose — 8765 est pris par edge-tts).
- **Protocole WS** (une trame = un objet JSON) : `hello`, `user_text`, `abort`, `set_verbosity`,
  `ping` (client→extension) ; `ready`, `say`, `narrate`, `state`, `turn_end`, `user_echo`,
  `error`, `pong` (extension→client). turnId genere a chaque agent_start.
- **Client** : PWA Chrome phase 0, push-to-talk, audio micro → WS → /stt → user_text → Pi ;
  say → /tts → audio retour. Barge-in client-side. Bascule native Expo seulement si le test ecran
  verrouille echoue.

## Testing Decisions

Deux seams.

1. **Seam principal — protocole WebSocket** : wscat se connecte au WS de l'extension, envoie
   `user_text` json, verifie les `say`/`narrate`/`state`/`turn_end` recus. Verifie P1, P2, P2b
   sans ecrire un pixel d'Android. Les criteres d'acceptation des phases s'expriment dans ce
   protocole (ex. : envoyer une commande → recevoir say segmentes ; envoyer une action edit →
   recevoir narrate ; absence de secret dans say).
2. **Seam secondaire — extension isolee** : simuler les evenements Pi (`message_update`,
   `tool_execution_start/end`, `agent_*`) sans session Pi reelle, pour tester l'extension en
   unitaire (segmentation, gabarits, verbosite, regroupement, masquage).

BON : ne tester que le comportement externe, pas l'implementation. Exposer /stt /tts de Pi Daemon
comme deja-valides, pas de seam nouveau. La boucle bout-en-bout Pixel (P3) se teste au seam final
(client PWA) — hors de P1/P2.

## Out of Scope

- App native Android (cree seulement si le PWA echoue sur ecran verrouille / bouton media / reprise
  reseau). P5/P6.
- VAD mains-libres et fin-de-tour semantique (v1.1).
- STT/TTS local (parakeet/pocket-tts) — v2, par changement de provider.
- Cicero (lanes/office, clonage de voix, notifications proactives) — ADR 0001 ecarte.
- Deuxieme LLM dans la boucle conversationnelle (le descripteur ne parle jamais a la place de Pi).
- Changement de l'UI pi-web (l'ecran reste pi-web quand Julien rentre).

## Further Notes

- Le PC doit rester eveille sur secteur pendant la marche ; services relances au boot (Pi Daemon,
  edge-tts, pi-web, relais). Pi-web tourne en natif (pas de service systemd Windows).
- Pi Daemon :8790 et edge-tts :8765 sont deja up sur ce PC. Le relais VPS est la seule piece a
  ajouter a l'existant.
- Latence cible : parole→accuse < 1,5 s ; premier token Pi → premier son < 1,2 s (cloud a valider) ;
  evenement outil → narration < 2 s ; fin outil → description < 3,5 s sinon abandon ; barge-in →
  silence < 300 ms.
