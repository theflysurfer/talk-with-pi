/** Critères du ticket #6 — voix de sortie : deux voix, ordre, erreur, barge-in. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { VoiceOut } from "./voice.ts";

interface Sent {
  header: Record<string, unknown>;
  bytes: number;
}

function make(opts: { fail?: number; delayMs?: number } = {}) {
  const sent: Sent[] = [];
  const errors: string[] = [];
  const bodies: any[] = [];
  const v = new VoiceOut({
    endpoint: "http://127.0.0.1:8791/v1/audio/speech",
    voices: { say: "voix-pi", narrate: "voix-description" },
    out: (header, audio) => sent.push({ header, bytes: audio.byteLength }),
    onError: (r) => errors.push(r),
    fetchImpl: (async (_url: string, init: any) => {
      bodies.push(JSON.parse(init.body));
      if (opts.delayMs) {
        await new Promise((r, reject) => {
          const t = setTimeout(r, opts.delayMs);
          init.signal.addEventListener("abort", () => {
            clearTimeout(t);
            reject(new Error("aborted"));
          });
        });
      }
      if (opts.fail) return { ok: false, status: opts.fail } as any;
      return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(8) } as any;
    }) as any,
  });
  return { v, sent, errors, bodies };
}

test("say → voix de Pi, narrate → voix de description", async () => {
  const { v, sent, bodies } = make();
  v.speak("say", "f1", "Bonjour.");
  v.speak("narrate", "f2", "Pi modifie login.ts");
  while (sent.length < 2) await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(bodies.map((b) => b.voice), ["voix-pi", "voix-description"]);
  assert.deepEqual(sent.map((s) => s.header.for), ["say", "narrate"]);
  assert.equal(sent[0]?.header.format, "pcm_s16le");
  assert.equal(sent[0]?.bytes, 8);
});

test("ordre préservé : une synthèse à la fois", async () => {
  const { v, sent } = make({ delayMs: 10 });
  v.speak("say", "f1", "Un.");
  v.speak("say", "f2", "Deux.");
  v.speak("say", "f3", "Trois.");
  while (sent.length < 3) await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(sent.map((s) => s.header.id), ["f1", "f2", "f3"]);
});

test("erreur TTS → error, pas de silence muet", async () => {
  const { v, sent, errors } = make({ fail: 502 });
  v.speak("say", "f1", "Bonjour.");
  while (errors.length < 1) await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(sent, []);
  assert.deepEqual(errors, ["tts 502"]);
});

test("barge-in : cancel vide la file et coupe la synthèse en cours", async () => {
  const { v, sent, errors } = make({ delayMs: 50 });
  v.speak("say", "f1", "Un.");
  v.speak("say", "f2", "Deux.");
  await new Promise((r) => setTimeout(r, 5));
  v.cancel();
  await new Promise((r) => setTimeout(r, 80));
  assert.deepEqual(sent, []);
  assert.deepEqual(errors, []);
  assert.equal(v.pending, 0);
});

test("texte vide → aucun appel TTS", () => {
  const { v, bodies } = make();
  v.speak("say", "f1", "   ");
  assert.deepEqual(bodies, []);
});
