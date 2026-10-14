import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";

type DockerEvent = {
  status?: string;
};

export function parseDockerEventLine(line: string): DockerEvent | null {
  try {
    const parsed: unknown = JSON.parse(line);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as DockerEvent;
  } catch {
    return null;
  }
}

export type DockerEventWatcherOptions = {
  containerName: string;
  onContainerStarted: () => Promise<void>;
  log: (message: string) => void;
  warn: (message: string) => void;
};

/** Watches the Docker daemon for the shared broker starting again. */
export class DockerEventWatcher {
  private child: ChildProcessByStdio<null, Readable, Readable> | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private stopped = false;
  private reconnectDelayMs = 1_000;

  constructor(private readonly options: DockerEventWatcherOptions) {}

  start(): void {
    if (this.child || this.stopped) return;
    this.spawnEventsProcess();
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.child?.kill();
    this.child = null;
  }

  private spawnEventsProcess(): void {
    if (this.stopped) return;

    const child = spawn(
      "docker",
      [
        "events",
        "--format",
        "{{json .}}",
        "--filter",
        "type=container",
        "--filter",
        `container=${this.options.containerName}`,
        "--filter",
        "event=start",
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    this.child = child;
    let buffer = "";

    child.stdout.on("data", (chunk: Buffer | string) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const event = parseDockerEventLine(line.trim());
        if (event?.status !== "start") continue;
        void this.options.onContainerStarted().catch((error: unknown) => {
          this.options.warn(
            `broker key resync after Docker start failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        });
      }
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      const message = chunk.toString().trim();
      if (message) this.options.warn(`docker events: ${message}`);
    });

    child.once("error", (error) => {
      this.options.warn(`docker events process failed: ${error.message}`);
    });

    child.once("close", (code, signal) => {
      if (this.child === child) this.child = null;
      if (this.stopped) return;
      this.options.warn(
        `docker events stopped${code === null ? ` by ${signal ?? "unknown signal"}` : ` with code ${code}`}; reconnecting`,
      );
      this.scheduleReconnect();
    });

    this.options.log(`watching Docker start events for ${this.options.containerName}`);
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.stopped) return;
    const delay = this.reconnectDelayMs;
    this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, 10_000);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.spawnEventsProcess();
    }, delay);
  }
}
