/** Voix d'entrée : audio du client → /v1/audio/transcriptions → texte (spec §STT, ticket #7). */

export interface SttDeps {
  endpoint: string;
  model?: string;
  language?: string;
  prompt?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

const EXT: Record<string, string> = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/mpeg": "mp3",
  "audio/mp4": "mp4",
  "audio/m4a": "m4a",
  "audio/flac": "flac",
};

export class Stt {
  private readonly deps: SttDeps;
  private readonly fetchImpl: typeof fetch;

  constructor(deps: SttDeps) {
    this.deps = deps;
    this.fetchImpl = deps.fetchImpl ?? fetch;
  }

  async transcribe(audio: Uint8Array, mime = "audio/webm"): Promise<string> {
    if (audio.byteLength === 0) throw new Error("audio vide");
    const form = new FormData();
    const type = mime.split(";")[0]!.trim().toLowerCase();
    form.append("file", new Blob([audio as BlobPart], { type }), `parole.${EXT[type] ?? "webm"}`);
    form.append("model", this.deps.model ?? "whisper-large-v3-turbo");
    form.append("language", this.deps.language ?? "fr");
    form.append("response_format", "json");
    if (this.deps.prompt) form.append("prompt", this.deps.prompt);

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.deps.timeoutMs ?? 20000);
    try {
      const res = await this.fetchImpl(this.deps.endpoint, {
        method: "POST",
        body: form,
        signal: ctrl.signal,
      });
      const raw = await res.text();
      if (!res.ok) throw new Error(`stt ${res.status}: ${raw.slice(0, 200)}`);
      const text = raw.trim().startsWith("{") ? ((JSON.parse(raw) as { text?: string }).text ?? "") : raw;
      return text.trim();
    } finally {
      clearTimeout(timer);
    }
  }
}
