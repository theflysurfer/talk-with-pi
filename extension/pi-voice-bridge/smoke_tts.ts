import { WebSocket } from "ws";
import { VoiceBridge } from "./server.ts";
import { Subtitler } from "./oral.ts";
import { VoiceOut } from "./voice.ts";

const HENRI = "d9f4af15-c402-4f50-bbda-d8823d028d6a";
const ZOE = "b56a7171-86f0-42b6-b3fa-a316794aa4e0";

const bridge = new VoiceBridge(8899, "tok", { onUserText() {} });
const voice = new VoiceOut({
  endpoint: "http://127.0.0.1:8791/v1/audio/speech",
  voices: { say: HENRI, narrate: ZOE },
  out: (h, a) => bridge.emitAudio(h, a),
  onError: (r) => console.log("ERREUR TTS:", r),
});

let seq = 0;
const emit = (type: "say" | "narrate", text: string) => {
  const id = `f${++seq}`;
  bridge.emit({ type, id, text });
  voice.speak(type, id, text);
};

const received: string[] = [];
await new Promise((r) => setTimeout(r, 300));
const ws = new WebSocket(`ws://127.0.0.1:${bridge.port}`);
ws.on("open", () => ws.send(JSON.stringify({ type: "hello", token: "tok" })));
ws.on("message", (data, isBinary) => {
  if (isBinary) {
    received.push(`binary ${(data as Buffer).byteLength} octets`);
    return;
  }
  const f = JSON.parse(String(data));
  received.push(`${f.type} ${f.text ?? f.voice ?? ""}`.trim());
  if (f.type === "ready") {
    const sub = new Subtitler((t) => emit("say", t));
    sub.push("Bonjour Julien, je lis le fichier src/auth/login.ts. ");
    sub.push("```ts\nconst a = 1;\n```\nVoilà.\n");
    sub.end();
    emit("narrate", "Pi modifie login point té esse");
  }
});

setTimeout(async () => {
  for (const line of received) console.log(line);
  const audio = received.filter((r) => r.startsWith("binary"));
  const headers = received.filter((r) => r.startsWith("audio"));
  console.log(`\n${headers.length} en-têtes audio / ${audio.length} trames binaires`);
  ws.close();
  await bridge.close();
  process.exit(audio.length >= 4 && audio.length === headers.length ? 0 : 1);
}, 25000);
