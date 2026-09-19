# pi-voice-bridge

Extension Pi (composant A du pont vocal) — parler à la session Pi vivante en marchant.

Couvre les tickets #1 (verrou + serveur WS base), #2 (`user_text` → injection) et #3 (`say`,
sous-titres du texte de Pi).

## Fichiers

- `server.ts` — serveur WebSocket 127.0.0.1 pur, protocole testable sans session Pi.
- `oral.ts` — segmentation en phrases + nettoyage oral des `text_delta` (pur, sans WS).
- `index.ts` — extension Pi : `/voice on|off|status`, verrou, injection, sous-titres, auto-réactivation.
- `server.test.ts` / `oral.test.ts` — tests aux deux seams de la spec.

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

## Sous-titres (`say`)

`message_update` (`text_delta`) → `Subtitler` → trames `{ type: "say", text }` au fil du streaming.
Nettoyage oral : bloc de code/diff → `(bloc de code, N lignes)` / `(diff, N lignes)`, tableau →
`(tableau, N lignes)`, chemin → nom de base, URL → domaine, markdown et puces retirés, secrets →
`(secret masqué)`. Tampon forcé à 400 caractères, jamais de troncature. `message_end` vide le tampon.

Le descripteur (envoyer le bloc de code à un petit modèle) est le ticket #5, pas encore câblé :
le marqueur est dit, le contenu n'est jamais lu cru.

`user_text` → `pi.sendUserMessage(text, { deliverAs: "followUp" })` : pendant un run Pi, la
parole est mise en file (followUp), elle ne coupe pas le run. Source distinguée
(`event.source === "extension"`), accusé `state phase=working`.

## Tests / vérifications

```bash
cd extension/pi-voice-bridge
node --experimental-strip-types --test oral.test.ts server.test.ts   # 18/18
npx tsc                                                             # 0 erreur
```

## Variables d'environnement

- `PI_VOICE_BRIDGE_TOKEN` — token dédié (sinon généré et persisté dans active.json).
- `PI_VOICE_BRIDGE_PORT` — port (défaut 8766, libre — 8765 pris par edge-tts).
