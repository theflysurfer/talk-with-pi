/** Narration d'outils : gabarits FR, verbosité, regroupement 3 s (spec §Narration, ticket #4). */
import { maskSecrets, oralize } from "./oral.ts";

export type Verbosity = "silencieux" | "essentiel" | "bavard";

const RANK: Record<Verbosity, number> = { silencieux: 0, essentiel: 1, bavard: 2 };
const WINDOW_MS = 3000;
const MAX_NAMES = 4;

interface Template {
  one(name: string): string;
  many(count: number, list: string): string;
  plural: string;
  level: Verbosity;
}

const TEMPLATES: Record<string, Template> = {
  edit: {
    one: (n) => `Pi modifie ${n}`,
    many: (c, l) => `Pi a modifié ${c} fichiers : ${l}`,
    plural: "fichiers",
    level: "essentiel",
  },
  write: {
    one: (n) => `Pi écrit ${n}`,
    many: (c, l) => `Pi a écrit ${c} fichiers : ${l}`,
    plural: "fichiers",
    level: "essentiel",
  },
  read: {
    one: (n) => `Pi lit ${n}`,
    many: (c, l) => `Pi a lu ${c} fichiers : ${l}`,
    plural: "fichiers",
    level: "bavard",
  },
  run: {
    one: (n) => `Pi lance ${n}`,
    many: (c, l) => `Pi a lancé ${c} commandes : ${l}`,
    plural: "commandes",
    level: "essentiel",
  },
  search: {
    one: (n) => `Pi cherche ${n}`,
    many: (c, l) => `Pi a cherché ${c} fois : ${l}`,
    plural: "recherches",
    level: "bavard",
  },
  other: {
    one: (n) => `Pi utilise ${n}`,
    many: (c, l) => `Pi a utilisé ${c} outils : ${l}`,
    plural: "outils",
    level: "bavard",
  },
};

const VERB_OF: Record<string, keyof typeof TEMPLATES> = {
  edit: "edit",
  multiedit: "edit",
  patch: "edit",
  write: "write",
  create: "write",
  read: "read",
  ls: "read",
  bash: "run",
  powershell: "run",
  shell: "run",
  exec: "run",
  grep: "search",
  find: "search",
  search: "search",
  webfetch: "search",
  websearch: "search",
};

export function verbOf(toolName: string): keyof typeof TEMPLATES {
  return VERB_OF[toolName.toLowerCase()] ?? "other";
}

export function subjectOf(toolName: string, args: unknown): string {
  const a = (args ?? {}) as Record<string, unknown>;
  const raw =
    a.path ?? a.file_path ?? a.filePath ?? a.file ?? a.command ?? a.cmd ?? a.pattern ?? a.query ?? a.url;
  if (typeof raw !== "string" || !raw.trim()) return toolName;
  const clean = oralize(maskSecrets(raw.trim()));
  const words = clean.split(" ");
  return words.length > 8 ? `${words.slice(0, 8).join(" ")}…` : clean;
}

function join(names: string[]): string {
  if (names.length <= MAX_NAMES) return names.join(", ");
  const rest = names.length - MAX_NAMES;
  return `${names.slice(0, MAX_NAMES).join(", ")} et ${rest} autre${rest > 1 ? "s" : ""}`;
}

interface Group {
  verb: keyof typeof TEMPLATES;
  names: string[];
  since: number;
}

export class Narrator {
  verbosity: Verbosity = "essentiel";
  private group: Group | null = null;
  private queued: string[] = [];
  private saying = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly out: (text: string) => void;
  private readonly now: () => number;
  private readonly window: number;

  constructor(
    out: (text: string) => void,
    opts: { now?: () => number; window?: number } = {},
  ) {
    this.out = out;
    this.now = opts.now ?? Date.now;
    this.window = opts.window ?? WINDOW_MS;
  }

  start(toolName: string, args: unknown): void {
    const verb = verbOf(toolName);
    if (RANK[this.verbosity] < RANK[TEMPLATES[verb]!.level]) return;
    const name = subjectOf(toolName, args);
    const t = this.now();
    if (this.group && this.group.verb === verb && t - this.group.since < this.window) {
      this.group.names.push(name);
    } else {
      this.flush();
      this.group = { verb, names: [name], since: t };
    }
    this.arm();
  }

  end(toolName: string, isError: boolean, reason?: string): void {
    if (!isError) return;
    this.flush();
    const what = subjectOf(toolName, undefined);
    const why = reason ? oralize(maskSecrets(reason)).split(" ").slice(0, 12).join(" ") : what;
    this.emit(`Échec : ${why}`);
  }

  setVerbosity(level: string): Verbosity {
    if (level in RANK) this.verbosity = level as Verbosity;
    return this.verbosity;
  }

  sayActive(active: boolean): void {
    this.saying = active;
    if (active) return;
    const pending = this.queued;
    this.queued = [];
    for (const text of pending) this.out(text);
  }

  flush(): void {
    this.disarm();
    const g = this.group;
    this.group = null;
    if (!g) return;
    const tpl = TEMPLATES[g.verb]!;
    this.emit(g.names.length === 1 ? tpl.one(g.names[0]!) : tpl.many(g.names.length, join(g.names)));
  }

  close(): void {
    this.disarm();
    this.group = null;
    this.queued = [];
  }

  private emit(text: string): void {
    if (this.saying) this.queued.push(text);
    else this.out(text);
  }

  private arm(): void {
    this.disarm();
    this.timer = setTimeout(() => this.flush(), this.window);
    this.timer.unref?.();
  }

  private disarm(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
