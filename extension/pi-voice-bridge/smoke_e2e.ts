import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";

const ACTIVE = join(homedir(), ".pi", "voice-bridge", "active.json");
const log = (...a: unknown[]) => console.log(...a);

const CLI = join(
  process.env.APPDATA ?? "",
  "npm/node_modules/@earendil-works/pi-coding-agent/dist/cli.js",
);
const pi = spawn(process.execPath, [CLI, "--mode", "rpc", "--no-session"], {
  stdio: ["pipe", "pipe", "pipe"],
  cwd: process.cwd(),
});
const send = (o: object) => pi.stdin.write(`${JSON.stringify(o)}\n`);
pi.stdout.on("data", (b) => {
  for (const line of String(b).split("\n")) {
    if (!line.trim()) continue;
    try {
      const f = JSON.parse(line);
      if (f.type === "response" || f.method === "notify") log("pi <-", (f.message ?? JSON.stringify(f)).toString().slice(0, 120));
    } catch {
      continue;
    }
  }
});
pi.stderr.on("data", (b) => log("pi stderr:", String(b).trim().slice(0, 200)));

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

send({ id: "1", type: "prompt", message: "/voice on" });

async function waitLock(timeoutMs: number): Promise<{ port: number; token: string }> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    try {
      return JSON.parse(await readFile(ACTIVE, "utf8"));
    } catch {
      if (Date.now() > until) throw new Error("verrou jamais pris");
      await wait(500);
    }
  }
}
const lock = await waitLock(60000);
log(`verrou pris : port ${lock.port}`);

const frames: string[] = [];
let audioBytes = 0;
const ws = new WebSocket(`ws://127.0.0.1:${lock.port}`);
ws.on("open", () => ws.send(JSON.stringify({ type: "hello", token: lock.token })));
ws.on("message", (data, isBinary) => {
  if (isBinary) {
    audioBytes += (data as Buffer).byteLength;
    frames.push(`audio binaire ${(data as Buffer).byteLength} octets`);
    return;
  }
  const f = JSON.parse(String(data));
  frames.push(`${f.type} ${f.text ?? f.phase ?? f.voice ?? ""}`.trim().slice(0, 90));
  if (f.type === "ready") {
    ws.send(JSON.stringify({ type: "user_text", text: "Réponds exactement: pong." }));
  }
});

await wait(40000);
send({ id: "2", type: "prompt", message: "/voice off" });
await wait(1500);
for (const f of frames) log(" ", f);
const says = frames.filter((f) => f.startsWith("say"));
log(`\n${says.length} say, ${audioBytes} octets d'audio`);
ws.close();
pi.kill();
process.exit(says.length > 0 && audioBytes > 0 ? 0 : 1);
