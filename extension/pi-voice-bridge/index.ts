/**
 * pi-voice-bridge — parle à la session Pi vivante en marchant.
 *
 * Couvre tickets #1 (verrou + serveur WS base) et #2 (user_text → injection).
 *   - `/voice on|off|status` : prend/lâche/consulte le verrou active.json
 *   - serveur WS 127.0.0.1:<port> (token dédié, 1 client, hello/ready, ping/pong)
 *   - `user_text` → pi.sendUserMessage(text, { deliverAs: "followUp" }) + ack state
 *   - auto-réactivation au session_start si la session correspond au verrou
 *
 * Fichiers: ~/.pi/voice-bridge/active.json  { sessionFile, pid, since, port, token }
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { mkdir, writeFile, readFile, unlink, access } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { VoiceBridge } from "./server";

const DIR = join(homedir(), ".pi", "voice-bridge");
const ACTIVE = join(DIR, "active.json");
const DEFAULT_PORT = 8766;

interface Lock {
  sessionFile: string;
  pid: number;
  since: string;
  port: number;
  token: string;
}

let bridge: VoiceBridge | null = null;
let lock: Lock | null = null;

function sessionFileOf(ctx: ExtensionContext): string {
  return ctx.sessionManager.getSessionFile() ?? "";
}

async function readLock(): Promise<Lock | null> {
  try {
    return JSON.parse(await readFile(ACTIVE, "utf8")) as Lock;
  } catch {
    return null;
  }
}

async function pidAlive(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Take or refresh the lock, only if not held by a live foreign session. */
async function acquireLock(ctx: ExtensionContext, port: number, token: string): Promise<void> {
  const existing = await readLock();
  if (existing && existing.pid !== process.pid && (await pidAlive(existing.pid))) {
    throw new Error(`voix déjà active sur ${existing.sessionFile} (pid ${existing.pid})`);
  }
  lock = {
    sessionFile: sessionFileOf(ctx),
    pid: process.pid,
    since: new Date().toISOString(),
    port,
    token,
  };
  await writeFile(ACTIVE, JSON.stringify(lock, null, 2));
}

async function releaseLock(): Promise<void> {
  const existing = await readLock();
  // release only if we own it
  if (existing && existing.pid === process.pid) {
    await unlink(ACTIVE).catch(() => {});
  }
  lock = null;
}

function loadToken(): string {
  // distinct token (env override for tests), else persistent random
  const env = process.env.PI_VOICE_BRIDGE_TOKEN;
  if (env) return env;
  const stored = lock?.token;
  if (stored) return stored;
  return randomBytes(24).toString("hex");
}

async function startBridge(pi: ExtensionAPI, ctx: ExtensionContext): Promise<number> {
  const token = loadToken();
  const port = Number(process.env.PI_VOICE_BRIDGE_PORT) || DEFAULT_PORT;
  await mkdir(DIR, { recursive: true });
  await acquireLock(ctx, port, token);

  bridge = new VoiceBridge(port, token, {
    async onUserText(text: string) {
      // followUp par défaut : pendant un run Pi, mise en file (ne coupe pas).
      // steer seulement si une commande vocale explicite le demande (hors ticket #2).
      pi.sendUserMessage(text, { deliverAs: "followUp" });
    },
    onSetVerbosity(level: string) {
      ctx.ui.notify(`verbosity → ${level || "default"}`, "info");
    },
    onAbort() {
      ctx.ui.notify("abort reçu (barge-in)", "info");
    },
  });
  return bridge.port;
}

async function stopBridge(): Promise<void> {
  if (bridge) {
    await bridge.close();
    bridge = null;
  }
  await releaseLock();
}

export default function (pi: ExtensionAPI): void {
  pi.registerCommand("voice", {
    description: "Activer / désactiver / consulter le pont vocal (verrou + serveur WS)",
    handler: async (args, ctx) => {
      const action = (args || "").trim().split(/\s+/)[0] || "status";
      switch (action) {
        case "on":
          if (bridge) {
            ctx.ui.notify("pont déjà actif", "info");
            return;
          }
          try {
            const port = await startBridge(pi, ctx);
            ctx.ui.notify(`voix active sur 127.0.0.1:${port}`, "info");
          } catch (err) {
            ctx.ui.notify(`voix non activée: ${(err as Error).message}`, "error");
          }
          break;
        case "off":
          await stopBridge();
          ctx.ui.notify("voix coupée", "info");
          break;
        case "status":
        default: {
          const l = await readLock();
          if (!l) {
            ctx.ui.notify("voix inactive (pas de verrou)", "info");
          } else if (bridge) {
            ctx.ui.notify(`voix active sur :${bridge.port} (${l.sessionFile})`, "info");
          } else {
            ctx.ui.notify(`verrou distant: ${l.sessionFile} (pid ${l.pid})`, "info");
          }
        }
      }
    },
  });

  // Auto-réactivation au session_start : si cette session porte le verrou, on reprend.
  pi.on("session_start", async (event, ctx) => {
    const l = await readLock();
    if (!l) return;
    // own pid is alive => we own the bridge already; reloaded session => restart.
    try {
      await access(ACTIVE, constants.F_OK);
    } catch {
      return;
    }
    if (event.reason === "reload" && l.sessionFile === ctx.sessionManager.getSessionFile()) {
      try {
        await startBridge(pi, ctx);
      } catch {
        // lock still held by a live pid (self pre-reload) — leave as-is
      }
    }
  });

  pi.on("session_shutdown", async () => {
    await stopBridge();
  });
}
