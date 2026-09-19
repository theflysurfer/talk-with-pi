# pi-voice-bridge

Extension Pi (composant A du pont vocal) — parler à la session Pi vivante en marchant.

Couvre les tickets #1 (verrou + serveur WS base) et #2 (`user_text` → injection).

## Fichiers

- `server.ts` — serveur WebSocket 127.0.0.1 pur, protocole testable sans session Pi.
- `index.ts` — extension Pi : `/voice on|off|status`, verrou, injection, auto-réactivation.
- `server.test.ts` — tests du protocole au seam WebSocket (seam principal de la spec).

## Usage

```bash
# charger l'extension dans une session Pi vivante
pi -e ./extension/pi-voice-bridge/index.ts

# dans la session
/voice on          # prend le verrou ~/.pi/voice-bridge/active.json + écoute 127.0.0.1:8766
/voice status
/voice off

# côté client, envoyer un user_text (protocole JSON, token dans active.json)
# ws 127.0.0.1:8766 → hello {token} → ready → user_text → state working
```

`user_text` → `pi.sendUserMessage(text, { deliverAs: "followUp" })` : pendant un run Pi, la
parole est mise en file (followUp), elle ne coupe pas le run. Source distinguée
(`event.source === "extension"`), accusé `state phase=working`.

## Tests / vérifications

```bash
cd extension/pi-voice-bridge
node --experimental-strip-types --test server.test.ts   # 9/9
npx tsc                                                 # 0 erreur
```

## Variables d'environnement

- `PI_VOICE_BRIDGE_TOKEN` — token dédié (sinon généré et persisté dans active.json).
- `PI_VOICE_BRIDGE_PORT` — port (défaut 8766, libre — 8765 pris par edge-tts).
