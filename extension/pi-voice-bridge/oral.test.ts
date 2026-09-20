/** Critères du ticket #3 — sous-titres : segmentation, nettoyage oral, secrets, pas de troncature. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Subtitler, oralize, maskSecrets } from "./oral.ts";

function collect(deltas: string[]): string[] {
  const said: string[] = [];
  const s = new Subtitler((t) => said.push(t));
  for (const d of deltas) s.push(d);
  s.end();
  return said;
}

test("streaming → phrases émises au fil de l'eau", () => {
  const said: string[] = [];
  const s = new Subtitler((t) => said.push(t));
  s.push("Bonjour Julien. Je re");
  assert.deepEqual(said, ["Bonjour Julien."]);
  s.push("garde le fichier. Fini.");
  assert.deepEqual(said, ["Bonjour Julien.", "Je regarde le fichier.", "Fini."]);
  s.end();
  assert.equal(said.length, 3);
});

test("bloc de code → marqueur, jamais dit cru", () => {
  const said = collect(["Voici le patch.\n```ts\nconst a = 1;\nconst b = 2;\nfoo(a, b);\n```\nFini.\n"]);
  assert.deepEqual(said, ["Voici le patch.", "(bloc de code, 3 lignes)", "Fini."]);
  assert.ok(!said.some((t) => t.includes("const")));
});

test("fence diff → marqueur diff", () => {
  const said = collect(["```diff\n- vieux\n+ neuf\n```\n"]);
  assert.deepEqual(said, ["(diff, 2 lignes)"]);
});

test("tableau → marqueur", () => {
  const said = collect(["Résultats :\n| a | b |\n|---|---|\n| 1 | 2 |\nSuite.\n"]);
  assert.deepEqual(said, ["Résultats :", "(tableau, 3 lignes)", "Suite."]);
});

test("chemin → nom de base, URL → domaine", () => {
  assert.equal(oralize("J'ouvre src/auth/login.ts."), "J'ouvre login.ts.");
  assert.equal(oralize("Voir https://www.example.com/a/b?c=1 ici"), "Voir example.com ici");
  assert.equal(oralize("répondre oui/non"), "répondre oui/non");
});

test("markdown retiré, un item de puce = une phrase", () => {
  const said = collect(["## Titre\n- **premier** item\n- second `item`\n"]);
  assert.deepEqual(said, ["Titre", "premier item", "second item"]);
});

test("secret jamais émis à l'oral", () => {
  const key = ["sk", "ant", "api03", "abcdefghijklmnopqrstuvwxyz0123456789"].join("-");
  const said = collect([`La clé est ${key} et password: hunter2 voilà.\n`]);
  const all = said.join(" ");
  assert.ok(!all.includes(key));
  assert.ok(!all.includes("hunter2"));
  assert.ok(all.includes("(secret masqué)"));
  assert.ok(maskSecrets("Bearer abcdefghijklmnop").includes("(secret masqué)"));
});

test("pas de troncature : long paragraphe sans ponctuation entièrement rendu", () => {
  const words = Array.from({ length: 200 }, (_, i) => `mot${i}`);
  const said = collect([words.join(" ")]);
  assert.equal(said.join(" ").split(" ").length, words.length);
  assert.ok(said.length > 1);
});

test("texte complet conservé sur un run mixte", () => {
  const said = collect(["Un. Deux ", "trois. ", "Quatre"]);
  assert.deepEqual(said, ["Un.", "Deux trois.", "Quatre"]);
});
