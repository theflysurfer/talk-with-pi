# Talk with Pi — pont vocal

Parler à une session Pi **vivante** en marchant : entendre au fil du streaming ce que Pi écrit
(sous-titres), entendre ce qu'il fait (audio-description), et lui répondre à la voix — la parole
devenant un message utilisateur normal dans la même session.

## État

| Phase | Contenu | État |
|---|---|---|
| P1 | verrou + WS 127.0.0.1:8766, `user_text` → injection, `say` segmenté | ✅ prouvé en session réelle |
| P2 | `narrate` (gabarits FR, verbosité, regroupement 3 s) | ✅ |
| P2b | descripteur hors session (haiku, 2,5 s, budget, `allowCode:false`) | ✅ code, coût réel non mesuré |
| — | voix de sortie (2 voix) et voix d'entrée (STT Groq) | ✅ audio réel vérifié |
| P3 | relais VPS `talk.srv759970.hstgr.cloud` + client PWA push-to-talk | ⬜ à faire |
| P4+ | bascule providers, VAD mains-libres, décision app native | ⬜ |

## Composants

- `extension/pi-voice-bridge/` — l'extension Pi (le cerveau). Voir son [README](extension/pi-voice-bridge/README.md).
- `docs/spec.md` — la spec (problème, user stories, seams de test).
- `docs/PLAN_de_livraison.md` — le plan par paliers, à jour de la mesure des services.
- `docs/decisions/` — ADR 0001 à 0005.

## Services utilisés (aucun à écrire)

| Rôle | Endpoint | Moteur |
|---|---|---|
| TTS | `127.0.0.1:8791/v1/audio/speech` | Cartesia (Henri = Pi, Zoé = description) |
| STT | `127.0.0.1:8792/v1/audio/transcriptions` | Groq whisper-large-v3-turbo |
| UI sessions | `127.0.0.1:8504` (+ sessiond 8505) | pi-web |

Les trois sont pilotés par le Local Server Manager (`auto_start`). Le pont vocal, lui, vit **dans**
la session Pi : il n'est pas un service LSM, il écoute sur 8766 quand `/voice on` a été tapé.

## Démarrer

```bash
# dans une session Pi (l'extension est installée globalement)
/voice on        # prend le verrou, écoute 127.0.0.1:8766
/voice status
/voice off

# vérifier la chaîne complète sans client
cd extension/pi-voice-bridge
node --experimental-strip-types --test *.test.ts   # 43/43
node --experimental-strip-types smoke_e2e.ts       # vraie session Pi → say + audio
```
