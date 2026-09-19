---
numero: 0001
titre: La couche voix réutilise Pi Daemon + une extension Pi, pas l'agent Cicero
statut: accepté
date: 2026-09-19
concerne:
  - (composant B) pont web-voice → session Pi vivante
---

# 0001 — La couche voix réutilise Pi Daemon + une extension Pi, pas l'agent Cicero

## Contexte
La spec initiale (v0.4) posait Cicero (5uck1ess/cicero) comme « cerveau » : micro, VAD,
fin-de-tour sémantique, barge-in, TTS streaming. Or deux contraintes sont apparues au grill :
l'utilisateur ne veut **pas utiliser le GPU du PC** pour STT/TTS (tout cloud via API), et
l'existant possède déjà une chaîne `STT → Pi → TTS` éprouvée.

La recherche sur Cicero (README + source) a montré un **mauvais ajustement** :
- Son STT est **100% local** (`src/backends/stt/` = faster-whisper, mlx-whisper, audiocpp,
  wyoming) ; **aucun backend STT cloud**. Sa proposition de valeur est « your audio never
  leaves your machine » — l'inverse de la contrainte cloud.
- Son brain est un slot pluggable vers **ACP / CLI agents** (Claude Code, Codex, Gemini),
  **pas Pi**. Pi n'est aucun de ces backends → il faudrait quand même écrire tout le
  `pi-bridge` custom (composant B), en plus des adaptateurs voix.
- Son archi pèse WSL2 + Ollama (qwen3.5:4b) + faster-whisper + pocket-tts + ~3 Go de modèles,
  contre les deux contraintes (pas de GPU, pi natif Windows).

Parallèlement, l'écosystème Julien contient `2026.02 Pi Daemon` : un serveur HTTP headless
(`:8790`) qui fait déjà `STT → Pi → TTS` sur le SDK Pi, avec 8 providers STT cloud et 12
providers TTS, vérifié UP sur ce PC.

## Décision
Ne pas installer Cicero. La couche voix = réutilisation de **Pi Daemon** (endpoints HTTP
`/stt` et `/tts`, qui exposent tous les providers déjà câblés) **plus** une extension Pi
« pi-voice-bridge » (composant A) qui branche la **session Pi vivante** (pi-web) et ajoute le
WebSocket + la narration d'outils que Pi Daemon (headless) n'a pas.

Cicero est écarté sauf besoin explicite (lanes/office, notifications proactives, clonage de
voix, sidecar Telegram) — hors périmètre de la spec sous-titres + audio-description.

## Conséquences
- On ne réimplémente ni le STT cloud (composant C : déjà dans `stt.ts`), ni le TTS (déjà dans
  `tts.ts`), ni le brain (le SDK Pi fait déjà Pi). Ce qui manque : l'extension + le client.
- **Coût** : on hérite de la topologie pi-daemon (un service headless de plus à laisser tourner
  sur le PC) et de la latence d'aller-retour HTTP localhost pour la voix.
- **Ce qui devient plus difficile** : les fonctionnalités spécifiques à Cicero (lanes, clonage
  de voix, notifications proactives) ne sont pas disponibles sans réintroduire la brique.
- Le passage au local (parakeet/pocket-tts) reste possible en **v2** = un changement de provider
  (config `whisper-local` / `kokoro`), sans nouveau composant.

## Alternatives écartées
- **Cicero (garder)** : offre lanes/office/proactif, mais STT local uniquement (contre la
  contrainte cloud), brain ACP→Pi à écrire (déjà le composant B à faire), WSL2+Ollama à payer,
  et routeur + quick-intents + speculation à désactiver. Coût ≫ bénéfice hors périmètre.
- **Pont-mince custom sans aucun réutilisable** : réécrit VAD, EoT, reconnexion, streaming TTS
  que Pi Daemon fait déjà. Écarté : réutiliser ce qui existe.
