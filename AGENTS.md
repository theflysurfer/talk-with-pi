# AGENTS.md — Talk with Pi (pont vocal)

Ce que l'agent doit savoir **d'avance** sur ce dépôt. L'état se mesure, il ne se recopie pas ici.

## Architecture en une phrase

Une extension Pi (`extension/pi-voice-bridge/`) branchée sur la session vivante expose un WebSocket
local ; elle transforme les évènements Pi en `say`/`narrate` (+ audio TTS) et l'audio du client en
`user_text` injecté. Le POURQUOI de chaque choix est dans `docs/decisions/` (ADR 0001-0005).

## Les endpoints STT/TTS ne sont PAS ceux du plan d'origine

ADR 0005 : le TTS est `127.0.0.1:8791` (proxy Cartesia) et le STT `127.0.0.1:8792` (proxy Groq),
pas Pi Daemon `/stt` `/tts` ni edge-tts. Un document antérieur à cet ADR qui dit « edge-tts :8765 »
ou « Pi Daemon :8790 » décrit un poste qui n'existe pas. Les deux proxys vivent dans le repo
« 2026.09 Paseo fork » et sont démarrés par le Local Server Manager.

## Imports TypeScript : l'extension `.ts` est obligatoire

`node --experimental-strip-types` et le loader de Pi résolvent en ESM strict : `import { X } from
"./server"` échoue (`ERR_MODULE_NOT_FOUND`) et l'extension ne charge pas du tout. Toujours
`"./server.ts"`. `tsconfig.json` porte `allowImportingTsExtensions`.

Corollaire : pas de *parameter property* (`constructor(private readonly x: T)`) — le mode
strip-only de Node refuse (`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`). Déclarer le champ puis l'affecter.

## `pi -p "/voice on"` n'exécute PAS la commande

En mode `--print`, une commande slash part au modèle comme du texte : aucun verrou n'est pris et
l'absence d'effet ressemble à un bug de l'extension. Pour exercer une commande hors TUI, passer par
le mode RPC (`pi --mode rpc`, une ligne JSON `{"type":"prompt","message":"/voice on"}` sur stdin) —
c'est ce que fait `extension/pi-voice-bridge/smoke_e2e.ts`.

## Les tests faux ne suffisent pas ici

Chaque ticket a un `*.test.ts` (rapide, sans réseau) ET un `smoke_*.ts` qui parle aux vrais
services. Un changement sur le TTS, le STT ou le protocole se prouve avec le smoke correspondant,
parce que les pannes rencontrées (UA rejeté par Cloudflare, socket Windows, port squatté) sont
invisibles aux tests faux.

## Un `/health` qui répond ne prouve pas le bon service

Le port 8790 rendait `ok`… depuis un Datasette qui squattait le port de Pi Daemon. Avant de bâtir
sur « X est up », appeler une route **métier** (une synthèse, une transcription), pas seulement
`/health`.

## Commandes

```bash
cd extension/pi-voice-bridge
node --experimental-strip-types --test *.test.ts    # tests unitaires
npx tsc                                             # typage
node --experimental-strip-types smoke_tts.ts        # TTS réel, deux voix
node --experimental-strip-types smoke_stt.ts <wav>  # STT réel
node --experimental-strip-types smoke_e2e.ts        # session Pi réelle de bout en bout
```

Le pont n'est pas un service LSM : il vit dans la session Pi, verrou `~/.pi/voice-bridge/active.json`.

<!-- fast-search-directive -->
## Recherche dans l'arbre

Ce dépôt vit sous Dropbox : `fast_search_grep_content` / `fast_search_find_files` plutôt que
`grep -r` ou `find` (100 à 4000× plus lents ici, et un `find` survit au timeout de l'outil).

## Skills liées

- `julien-local-servers-management-lsm` — pour tout service local (pi-web, proxys STT/TTS).
- `julien-adr` — un choix durable tranché ici se pose dans `docs/decisions/`.
