---
numero: 0003
titre: STT/TTS cloud en v1, options locales en v2 par changement de provider
statut: accepté
date: 2026-09-19
concerne:
  - (composant C) STT et TTS de la boucle voix
---

# 0003 — STT/TTS cloud en v1, options locales en v2 par changement de provider

## Contexte
Contrainte utilisateur posée au grill : ne pas utiliser le GPU du PC pour STT/TTS, tout passer
par des API. La skill `julien-ref-llm-backends` recense déjà les fournisseurs : elle tranche
**STT → Groq `whisper-large-v3-turbo`** (~$0.04/h, FR excellent, batch par utterance — le pick
de référence de la référence) et **TTS → edge-tts** (gratuit, 5 voix FR, déjà servi sur le PC).

Pi Daemon (`/stt`, `/tts`) expose **8 STT cloud + 12 TTS** déjà câblés, dont `whisper-local`
(faster-whisper) et `kokoro`. En parallèle, l'utilisateur hésite à tester plus tard parakeet et
pocket-tts local sur le PC.

## Décision
V1 : **tout cloud**, via les providers existants de Pi Daemon — STT Groq whisper
(`openai-whisper` ou un endpoint compatible), TTS edge-tts (voix FR, deux voix : Pi + description).
V2 : tester d'autres TTS **dont pocket-tts local**, et STT local (whisper-local / parakeet),
**par simple changement de provider** (config), sans nouveau composant.

Push-to-talk en Phase 0 (tenue du bouton) ; VAD mains-libres et fin-de-tour en v1.1.

## Conséquences
- **Coût v1 ≈ 0** (Groq ~$0.04/h + edge-tts gratuit), aucune licence bloquante en test.
- **Coût** : le passage local n'est pas validé en v1 — la qualité FR de edge-tts (rate-limited IP)
  et la latence cloud restent les plafonds tant que v2 n'a pas tranché. edge-tts licence
  **non commerciale** : OK usage personnel, à re-arbitrer si le produit devient vendable.
- **Ce qui devient plus difficile** : rien structurellement — le provider swap est déjà le
  mécanisme de Pi Daemon.

## Alternatives écartées
- **GPU local en v1** (faster-whisper sur RTX 3050 Ti) : écarté par contrainte utilisateur, et
  réservé comme option v2.
- **TTS payant en v1** (Cartesia sonic-3 / Inworld #1) : qualité supérieure mais coût + 2
  providers à configurer ; re-grillé en v2 seulement si edge-tts choque à l'écoute réelle.
