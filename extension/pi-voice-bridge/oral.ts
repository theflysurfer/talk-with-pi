/** Sous-titres oraux : segmentation en phrases + nettoyage (spec §Sous-titres, ticket #3). */

const MASK = "(secret masqué)";
const MAX_BUFFER = 400;

const SECRETS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/g,
  /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{12,}/g,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{16,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bBearer\s+[A-Za-z0-9._-]{12,}/gi,
  /\b(?:password|passwd|mot de passe|secret|token|api[_-]?key)\b\s*[:=]\s*\S+/gi,
  /\b[0-9a-f]{32,}\b/gi,
];

export function maskSecrets(text: string): string {
  let out = text;
  for (const re of SECRETS) out = out.replace(re, MASK);
  return out;
}

const PATH = /(?:[A-Za-z]:)?[\w.~@-]*(?:[\\/][\w.~@-]+)+\/?/g;

function basename(candidate: string): string {
  const parts = candidate.split(/[\\/]/).filter(Boolean);
  const slashes = parts.length - 1;
  const last = parts[parts.length - 1] ?? candidate;
  const named = /\.[A-Za-z]\w{0,4}$/.test(last);
  if (!named && slashes < 2) return candidate;
  return last;
}

export function oralize(chunk: string): string {
  let t = maskSecrets(chunk);
  t = t.replace(/^\s*#{1,6}\s+/, "");
  t = t.replace(/^\s*>\s+/, "");
  t = t.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "");
  t = t.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1");
  t = t.replace(/`+([^`]*)`+/g, "$1");
  t = t.replace(/\*\*|__|~~|\*|(?<=\s)_|_(?=\s|$)/g, "");
  t = t.replace(/https?:\/\/([^\s/)]+)[^\s)]*/gi, (_m, host: string) => host.replace(/^www\./i, ""));
  t = t.replace(PATH, (m) => basename(m));
  return t.replace(/\s+/g, " ").trim();
}

function plural(n: number): string {
  return n > 1 ? `${n} lignes` : `${n} ligne`;
}

/** Consomme les text_delta d'un run Pi et rend des phrases prêtes à dire (un flux à la fois). */
export interface Block {
  kind: "code" | "diff";
  lines: number;
  text: string;
  marker: string;
}

export class Subtitler {
  private buf = "";
  private fence: string | null = null;
  private fenceLines = 0;
  private fenceText: string[] = [];
  private tableLines = 0;
  private readonly out: (text: string) => void;
  private readonly onBlock: ((block: Block) => void) | undefined;

  constructor(out: (text: string) => void, onBlock?: (block: Block) => void) {
    this.out = out;
    this.onBlock = onBlock;
  }

  push(delta: string): void {
    this.buf += delta;
    this.drain(false);
  }

  end(): void {
    this.drain(true);
  }

  private drain(final: boolean): void {
    for (let nl = this.buf.indexOf("\n"); nl !== -1; nl = this.buf.indexOf("\n")) {
      const line = this.buf.slice(0, nl);
      this.buf = this.buf.slice(nl + 1);
      this.line(line);
    }
    if (this.fence !== null) {
      if (final) {
        if (this.buf.trim()) {
          this.fenceLines += 1;
          this.fenceText.push(this.buf);
        }
        this.buf = "";
        this.closeFence();
      }
      return;
    }
    if (final) {
      this.flushTable();
      this.buf = this.sentences(this.buf, true);
      return;
    }
    if (this.tableLines > 0 || /^\s*(?:```|\||`)/.test(this.buf)) return;
    this.buf = this.sentences(this.buf, false);
    if (this.buf.length > MAX_BUFFER) {
      const sp = this.buf.lastIndexOf(" ");
      if (sp > 0) {
        this.say(this.buf.slice(0, sp));
        this.buf = this.buf.slice(sp + 1);
      }
    }
  }

  private line(line: string): void {
    if (this.fence !== null) {
      if (/^\s*```/.test(line)) {
        this.closeFence();
      } else {
        this.fenceLines += 1;
        this.fenceText.push(line);
      }
      return;
    }
    const fence = /^\s*```(\w*)/.exec(line);
    if (fence) {
      this.flushTable();
      this.fence = (fence[1] ?? "").toLowerCase();
      this.fenceLines = 0;
      this.fenceText = [];
      return;
    }
    if (/^\s*\|/.test(line)) {
      this.tableLines += 1;
      return;
    }
    this.flushTable();
    this.sentences(line, true);
  }

  private closeFence(): void {
    const diff = this.fence === "diff";
    const marker = `(${diff ? "diff" : "bloc de code"}, ${plural(this.fenceLines)})`;
    this.out(marker);
    this.onBlock?.({
      kind: diff ? "diff" : "code",
      lines: this.fenceLines,
      text: this.fenceText.join("\n"),
      marker,
    });
    this.fence = null;
    this.fenceLines = 0;
    this.fenceText = [];
  }

  private flushTable(): void {
    if (this.tableLines === 0) return;
    this.out(`(tableau, ${plural(this.tableLines)})`);
    this.tableLines = 0;
  }

  private sentences(text: string, all: boolean): string {
    const re = /[.!?…]["»')\]]?(?=\s|$)/g;
    let start = 0;
    for (let m = re.exec(text); m !== null; m = re.exec(text)) {
      const end = m.index + m[0].length;
      this.say(text.slice(start, end));
      start = end;
    }
    const rest = text.slice(start);
    if (all) {
      this.say(rest);
      return "";
    }
    return rest;
  }

  private say(chunk: string): void {
    const text = oralize(chunk);
    if (text) this.out(text);
  }
}
