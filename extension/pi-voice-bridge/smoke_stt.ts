import { readFileSync } from "node:fs";
import { WebSocket } from "ws";
import { VoiceBridge } from "./server.ts";
import { Stt } from "./stt.ts";

const wav = readFileSync(process.argv[2] ?? "/tmp/utt.wav");
const stt = new Stt({ endpoint: "http://127.0.0.1:8792/v1/audio/transcriptions" });
const injected: string[] = [];

const bridge = new VoiceBridge(8898, "tok", {
  onUserText(text) {
    injected.push(text);
  },
  async onAudio(audio, mime) {
    const text = await stt.transcribe(audio, mime);
    if (!text) throw new Error("transcription vide");
    bridge.emit({ type: "user_echo", text });
    injected.push(text);
    bridge.emit({ type: "state", phase: "working" });
  },
});

await new Promise((r) => setTimeout(r, 300));
const ws = new WebSocket(`ws://127.0.0.1:${bridge.port}`);
const frames: string[] = [];
ws.on("open", () => ws.send(JSON.stringify({ type: "hello", token: "tok" })));
ws.on("message", (data) => {
  const f = JSON.parse(String(data));
  frames.push(`${f.type} ${f.text ?? f.phase ?? f.reason ?? ""}`.trim());
  if (f.type === "ready") {
    ws.send(JSON.stringify({ type: "speech", mime: "audio/wav" }));
    ws.send(wav, { binary: true });
  }
});

setTimeout(async () => {
  for (const f of frames) console.log(f);
  console.log(`\ninjecté dans Pi : ${JSON.stringify(injected)}`);
  ws.close();
  await bridge.close();
  process.exit(injected.length === 1 && injected[0]!.length > 5 ? 0 : 1);
}, 30000);
