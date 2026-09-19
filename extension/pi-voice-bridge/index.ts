/** Extension Pi du pont vocal : verrou, serveur WS, injection, sous-titres (voir README). */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { mkdir, writeFile, readFile, unlink, access } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { VoiceBridge } from "./server.ts";
import { Subtitler } from "./oral.ts";
import { Narrator } from "./narrate.ts";
import { Describer } from "./describe.ts";
import { VoiceOut } from "./voice.ts";
import { Stt } from "./stt.ts";

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
let subtitler: Subtitler | null = null;
let narrator: Narrator | null = null;
let describer: Describer | null = null;
let voice: VoiceOut | null = null;
let stt: Stt | null = null;
let frameSeq = 0;
let lastSayId = "";

function emitFrame(type: "say" | "narrate", text: string, replaces?: string): string {
  const id = `f${++frameSeq}`;
  bridge?.emit(replaces ? { type, id, text, replaces } : { type, id, text });
  voice?.speak(type, id, text);
  return id;
}

const VOICE_PI = "d9f4af15-c402-4f50-bbda-d8823d028d6a";
const VOICE_DESC = "b56a7171-86f0-42b6-b3fa-a316794aa4e0";

function makeVoice(): VoiceOut {
  return new VoiceOut({
    endpoint: process.env.PI_VOICE_BRIDGE_TTS_URL ?? "http://127.0.0.1:8791/v1/audio/speech",
    voices: {
      say: process.env.PI_VOICE_BRIDGE_VOICE_PI ?? VOICE_PI,
      narrate: process.env.PI_VOICE_BRIDGE_VOICE_DESC ?? VOICE_DESC,
    },
    out: (header, audio) => bridge?.emitAudio(header, audio),
    onError: (reason) => bridge?.emit({ type: "error", scope: "tts", reason }),
  });
}

function makeDescriber(ctx: ExtensionContext): Describer | null {
  const provider = process.env.PI_VOICE_BRIDGE_DESCRIBER_PROVIDER ?? "anthropic";
  const modelId = process.env.PI_VOICE_BRIDGE_DESCRIBER_MODEL ?? "claude-haiku-4-5";
  const model = ctx.modelRegistry.find(provider, modelId);
  if (!model) return null;
  return new Describer({
    allowCode: process.env.PI_VOICE_BRIDGE_ALLOW_CODE === "1",
    complete: async (prompt, signal) => {
      const answer = await ctx.modelRegistry.complete(
        model,
        { messages: [{ role: "user", content: prompt, timestamp: Date.now() }] },
        { signal },
      );
      return answer.content
        .map((part) => (part.type === "text" ? part.text : ""))
        .join(" ")
        .trim();
    },
    out: (text, replaces) => emitFrame("narrate", text, replaces),
  });
}

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
  if (existing && existing.pid === process.pid) {
    await unlink(ACTIVE).catch(() => {});
  }
  lock = null;
}

function errorText(result: unknown): string | undefined {
  if (typeof result === "string") return result;
  const r = (result ?? {}) as { output?: unknown; message?: unknown; error?: unknown };
  for (const v of [r.error, r.message, r.output]) if (typeof v === "string" && v.trim()) return v;
  return undefined;
}

function loadToken(): string {
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

  stt = new Stt({
    endpoint: process.env.PI_VOICE_BRIDGE_STT_URL ?? "http://127.0.0.1:8792/v1/audio/transcriptions",
    model: process.env.PI_VOICE_BRIDGE_STT_MODEL,
  });

  bridge = new VoiceBridge(port, token, {
    async onUserText(text: string) {
      pi.sendUserMessage(text, { deliverAs: "followUp" });
    },
    async onAudio(audio: Uint8Array, mime: string) {
      const text = (await stt!.transcribe(audio, mime)).trim();
      if (!text) {
        bridge?.emit({ type: "error", scope: "stt", reason: "transcription vide" });
        return;
      }
      bridge?.emit({ type: "user_echo", text });
      pi.sendUserMessage(text, { deliverAs: "followUp" });
      bridge?.emit({ type: "state", phase: "working" });
    },
    onSetVerbosity(level: string) {
      const applied = narrator?.setVerbosity(level);
      ctx.ui.notify(`verbosity → ${applied ?? level}`, "info");
    },
    onAbort() {
      voice?.cancel();
      ctx.ui.notify("abort reçu (barge-in)", "info");
    },
  });
  describer = makeDescriber(ctx);
  voice = makeVoice();
  subtitler = new Subtitler(
    (text) => {
      lastSayId = emitFrame("say", text);
    },
    (block) => {
      void describer?.describe({ kind: block.kind, text: block.text, lines: block.lines }, lastSayId);
    },
  );
  narrator = new Narrator((text) => emitFrame("narrate", text));
  return bridge.port;
}

async function stopBridge(): Promise<void> {
  subtitler = null;
  narrator?.close();
  narrator = null;
  describer = null;
  voice?.cancel();
  voice = null;
  stt = null;
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

  pi.on("message_update", (event) => {
    const delta = event.assistantMessageEvent;
    if (delta.type !== "text_delta") return;
    narrator?.sayActive(true);
    subtitler?.push(delta.delta);
  });

  pi.on("message_end", () => {
    subtitler?.end();
    narrator?.sayActive(false);
  });

  pi.on("tool_execution_start", (event) => {
    narrator?.start(event.toolName, event.args);
  });

  pi.on("tool_execution_end", (event) => {
    const text = errorText(event.result);
    narrator?.end(event.toolName, event.isError, text);
    if (!text || narrator?.verbosity === "silencieux") return;
    void describer?.describe({ kind: "tool_result", tool: event.toolName, text });
  });

  pi.on("session_start", async (event, ctx) => {
    const l = await readLock();
    if (!l) return;
    try {
      await access(ACTIVE, constants.F_OK);
    } catch {
      return;
    }
    if (event.reason === "reload" && l.sessionFile === ctx.sessionManager.getSessionFile()) {
      try {
        await startBridge(pi, ctx);
      } catch {
        return;
      }
    }
  });

  pi.on("session_shutdown", async () => {
    await stopBridge();
  });
}
