/** Critères du ticket #4 — narration : gabarits, verbosité, regroupement, file pendant un say. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Narrator } from "./narrate.ts";

function make(verbosity = "essentiel", window = 3000) {
  const said: string[] = [];
  let clock = 0;
  const n = new Narrator((t) => said.push(t), { now: () => clock, window });
  n.setVerbosity(verbosity);
  return { said, n, tick: (ms: number) => (clock += ms) };
}

test("gabarits FR au présent selon l'outil", () => {
  const { said, n } = make();
  n.start("edit", { path: "src/auth/login.ts" });
  n.flush();
  n.start("bash", { command: "npm test" });
  n.flush();
  assert.deepEqual(said, ["Pi modifie login.ts", "Pi lance npm test"]);
});

test("verbosité : read muet en essentiel, dit en bavard, rien en silencieux", () => {
  const essentiel = make("essentiel");
  essentiel.n.start("read", { path: "a.ts" });
  essentiel.n.flush();
  assert.deepEqual(essentiel.said, []);

  const bavard = make("bavard");
  bavard.n.start("read", { path: "a.ts" });
  bavard.n.flush();
  assert.deepEqual(bavard.said, ["Pi lit a.ts"]);

  const muet = make("silencieux");
  muet.n.start("edit", { path: "a.ts" });
  muet.n.flush();
  assert.deepEqual(muet.said, []);
});

test("même type dans la fenêtre de 3 s → fusionné", () => {
  const { said, n, tick } = make();
  n.start("edit", { path: "a.ts" });
  tick(1000);
  n.start("edit", { path: "b.ts" });
  tick(1000);
  n.start("edit", { path: "c.ts" });
  n.flush();
  assert.deepEqual(said, ["Pi a modifié 3 fichiers : a.ts, b.ts, c.ts"]);
});

test("hors fenêtre → deux narrations", () => {
  const { said, n, tick } = make();
  n.start("edit", { path: "a.ts" });
  tick(4000);
  n.start("edit", { path: "b.ts" });
  n.flush();
  assert.deepEqual(said, ["Pi modifie a.ts", "Pi modifie b.ts"]);
});

test("plus de 4 noms → « et N autres »", () => {
  const { said, n } = make();
  for (const f of ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts", "f.ts"]) n.start("write", { path: f });
  n.flush();
  assert.deepEqual(said, ["Pi a écrit 6 fichiers : a.ts, b.ts, c.ts, d.ts et 2 autres"]);
});

test("narration pendant un say → mise en file, jamais insérée au milieu", () => {
  const { said, n } = make();
  n.sayActive(true);
  n.start("edit", { path: "a.ts" });
  n.flush();
  assert.deepEqual(said, []);
  n.sayActive(false);
  assert.deepEqual(said, ["Pi modifie a.ts"]);
});

test("échec dit même en silencieux", () => {
  const { said, n } = make("silencieux");
  n.start("bash", { command: "npm test" });
  n.end("bash", true, "2 tests failed in auth");
  assert.deepEqual(said, ["Échec : 2 tests failed in auth"]);
});

test("succès ne produit pas de narration de fin", () => {
  const { said, n } = make();
  n.end("bash", false);
  assert.deepEqual(said, []);
});

test("secret dans une commande → jamais narré", () => {
  const { said, n } = make();
  n.start("bash", { command: "curl -H 'Authorization: Bearer abcdefghijklmnopqr' https://api.example.com" });
  n.flush();
  assert.ok(!said.join(" ").includes("abcdefghijklmnopqr"));
});
