# 0005 — STT/TTS par les proxys Paseo déjà en place (supersède la partie « transport » de l'ADR 0003)

- Statut : acceptée
- Date : 2026-09-19
- Supersède : ADR 0003 pour le CHOIX DES ENDPOINTS uniquement (le principe « cloud en v1, local en
  v2 par changement de provider » reste entier)

## Contexte

L'ADR 0003 et le plan de livraison écrivaient : STT et TTS passent par **Pi Daemon :8790** (`/stt`,
`/tts`), avec **edge-tts :8765** comme moteur de voix, « tous deux déjà up sur ce PC ». Au moment de
câbler les tickets #6 et #7, la mesure contredit cette phrase :

- `:8790` n'était pas Pi Daemon mais un **Datasette** (`data/images.db`) lancé à la main qui squattait
  le port depuis un jour ; Pi Daemon était éteint. Son `health_url` LSM rendait un 404 Datasette,
  donc le dashboard affichait « up » — un service up menteur.
- `:8765` n'est pas edge-tts mais **HydraSpecter**.
- En revanche, deux services **existaient déjà, registrés dans LSM, `auto_start: true`, en bonne
  santé** : `paseo-tts-proxy` :8791 (API OpenAI `/v1/audio/speech` → Cartesia, voix FR) et
  `paseo-stt-proxy` :8792 (`/v1/audio/transcriptions` → Groq Whisper, avec filtre des watermarks
  hallucinés sur le silence).

## Décision

Le pont vocal parle aux **proxys Paseo** :

| Besoin | Endpoint retenu | Moteur |
|---|---|---|
| TTS (`say`, `narrate`) | `http://127.0.0.1:8791/v1/audio/speech` | Cartesia sonic-3.6, PCM s16le 24 kHz |
| STT (trame binaire → `user_text`) | `http://127.0.0.1:8792/v1/audio/transcriptions` | Groq whisper-large-v3-turbo |

Les deux voix distinctes exigées par la spec (Pi vs audio-description) sont obtenues en ajoutant un
paramètre `voice` **par requête** au proxy TTS (défaut inchangé = `CARTESIA_VOICE_ID`) : Henri pour
Pi, Zoé pour la description. Les ids sont surchargeables par `PI_VOICE_BRIDGE_VOICE_PI` / `_DESC`.

Pi Daemon n'est plus sur le chemin de la voix. Il garde son entrée LSM pour ses autres usages
(idle-queue) ; le Datasette a été déplacé sur :8794 et registré.

## Conséquences

- Aucun composant à monter : le seul ajout est le `voice` par requête, non-breaking pour Paseo.
- Le coût STT/TTS devient celui de Groq + Cartesia, pas d'edge-tts gratuit. À réévaluer si la marche
  devient quotidienne ; le changement de provider reste un changement de config (ADR 0003 tient).
- Un bug d'écosystème a été trouvé et corrigé en passant : Groq (Cloudflare) rejetait l'User-Agent
  `python-urllib` du proxy STT (`error code: 1010`), la transcription remontait vide. UA explicite →
  200. La dictée Paseo de Julien en profite aussi.
- Leçon générale, valable au-delà de ce repo : **un `health_url` sur un port squatté rend « up »**.
  Une phrase de plan du type « X est déjà up sur ce poste » se vérifie par un appel qui reconnaît le
  service (`/health` qui répond `ok` **et** une route métier), pas par « quelque chose répond ».
