# Plan de livraison révisé — Pont vocal Pi

> Statut : révisé le 2026-09-19 (grill-with-docs, décisions ADR 0001-0004).
> Plan original : spec v0.4 §9. Écarts majeurs : hôte **natif Windows** (plus de WSL2),
> réseau **ZeroTier + relais VPS** (plus de Tailscale), cerveau **Pi Daemon + extension**
> (plus de Cicero), STT/TTS **cloud v1 / local v2** (plus de GPU).

## Architecture retenue

```
 Pixel 9 Pro (Chrome PWA, push-to-talk P0)
   │  HTTPS talk.srv759970.hstgr.cloud  (VPS nginx, cert LE valide)
   ▼
 ┌─ VPS (10.77.208.85, wildcard *.srv759970.hstgr.cloud) ─┐
 │   nginx reverse-proxy → 10.77.208.239:<port>  (zero-Tier)│
 └─────────────────────┬───────────────────────────────┘
                       │ ZeroTier mesh (10.77.208.x/24)
 ┌─────────────────────▼───────────────────────────────┐
 │  PC local (natif Windows)                             │
 │   pi-web (sessiond, manuel / LSM)                     │
 │   Pi session vivante ← extension pi-voice-bridge      │
 │      ├── WS 127.0.0.1:<port> (client localhost only)  │
 │      └── /stt /tts → Pi Daemon :8790  (providers)     │
 │   Pi Daemon :8790  (8 STT cloud + 12 TTS, déjà up)    │
 │   edge-tts :8765  (voix FR, déjà up)                  │
 └───────────────────────────────────────────────────────┘
```

- Relais VPS = la seule pièce qui s'ajoute à l'existant (1 vhost nginx), cert LE déjà en place.
- Rien à configurer côté Pixel en DNS : `talk.srv759970.hstgr.cloud` résout publiquement vers le
  VPS ; le relais fait le travail vers le PC.

## P0 — Environnement PC (natif)

| Élément | Action | État |
|---|---|---|
| Pi Daemon :8790 | tourne déjà (manueel). À envelopper en service persistant (LSM) pour la marche | up, à formaliser |
| edge-tts :8765 | up | up |
| pi-web | tourner `npm run start:sessiond` natif, ou enregistrer au LSM. Port + WS extension à choisir (8765 occupé par edge-tts) | à brancher |
| Relais VPS | vhost nginx `talk.srv759970.hstgr.cloud` → `10.77.208.239:<port>` + LE | à créer (rodé, ~30 min) |
| Veille / démarrage | PC éveillé sur secteur pendant la marche ; services relancés au boot | à poser |
| Zéro WSL2 | confirmé : Pi + Pi Daemon natifs | ✅ |

**Critère** : `https://talk.srv759970.hstgr.cloud` répond depuis le Pixel en 4G (page de status).

## P1 — Extension pi-voice-bridge : sous-titres + user_text

- `say` : `message_update` `text_delta` → segmentation phrase → TTS edge-tts (voix Pi).
- `user_text` : `pi.sendUserMessage(text, { deliverAs: "followUp" })`, source `extension`.
- Verrou `~/.pi/voice-bridge/active.json` (sessionFile, pid, since) ; `/voice on|off|status`.
- WS `127.0.0.1:<port>`, token distinct du token pi-web, 1 client, hello/ready.
- **Testable avec `wscat`** (pas de côté Android encore).

**Critère** : taper `wscat` → envoyer `user_text` → Pi répond → `say` arrive segmenté.

## P2 — Extension : narration + regroupement + verbosité

- `narrate` : `tool_execution_start/end` → gabarits FR (écrit/lit/lance/cherche/échec), verbosité
  silencieux|essentiel|bavard, regroupement 3 s (« Pi a modifié 3 fichiers : … »).

**Critère** : un run Pi avec edits déclenche des narrations à l'oral, sans secrets.

## P2b — Descripteur (audio-description par petit modèle)

- `ctx.modelRegistry.find("anthropic","claude-haiku-4-5")` + `complete(...)` **hors session**.
- Gabarit immédiat ; descripteur en parallèle (délai 2,5 s) ; `replaces` si avant lecture ;
  budget 60 calls/h ; `allowCode` configurable.

**Critère** : wscat → descriptions mesurées en latence, jamais de code au fournisseur si
`allowCode:false`.

## P3 — Client PWA Android (push-to-talk) + boucle de bout en bout

- Chrome PWA servie par le relais VPS ; push-to-talk (bouton à l'écran / bouton écouteur).
- Micro audio → WS → extension `/stt` (Pi Daemon, Groq) → user_text → Pi → say → `/tts`
  (edge-tts) → audio retour.
- Barge-in (P0) : couper la lecture TTS locale quand le bouton est enfoncé (jamais le run Pi).

**Critère** : conversation de bout en bout depuis le Pixel en 4G, voix Pi distincte des
descriptions, followUp pendant un run.

## P4 — STT cloud secours / bascule providers / VAD mains-libres (v1.1)

- Bascule STT/TTS par provider config (Pi Daemon) sans code.
- VAD + fin-de-tour sémantique côté client (v1.1 ; push-to-talk reste par défaut).

## P5 / P6 — Android : décision native conditionnelle

- **P5** : test écran verrouillé 20 min (4G↔wi-fi) via le PWA push-to-talk.
- **P6** : Expo + `@getpaseo/expo-two-way-audio` **seulement si** le PWA échoue sur écran
  verrouillé / bouton média / reprise réseau.

## Cibles latence (inchangées, sauf « premier son » : dépend du cloud)

| Mesure | Cible |
|---|---|
| Parole → accusé (working) | < 1,5 s |
| Premier token Pi → premier son | < 1,2 s (cloud — à valider) |
| Événement outil → narration | < 2 s |
| Fin outil → description | < 3,5 s sinon abandon |
| Barge-in → silence | < 300 ms (client-side) |

## Questions ouvertes restantes (à l'implémentation)

1. Port du WS extension (8765 occupé par edge-tts) → proposer 8766 ou résolver.
2. Pi Daemon : envelopper en service LSM permanent (marche = PC éveillé).
3. Voix edge-tts Pi vs description : à choisir par écoute (ex. Henri=Pi, Denise=description).
4. pi-web : statut LSM + port (default 8504).
5. STT Groq : config Pi Daemon (provider `openai-whisper` / endpoint compatible Groq) — à valider.
6. Descripteur : coût/latence réels de claude-haiku-4-5 sur un run de marche.
