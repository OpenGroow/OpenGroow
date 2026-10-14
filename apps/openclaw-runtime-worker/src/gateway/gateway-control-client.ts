import http from "node:http";

export type GatewayControlResponse<TData> = {
  ok: boolean;
  error?: string;
  data?: TData;
};

export class GatewayControlClient {
  constructor(private readonly socketPath: string) {}

  async requestGatewayHealth(): Promise<{
    statusCode: number;
    body: string;
  }> {
    return await new Promise((resolve, reject) => {
      const request = http.request(
        {
          socketPath: this.socketPath,
          path: "/health",
          method: "GET",
        },
        (res) => {
          let raw = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => {
            raw += chunk;
          });
          res.on("end", () => {
            resolve({
              statusCode: res.statusCode ?? 500,
              body: raw,
            });
          });
        },
      );

      request.on("error", reject);
      request.end();
    });
  }

  async requestGatewayControl<TData>(
    path: string,
    body: Record<string, unknown>,
  ): Promise<TData> {
    const payload = JSON.stringify(body);
    let response: {
      statusCode: number;
      body: string;
    } | null = null;
    let lastError: unknown = null;

    for (let attempt = 0; attempt < 10; attempt += 1) {
      try {
        response = await new Promise<{
          statusCode: number;
          body: string;
        }>((resolve, reject) => {
          const request = http.request(
            {
              socketPath: this.socketPath,
              path,
              method: "POST",
              headers: {
                "content-type": "application/json; charset=utf-8",
                "content-length": Buffer.byteLength(payload),
              },
            },
            (res) => {
              let raw = "";
              res.setEncoding("utf8");
              res.on("data", (chunk) => {
                raw += chunk;
              });
              res.on("end", () => {
                resolve({
                  statusCode: res.statusCode ?? 500,
                  body: raw,
                });
              });
            },
          );

          request.on("error", reject);
          request.write(payload);
          request.end();
        });
        break;
      } catch (error) {
        lastError = error;
        const errno = (error as NodeJS.ErrnoException | undefined)?.code;
        if (
          error instanceof Error &&
          errno &&
          ["ENOENT", "ECONNREFUSED"].includes(errno)
        ) {
          if (attempt < 9) {
            await new Promise((resolve) => setTimeout(resolve, 500));
            continue;
          }
          throw new Error(
            `OpenClaw control socket unavailable at ${this.socketPath}. Verify the gateway is deployed with the latest image and the control socket server started.`,
          );
        }
        throw error;
      }
    }

    if (!response) {
      throw lastError instanceof Error
        ? lastError
        : new Error(`OpenClaw control socket request failed (${path})`);
    }

    let parsed: GatewayControlResponse<TData>;
    try {
      parsed = response.body
        ? (JSON.parse(response.body) as GatewayControlResponse<TData>)
        : { ok: false };
    } catch {
      throw new Error(`Invalid JSON from OpenClaw control socket (${path})`);
    }

    if (response.statusCode >= 400 || parsed.ok === false) {
      throw new Error(
        parsed.error || `OpenClaw control socket request failed (${path})`,
      );
    }

    return parsed.data as TData;
  }

  async applyWhatsAppConfig(
    phoneNumber: string,
    enabled?: boolean,
  ): Promise<void> {
    const result = await this.requestGatewayControl<{
      output: string;
      phoneNumber?: string;
    }>("/whatsapp/config", {
      phoneNumber,
      ...(enabled === undefined ? {} : { enabled }),
    });
    if (!result?.output) {
      throw new Error(
        "OpenClaw control socket returned an empty WhatsApp config response",
      );
    }
  }

  async approvePendingNode(requestId: string): Promise<{
    output: string;
    requestId: string;
  }> {
    return await this.requestGatewayControl<{
      output: string;
      requestId: string;
    }>("/nodes/approve", { requestId });
  }

  async checkNodes(): Promise<{ connectedCount: number; nodes: Array<{ displayName: string; caps: string[] }> }> {
    return await this.requestGatewayControl<{ connectedCount: number; nodes: Array<{ displayName: string; caps: string[] }> }>(
      "/nodes/check",
      {},
    );
  }

  async listPendingNodes(): Promise<{ legacy: string; relayRequestIds: string[] }> {
    return await this.requestGatewayControl<{ legacy: string; relayRequestIds: string[] }>(
      "/nodes/pending-list",
      {},
    );
  }

  async cleanupStaleNodes(): Promise<{ removedCount: number }> {
    return await this.requestGatewayControl<{ removedCount: number }>(
      "/nodes/cleanup-stale",
      {},
    );
  }
}
