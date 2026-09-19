/** Descripteur : décrit à l'oral ce qui n'est pas lisible (spec §Descripteur, ticket #5). */
import { maskSecrets } from "./oral.ts";

export type DescribeKind = "code" | "diff" | "tool_result";

export interface Describable {
  kind: DescribeKind;
  text: string;
  tool?: string;
  lines?: number;
}

export interface DescriberDeps {
  complete(prompt: string, signal: AbortSignal): Promise<string>;
  out(text: string, replaces?: string): void;
  now?: () => number;
  timeoutMs?: number;
  budgetPerHour?: number;
  allowCode?: boolean;
  maxChars?: number;
}

const HOUR_MS = 3_600_000;

export function sanitize(text: string, allowCode: boolean): string {
  const masked = maskSecrets(text);
  if (allowCode) return masked;
  return masked.replace(/```[\s\S]*?(?:```|$)/g, "(code retiré)");
}

export function buildPrompt(req: Describable, maxChars: number, allowCode = false): string {
  const body = sanitize(req.text, allowCode).slice(0, maxChars);
  const what =
    req.kind === "tool_result"
      ? `résultat de l'outil ${req.tool ?? "inconnu"}`
      : req.kind === "diff"
        ? "diff"
        : "bloc de code";
  return [
    "Tu décris à l'oral, en français, pour quelqu'un qui marche et n'a pas d'écran.",
    `Voici un ${what}. Réponds par UNE phrase de 15 mots maximum, sans code, sans markdown,`,
    "sans guillemets, au présent. Dis ce qui compte, pas la forme.",
    "---",
    body,
  ].join("\n");
}

export class Describer {
  private readonly deps: DescriberDeps;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly budget: number;
  private readonly allowCode: boolean;
  private readonly maxChars: number;
  private calls: number[] = [];

  constructor(deps: DescriberDeps) {
    this.deps = deps;
    this.now = deps.now ?? Date.now;
    this.timeoutMs = deps.timeoutMs ?? 2500;
    this.budget = deps.budgetPerHour ?? 60;
    this.allowCode = deps.allowCode ?? false;
    this.maxChars = deps.maxChars ?? 4000;
  }

  async describe(req: Describable, replaces?: string): Promise<void> {
    if (!this.admits(req)) return;
    const ctrl = new AbortController();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const late = new Promise<null>((resolve) => {
      timer = setTimeout(() => {
        ctrl.abort();
        resolve(null);
      }, this.timeoutMs);
    });
    const call = Promise.resolve()
      .then(() => this.deps.complete(buildPrompt(req, this.maxChars, this.allowCode), ctrl.signal))
      .catch(() => null);
    try {
      const answer = await Promise.race([call, late]);
      if (typeof answer !== "string") return;
      const text = answer.replace(/\s+/g, " ").trim();
      if (text) this.deps.out(text, replaces);
    } finally {
      if (timer) clearTimeout(timer);
      ctrl.abort();
    }
  }

  private admits(req: Describable): boolean {
    if (!req.text.trim()) return false;
    if (!this.allowCode && req.kind !== "tool_result") return false;
    const t = this.now();
    this.calls = this.calls.filter((c) => t - c < HOUR_MS);
    if (this.calls.length >= this.budget) return false;
    this.calls.push(t);
    return true;
  }
}
