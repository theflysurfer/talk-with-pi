/**
 * Seam principle — protocole WebSocket (ticket #1 + #2) testé sans session Pi.
 * Critères #2 : user_text → callback ; ack state working / error ; followUp par défaut.
 * Critères #1 : hello token → ready / mauvais token → close ; ping→pong ; 1 client.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { WebSocket } from "ws";
import { VoiceBridge, type BridgeCallbacks } from "./server.ts";

const TOKEN = "test-token-123";
let portCounter = 9000;

async function makeBridge(cb: Partial<BridgeCallbacks> = {}) {
  const bridge = new VoiceBridge(portCounter++, TOKEN, {
    onUserText() {},
    ...cb,
  });
  await new Promise((r) => {
    const wss = (bridge as any).wss;
    if (wss.address()) r(undefined);
    else wss.on("listening", r);
  });
  return bridge;
}

function connect(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.on("open", () => resolve(ws));
    ws.on("error", reject);
  });
}

function recv(ws: WebSocket, pred: (f: any) => boolean): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), 3000);
    ws.on("message", function onMsg(data) {
      const f = JSON.parse(String(data));
      if (pred(f)) {
        clearTimeout(timer);
        ws.off("message", onMsg);
        resolve(f);
      }
    });
  });
}

test("hello avec token valide → ready", async () => {
  const b = await makeBridge();
  const ws = await connect(b.port);
  ws.send(JSON.stringify({ type: "hello", token: TOKEN }));
  const ready = await recv(ws, (f) => f.type === "ready");
  assert.equal(ready.protocol, 1);
  ws.close();
  await b.close();
});

test("mauvais token → connexion fermée, pas de ready", async () => {
  const b = await makeBridge();
  const ws = await connect(b.port);
  const closed = new Promise((r) => ws.on("close", (code) => r(code)));
  ws.send(JSON.stringify({ type: "hello", token: "nope" }));
  assert.equal(await closed, 1008);
  await b.close();
});

test("ping → pong", async () => {
  const b = await makeBridge();
  const ws = await connect(b.port);
  ws.send(JSON.stringify({ type: "hello", token: TOKEN }));
  await recv(ws, (f) => f.type === "ready");
  ws.send(JSON.stringify({ type: "ping" }));
  const pong = await recv(ws, (f) => f.type === "pong");
  assert.ok(pong);
  ws.close();
  await b.close();
});

test("user_text → onUserText appelé AVANT l'accusé working", async () => {
  let seen: string | null = null;
  const b = await makeBridge({
    async onUserText(text) {
      seen = text; // marqueur: appelé avant l'ack (résolution asynchrone)
    },
  });
  const ws = await connect(b.port);
  ws.send(JSON.stringify({ type: "hello", token: TOKEN }));
  await recv(ws, (f) => f.type === "ready");
  ws.send(JSON.stringify({ type: "user_text", text: "quelle heure est-il ?" }));
  await recv(ws, (f) => f.type === "state" && f.phase === "working");
  assert.equal(seen, "quelle heure est-il ?");
  ws.close();
  await b.close();
});

test("user_text vide → state phase=error", async () => {
  const b = await makeBridge();
  const ws = await connect(b.port);
  ws.send(JSON.stringify({ type: "hello", token: TOKEN }));
  await recv(ws, (f) => f.type === "ready");
  ws.send(JSON.stringify({ type: "user_text", text: "   " }));
  const st = await recv(ws, (f) => f.type === "state");
  assert.equal(st.phase, "error");
  ws.close();
  await b.close();
});

test("onUserText qui rejette → state phase=error avec reason", async () => {
  const b = await makeBridge({
    onUserText() {
      throw new Error("injection échouée");
    },
  });
  const ws = await connect(b.port);
  ws.send(JSON.stringify({ type: "hello", token: TOKEN }));
  await recv(ws, (f) => f.type === "ready");
  ws.send(JSON.stringify({ type: "user_text", text: "boom" }));
  const st = await recv(ws, (f) => f.type === "state");
  assert.equal(st.phase, "error");
  assert.equal(st.reason, "injection échouée");
  ws.close();
  await b.close();
});

test("followUp par défaut : le callback injecté passe deliverAs followUp (= file si Pi occupé)", async () => {
  let delivered = false;
  const b = await makeBridge({
    onUserText() {
      delivered = true;
    },
  });
  // On vérifie au niveau index.ts que sendUserMessage reçoit { deliverAs: "followUp" };
  // ici on prouve que le serveur émet l'ack seulement après succès du callback.
  const ws = await connect(b.port);
  ws.send(JSON.stringify({ type: "hello", token: TOKEN }));
  await recv(ws, (f) => f.type === "ready");
  ws.send(JSON.stringify({ type: "user_text", text: "test file" }));
  await recv(ws, (f) => f.type === "state" && f.phase === "working");
  assert.equal(delivered, true);
  ws.close();
  await b.close();
});

test("1 client à la fois : le nouveau remplace l'ancien", async () => {
  const b = await makeBridge();
  const ws1 = await connect(b.port);
  ws1.send(JSON.stringify({ type: "hello", token: TOKEN }));
  await recv(ws1, (f) => f.type === "ready");
  const ws1Closed = new Promise((r) => ws1.on("close", (c) => r(c)));
  const ws2 = await connect(b.port);
  ws2.send(JSON.stringify({ type: "hello", token: TOKEN }));
  await recv(ws2, (f) => f.type === "ready");
  assert.equal(await ws1Closed, 1001);
  ws2.close();
  await b.close();
});

test("WS lié à 127.0.0.1 uniquement (hôte par défaut)", async () => {
  // le constructeur force { host: "127.0.0.1" }; on vérifie que l'adresse est locale.
  const b = await makeBridge();
  await new Promise((r) => {
    const wss = (b as any).wss;
    if (wss.address()) r(undefined);
    else wss.on("listening", r);
  });
  const addr = (b as any).wss.address();
  assert.ok(addr.address === "127.0.0.1");
  await b.close();
});
