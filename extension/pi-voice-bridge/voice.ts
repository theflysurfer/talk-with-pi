/** Voix de sortie : say/narrate → /v1/audio/speech → trames audio (spec §TTS, ticket #6). */

export type VoiceKind = "say" | "narrate";

export interface VoiceDeps {
  endpoint: string;
  voices: Partial<Record<VoiceKind, string>>;
  format?: string;
  sampleRate?: number;
  fetchImpl?: typeof fetch;
  out(header: Record<string, unknown>, audio: Uint8Array): void;
  onError(reason: string): void;
}

interface Job {
  kind: VoiceKind;
  id: string;
  text: string;
}

export class VoiceOut {
  private readonly deps: VoiceDeps;
  private readonly fetchImpl: typeof fetch;
  private queue: Job[] = [];
  private running = false;
  private inflight: AbortController | null = null;

  constructor(deps: VoiceDeps) {
    this.deps = deps;
    this.fetchImpl = deps.fetchImpl ?? fetch;
  }

  speak(kind: VoiceKind, id: string, text: string): void {
    if (!text.trim()) return;
    this.queue.push({ kind, id, text });
    if (!this.running) void this.pump();
  }

  cancel(): void {
    this.queue = [];
    this.inflight?.abort();
    this.inflight = null;
  }

  get pending(): number {
    return this.queue.length;
  }

  private async pump(): Promise<void> {
    this.running = true;
    try {
      for (let job = this.queue.shift(); job; job = this.queue.shift()) {
        await this.synth(job);
      }
    } finally {
      this.running = false;
    }
  }

  private async synth(job: Job): Promise<void> {
    const ctrl = new AbortController();
    this.inflight = ctrl;
    const voice = this.deps.voices[job.kind];
    try {
      const res = await this.fetchImpl(this.deps.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(voice ? { input: job.text, voice } : { input: job.text }),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        this.deps.onError(`tts ${res.status}`);
        return;
      }
      const audio = new Uint8Array(await res.arrayBuffer());
      if (ctrl.signal.aborted || audio.byteLength === 0) return;
      this.deps.out(
        {
          type: "audio",
          id: job.id,
          for: job.kind,
          voice: voice ?? "default",
          format: this.deps.format ?? "pcm_s16le",
          sampleRate: this.deps.sampleRate ?? 24000,
          bytes: audio.byteLength,
        },
        audio,
      );
    } catch (err) {
      if (!ctrl.signal.aborted) {
        this.deps.onError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (this.inflight === ctrl) this.inflight = null;
    }
  }
}
