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

> ⚠️ Révisé le 2026-09-19 (ADR 0005) : ni Pi Daemon :8790 ni edge-tts :8765 n'étaient ce que ce
> tableau annonçait. Voir l'ADR pour la mesure. Les lignes ci-dessous sont à jour.

| Élément | Action | État |
|---|---|---|
| paseo-tts-proxy :8791 | TTS Cartesia (OpenAI `/v1/audio/speech`), deux voix par requête | ✅ up, LSM, auto_start |
| paseo-stt-proxy :8792 | STT Groq whisper (`/v1/audio/transcriptions`) | ✅ up, LSM, auto_start (UA corrigé) |
| Pi Daemon :8790 | hors chemin de la voix ; port libéré (Datasette déplacé sur :8794) | registré, à la demande |
| pi-web | `pi-web-server` :8504 + `pi-web-sessiond` :8505 (TCP), registrés et démarrés par LSM | ✅ up |
| extension pi-voice-bridge | `pi install` global → `/voice` dans toute session, verrou mono-session | ✅ installée |
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
✅ **Atteint le 2026-09-19** (`extension/pi-voice-bridge/smoke_e2e.ts`) : session Pi réelle en RPC,
`/voice on` → verrou :8766 → `hello`/`ready` → `user_text` → `state working` → `say` → 34 Ko d'audio.

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

1. ~~Port du WS extension~~ → **8766**, libre, en service.
2. ~~Pi Daemon en service LSM~~ → hors chemin de la voix (ADR 0005).
3. Voix Pi vs description → **Henri / Zoé** par défaut, **à valider à l'oreille par Julien**.
4. ~~pi-web : statut LSM + port~~ → :8504 + sessiond :8505, registrés, démarrés par LSM.
5. ~~STT Groq~~ → via paseo-stt-proxy :8792, transcription réelle vérifiée.
6. Descripteur : coût/latence réels de claude-haiku-4-5 sur un run de marche — **toujours ouvert**
   (testé sur faux modèle seulement).
7. Nouveau : le relais VPS (P3) et le client PWA restent à faire ; l'audio circule aujourd'hui en
   PCM brut (24 kHz mono) — à compresser avant de passer en 4G.
