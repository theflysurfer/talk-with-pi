---
numero: 0004
titre: Déploiement natif Windows + injection via sendUserMessage, pas WSL2
statut: accepté
date: 2026-09-19
concerne:
  - (composant A) extension pi-voice-bridge
  - (composant B) pont web-voice → session Pi vivante
---

# 0004 — Déploiement natif Windows + injection via sendUserMessage, pas WSL2

## Contexte
La spec initiale (§2bis) prévoyait **WSL2 + networkingMode=mirrored** pour faire cohabiter Pi,
pi-web, l'extension et la voix, parce que Tailscale (Windows) devait voir le localhost de WSL.
Or :
- Tailscale est **absent** (remplacé par ZeroTier + relais VPS, ADR 0002) → la raison d'être de
  WSL2 mirrored a disparu.
- Pi et Pi Daemon tournent **déjà en natif Windows** (vérifié : Pi session native, Pi Daemon
  `:8790` up sur 127.0.0.1, edge-tts `:8765` up).
- `pi-web status` n'est **pas supporté sur Windows** (ni systemd user ni LaunchAgent) → il tourne
  en natif manuel, ou géré par le Local Server Manager. WSL2 n'y change rien.

Le SDK Pi (docs extensions.md) fournit déjà la brique d'injection que la spec appelait composant B :
- `pi.sendUserMessage(text, { deliverAs: "followUp" | "steer" })`, avec `event.source ===
  "extension"` (distinguable d'une frappe clavier) — conforme à la spec §3.6.
- Événements mappés 1:1 : `message_update` (assistantMessageEvent.type `text_delta` → sous-titre),
  `tool_execution_start/end` (→ narration), `agent_start/end/settled` (→ état).
- `ctx.asIdle()`, `ctx.abort()`, `ctx.waitForIdle()` pour la politique busy.
- `ctx.modelRegistry.complete(model, messages)` pour le descripteur, **hors session** (ne consomme
  ni contexte ni run), avec `hasConfiguredAuth()` pour choisir le modèle.

## Décision
Pas de WSL2. Tout tourne **natif Windows** : Pi, pi-web (manuel ou LSM), Pi Daemon (STT/TTS, ADR
0001), edge-tts. L'extension `pi-voice-bridge` injecte la parole par `sendUserMessage` (followUp par
défaut, steer en commande explicite), narre les outils via les événements tool_, et décrit via
`modelRegistry.complete` hors session.

## Conséquences
- **Coût** : héritage de la topologie pi-daemon (service headless de plus), et la politique
  followUp signifie qu'une parole pendant un run Pi est mise en file (délai), pas immédiatement
  servie.
- **Ce qui devient plus facile** : aucun WSL2 à configurer, aucun mirrored networking, aucune
  surcouche container ; le déploiement réutilise LSM / services natifs existants.
- L'extension ne pilote que la session où `/voice on` a été tapé (verrou `active.json`), ce qui
  sécurise l'injection (token WS distinct du token pi-web).

## Alternatives écartées
- **WSL2 + mirrored** : contreproductif sans Tailscale ; ajoute une VM pour rien.
- **Cicero comme injection** : écarté à l'ADR 0001 ; son brain ne parle pas Pi, il faudrait
  réécrire le pont.
- **Injection par un process externe** : le SDK fournit déjà `sendUserMessage` dans l'extension
  liée à la session courante — nul besoin d'un second acteur.
