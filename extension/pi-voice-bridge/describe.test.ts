/** Critères du ticket #5 — descripteur : latence 2,5 s, replaces, allowCode, budget. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Describer, buildPrompt, sanitize } from "./describe.ts";
import { Subtitler } from "./oral.ts";

interface Emitted {
  text: string;
  replaces?: string;
}

function make(opts: Partial<Parameters<typeof Describer.prototype.describe>> & Record<string, any> = {}) {
  const said: Emitted[] = [];
  const prompts: string[] = [];
  let clock = 0;
  const d = new Describer({
    complete: async (prompt, signal) => {
      prompts.push(prompt);
      if (opts.hang) {
        return new Promise<string>((_r, reject) => signal.addEventListener("abort", () => reject(new Error("abort"))));
      }
      return opts.answer ?? "deux tests échouent dans auth";
    },
    out: (text, replaces) => said.push({ text, replaces }),
    now: () => clock,
    timeoutMs: opts.timeoutMs ?? 50,
    budgetPerHour: opts.budgetPerHour ?? 60,
    allowCode: opts.allowCode ?? false,
  });
  return { d, said, prompts, tick: (ms: number) => (clock += ms) };
}

test("résultat d'outil → description dite", async () => {
  const { d, said } = make();
  await d.describe({ kind: "tool_result", tool: "bash", text: "FAIL auth.test.ts (2 failed)" });
  assert.deepEqual(said, [{ text: "deux tests échouent dans auth", replaces: undefined }]);
});

test("au-delà du délai → rien, le gabarit seul suffit", async () => {
  const { d, said } = make({ hang: true, timeoutMs: 20 });
  await d.describe({ kind: "tool_result", tool: "bash", text: "npm test output" });
  assert.deepEqual(said, []);
});

test("replaces : la description remplace le gabarit", async () => {
  const { d, said } = make({ allowCode: true });
  await d.describe({ kind: "code", text: "const a = 1;", lines: 1 }, "f42");
  assert.equal(said[0]?.replaces, "f42");
});

test("allowCode:false → aucun code envoyé au fournisseur", async () => {
  const { d, said, prompts } = make({ allowCode: false });
  await d.describe({ kind: "code", text: "const secretSauce = 1;", lines: 1 }, "f1");
  assert.deepEqual(said, []);
  await d.describe({ kind: "tool_result", tool: "read", text: "voici\n```ts\nconst secretSauce = 1;\n```\nfin" });
  assert.ok(!prompts.join(" ").includes("secretSauce"));
  assert.ok(prompts.join(" ").includes("(code retiré)"));
});

test("budget horaire : au-delà du plafond, plus d'appel", async () => {
  const { d, said, tick } = make({ budgetPerHour: 2 });
  const req = { kind: "tool_result" as const, tool: "bash", text: "sortie" };
  await d.describe(req);
  await d.describe(req);
  await d.describe(req);
  assert.equal(said.length, 2);
  tick(3_600_001);
  await d.describe(req);
  assert.equal(said.length, 3);
});

test("le prompt interdit code et markdown, et masque les secrets", () => {
  const p = buildPrompt({ kind: "tool_result", tool: "bash", text: "token: abcdef123456" }, 4000);
  assert.ok(p.includes("sans code"));
  assert.ok(!p.includes("abcdef123456"));
  assert.equal(sanitize("a\n```\ncode\n```\nb", true).includes("code"), true);
});

test("Subtitler rend le bloc brut au descripteur, jamais au say", () => {
  const said: string[] = [];
  const blocks: string[] = [];
  const s = new Subtitler(
    (t) => said.push(t),
    (b) => blocks.push(`${b.kind}:${b.lines}:${b.text}`),
  );
  s.push("Patch :\n```ts\nconst a = 1;\nconst b = 2;\n```\n");
  s.end();
  assert.deepEqual(said, ["Patch :", "(bloc de code, 2 lignes)"]);
  assert.deepEqual(blocks, ["code:2:const a = 1;\nconst b = 2;"]);
});
