# pi-voice-bridge

Extension Pi (composant A du pont vocal) — parler à la session Pi vivante en marchant.

Couvre les tickets #1 (verrou + serveur WS base), #2 (`user_text` → injection), #3 (`say`,
sous-titres du texte de Pi), #4 (`narrate`, narration d'outils), #5 (descripteur) et #6 (voix de
sortie, deux voix) et #7 (voix d'entrée, STT).

## Fichiers

- `server.ts` — serveur WebSocket 127.0.0.1 pur, protocole testable sans session Pi.
- `oral.ts` — segmentation en phrases + nettoyage oral des `text_delta` (pur, sans WS).
- `narrate.ts` — gabarits FR d'outils, verbosité, regroupement 3 s, file derrière un say.
- `describe.ts` — descripteur hors session (petit modèle), délai 2,5 s, budget, `allowCode`.
- `voice.ts` — file FIFO say/narrate → TTS (deux voix), trames `audio` + binaire, barge-in.
- `stt.ts` — audio du client → `/v1/audio/transcriptions` (Groq whisper) → texte.
- `smoke_tts.ts` / `smoke_stt.ts` — vérifications live contre les vrais proxys (audio réel).
- `smoke_e2e.ts` — bout en bout : vraie session Pi (RPC) → `/voice on` → WS → `user_text` → `say` → audio.
- `index.ts` — extension Pi : `/voice on|off|status`, verrou, injection, sous-titres, auto-réactivation.
- `*.test.ts` — tests aux deux seams de la spec (protocole WS + extension isolée).

## Usage

L'extension est **installée globalement** (`pi install <chemin du dossier>`) : `/voice` existe dans
toute session Pi, y compris celles de pi-web. Le verrou garantit qu'une seule session porte la voix.

```bash
# ou, ponctuellement, sans installation globale
pi -e ./extension/pi-voice-bridge/index.ts

# dans la session
/voice on          # prend le verrou ~/.pi/voice-bridge/active.json + écoute 127.0.0.1:8766
/voice status
/voice off

# côté client, envoyer un user_text (protocole JSON, token dans active.json)
# ws 127.0.0.1:8766 → hello {token} → ready → user_text → state working
```

## Sous-titres (`say`)

`message_update` (`text_delta`) → `Subtitler` → trames `{ type: "say", text }` au fil du streaming.
Nettoyage oral : bloc de code/diff → `(bloc de code, N lignes)` / `(diff, N lignes)`, tableau →
`(tableau, N lignes)`, chemin → nom de base, URL → domaine, markdown et puces retirés, secrets →
`(secret masqué)`. Tampon forcé à 400 caractères, jamais de troncature. `message_end` vide le tampon.

## Descripteur (`narrate` avec `replaces`)

Résultat d'outil et bloc de code partent à un petit modèle **hors session** (`modelRegistry.complete`,
claude-haiku-4-5 par défaut) : une phrase de 15 mots max, ni contexte ni run Pi consommé.
Délai 2,5 s (au-delà, le gabarit seul), budget 60 appels/h, secrets masqués avant envoi.
`allowCode:false` (défaut) : aucun bloc de code n'est envoyé au fournisseur, et les blocs fencés
des résultats d'outils deviennent `(code retiré)`. La description revenue à temps porte
`replaces: <id du gabarit>` — toute trame `say`/`narrate` porte un `id`.

## Narration (`narrate`)

`tool_execution_start/end` → `Narrator` → trames `{ type: "narrate", text }`. Gabarits au présent
(« Pi modifie login.ts », « Pi lance npm test »), regroupement 3 s (« Pi a modifié 3 fichiers : … »),
au-delà de 4 noms « et N autres ». Verbosité par `set_verbosity` :

| niveau | ce qui est dit |
|---|---|
| `silencieux` | seulement « Échec : … » |
| `essentiel` (défaut) | édits, écritures, commandes, échecs |
| `bavard` | + lectures, recherches, autres outils |

Une narration produite pendant un say en cours est mise en file et dite à `message_end`, jamais
insérée au milieu d'une phrase de Pi.

## Voix de sortie (`audio`)

Chaque `say`/`narrate` part au proxy TTS **déjà en place** (`paseo-tts-proxy` :8791, OpenAI
`/v1/audio/speech` → Cartesia) avec une voix par nature : Henri pour Pi, Zoé pour la description.
Le client reçoit une trame JSON `{ type: "audio", id, for, voice, format, sampleRate, bytes }`
**suivie de la trame binaire** PCM s16le 24 kHz. Une synthèse à la fois (l'ordre est garanti), une
phrase = un appel (le son part avant la fin de la réponse). `abort` (barge-in) vide la file et
coupe la synthèse en cours, jamais le run Pi. Échec TTS → trame `error` (`scope: "tts"`), pas de
silence muet.

```bash
node --experimental-strip-types smoke_tts.ts   # 4 en-têtes audio / 4 trames binaires, 2 voix
```

## Voix d'entrée (trame binaire → `user_text`)

Le client envoie `{ type: "speech", mime: "audio/webm" }` **puis la trame binaire** de l'audio micro.
L'extension transcrit via `paseo-stt-proxy` :8792 (Groq whisper-large-v3-turbo, français) et
injecte le texte comme un message tapé : trame `user_echo`, puis `sendUserMessage(followUp)`, puis
`state phase=working`. Transcription vide ou erreur STT → trame `error` (`scope: "stt"`).

```bash
node --experimental-strip-types smoke_stt.ts /tmp/utt.wav   # user_echo + injection réelle
node --experimental-strip-types smoke_e2e.ts                # vraie session Pi : say + audio reçus
```

`user_text` → `pi.sendUserMessage(text, { deliverAs: "followUp" })` : pendant un run Pi, la
parole est mise en file (followUp), elle ne coupe pas le run. Source distinguée
(`event.source === "extension"`), accusé `state phase=working`.

## Tests / vérifications

```bash
cd extension/pi-voice-bridge
node --experimental-strip-types --test *.test.ts                     # 43/43
npx tsc                                                             # 0 erreur
```

## Variables d'environnement

- `PI_VOICE_BRIDGE_TOKEN` — token dédié (sinon généré et persisté dans active.json).
- `PI_VOICE_BRIDGE_PORT` — port (défaut 8766, libre — 8765 pris par edge-tts).
- `PI_VOICE_BRIDGE_DESCRIBER_PROVIDER` / `_MODEL` — descripteur (défaut anthropic / claude-haiku-4-5).
- `PI_VOICE_BRIDGE_ALLOW_CODE=1` — autorise l'envoi de code au descripteur (défaut : non).
- `PI_VOICE_BRIDGE_TTS_URL` — endpoint TTS (défaut `http://127.0.0.1:8791/v1/audio/speech`).
- `PI_VOICE_BRIDGE_VOICE_PI` / `_VOICE_DESC` — ids de voix Cartesia (défaut Henri / Zoé).
- `PI_VOICE_BRIDGE_STT_URL` / `_STT_MODEL` — endpoint STT (défaut :8792) et modèle Groq.
