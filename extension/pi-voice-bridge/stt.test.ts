/** Critères du ticket #7 — voix d'entrée : transcription injectée, erreur jamais muette. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { WebSocket } from "ws";
import { Stt } from "./stt.ts";
import { VoiceBridge } from "./server.ts";

const TOKEN = "tok-stt";

function fakeFetch(status: number, body: string) {
  const seen: { form?: FormData } = {};
  const impl = (async (_url: string, init: any) => {
    seen.form = init.body as FormData;
    return { ok: status < 400, status, text: async () => body } as any;
  }) as any;
  return { impl, seen };
}

test("audio → texte transcrit (champs Groq corrects)", async () => {
  const { impl, seen } = fakeFetch(200, JSON.stringify({ text: " Crée un scraper " }));
  const stt = new Stt({ endpoint: "http://127.0.0.1:8792/v1/audio/transcriptions", fetchImpl: impl });
  const text = await stt.transcribe(new Uint8Array([1, 2, 3]), "audio/webm");
  assert.equal(text, "Crée un scraper");
  assert.equal(seen.form?.get("model"), "whisper-large-v3-turbo");
  assert.equal(seen.form?.get("language"), "fr");
  assert.equal((seen.form?.get("file") as File).name, "parole.webm");
});

test("erreur STT → exception, jamais un silence", async () => {
  const { impl } = fakeFetch(401, "no key");
  const stt = new Stt({ endpoint: "http://x", fetchImpl: impl });
  await assert.rejects(() => stt.transcribe(new Uint8Array([1]), "audio/wav"), /stt 401/);
  await assert.rejects(() => stt.transcribe(new Uint8Array(), "audio/wav"), /audio vide/);
});

test("trame binaire sur le WS → transcription puis injection", async () => {
  const injected: string[] = [];
  const bridge = new VoiceBridge(0, TOKEN, {
    onUserText(text) {
      injected.push(text);
    },
    async onAudio(audio, mime) {
      assert.equal(mime, "audio/ogg");
      injected.push(`audio:${audio.byteLength}`);
    },
  });
  await new Promise((r) => setTimeout(r, 150));
  const ws = new WebSocket(`ws://127.0.0.1:${bridge.port}`);
  await new Promise((r) => ws.on("open", r));
  ws.send(JSON.stringify({ type: "hello", token: TOKEN }));
  await new Promise((r) => ws.on("message", r));
  ws.send(JSON.stringify({ type: "speech", mime: "audio/ogg" }));
  ws.send(Buffer.from([1, 2, 3, 4]), { binary: true });
  while (injected.length === 0) await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(injected, ["audio:4"]);
  ws.close();
  await bridge.close();
});

test("échec de transcription → trame error scope stt", async () => {
  const bridge = new VoiceBridge(0, TOKEN, {
    onUserText() {},
    async onAudio() {
      throw new Error("stt 502: groq down");
    },
  });
  await new Promise((r) => setTimeout(r, 150));
  const ws = new WebSocket(`ws://127.0.0.1:${bridge.port}`);
  await new Promise((r) => ws.on("open", r));
  ws.send(JSON.stringify({ type: "hello", token: TOKEN }));
  await new Promise((r) => ws.on("message", r));
  ws.send(Buffer.from([9]), { binary: true });
  const frame: any = await new Promise((r) => ws.on("message", (d) => r(JSON.parse(String(d)))));
  assert.equal(frame.type, "error");
  assert.equal(frame.scope, "stt");
  assert.match(frame.reason, /groq down/);
  ws.close();
  await bridge.close();
});
