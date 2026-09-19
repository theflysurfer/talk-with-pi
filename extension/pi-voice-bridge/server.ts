/** Serveur WebSocket 127.0.0.1, protocole testable sans session Pi (spec §Protocole WS). */
import { WebSocketServer, WebSocket, type RawData } from "ws";

export interface BridgeCallbacks {
  onUserText(text: string): Promise<void> | void;
  onAbort?(): void;
  onSetVerbosity?(level: string): void;
}

export interface Wire {
  send(frame: object): void;
  close(code?: number, reason?: string): void;
}

interface Hello {
  type: "hello";
  token: string;
}
interface UserText {
  type: "user_text";
  text: string;
}
interface Ping {
  type: "ping";
}

export class VoiceBridge {
  private readonly wss: WebSocketServer;
  private client: WebSocket | null = null;
  private readonly token: string;
  private readonly cb: BridgeCallbacks;

  constructor(
    port: number,
    token: string,
    cb: BridgeCallbacks,
  ) {
    this.token = token;
    this.cb = cb;
    this.requestedPort = port;
    this.wss = new WebSocketServer({ host: "127.0.0.1", port });
    this.wss.on("connection", (socket) => this.admit(socket));
  }

  get port(): number {
    const addr = this.wss.address();
    if (typeof addr === "string" || addr === null) {
      return this.requestedPort;
    }
    return addr.port;
  }

  private readonly requestedPort: number;

  close(): Promise<void> {
    return new Promise((resolve) => {
      this.client?.close(1001, "voice off");
      this.wss.close(() => resolve());
    });
  }

  emit(frame: object): void {
    if (this.client?.readyState === WebSocket.OPEN) this.client.send(JSON.stringify(frame));
  }

  emitAudio(header: object, audio: Uint8Array): void {
    if (this.client?.readyState !== WebSocket.OPEN) return;
    this.client.send(JSON.stringify(header));
    this.client.send(audio, { binary: true });
  }

  private admit(socket: WebSocket): void {
    if (this.client && this.client.readyState === WebSocket.OPEN) {
      this.client.close(1001, "replaced");
    }
    this.client = socket;

    socket.on("message", (data) => this.onMessage(socket, data));
    socket.on("close", () => {
      if (this.client === socket) this.client = null;
    });
    socket.on("error", () => {
      if (this.client === socket) this.client = null;
    });
  }

  private onMessage(socket: WebSocket, raw: RawData): void {
    let frame: unknown;
    try {
      frame = JSON.parse(String(raw));
    } catch {
      socket.close(1007, "invalid json");
      return;
    }
    if (!frame || typeof frame !== "object") {
      socket.close(1007, "invalid frame");
      return;
    }

    switch ((frame as { type?: string }).type) {
      case "hello":
        this.hello(socket, frame as Hello);
        break;
      case "ping":
        socket.send(JSON.stringify({ type: "pong" }));
        break;
      case "user_text":
        this.userText(socket, frame as UserText);
        break;
      case "abort":
        this.cb.onAbort?.();
        break;
      case "set_verbosity":
        this.cb.onSetVerbosity?.((frame as { level?: string }).level ?? "");
        break;
      default:
        socket.close(1003, "unknown type");
    }
  }

  private hello(socket: WebSocket, frame: Hello): void {
    if (frame.token !== this.token) {
      socket.close(1008, "bad token");
      return;
    }
    socket.send(
      JSON.stringify({ type: "ready", port: this.port, protocol: 1 }),
    );
  }

  private userText(socket: WebSocket, frame: UserText): void {
    const text = (frame.text ?? "").trim();
    if (!text) {
      socket.send(JSON.stringify({ type: "state", phase: "error", reason: "empty text" }));
      return;
    }
    Promise.resolve()
      .then(() => this.cb.onUserText(text))
      .then(() => socket.send(JSON.stringify({ type: "state", phase: "working" })))
      .catch((err: unknown) =>
        socket.send(
          JSON.stringify({
            type: "state",
            phase: "error",
            reason: err instanceof Error ? err.message : String(err),
          }),
        ),
      );
  }
}
