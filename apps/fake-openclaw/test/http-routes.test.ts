import { describe, it, expect } from "vitest";
import { createServer, type Server } from "node:http";
import { handleRequest } from "../src/http-routes.js";

function startTestServer(): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer(handleRequest);
    server.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({ server, port });
    });
  });
}

function post(port: number, path: string, body: unknown): Promise<{ status: number; data: unknown }> {
  return fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  }).then(async (r) => ({ status: r.status, data: await r.json() }));
}

describe("POST /workspace/create", () => {
  it("returns 200 with workspaceKey in data", async () => {
    const { server, port } = await startTestServer();
    try {
      const { status, data } = await post(port, "/workspace/create", {
        workspaceKey: "seo-agent",
        label: "SEO Agent"
      });
      expect(status).toBe(200);
      expect(data).toMatchObject({
        ok: true,
        data: { workspaceKey: "seo-agent" }
      });
    } finally {
      server.close();
    }
  });

  it("returns 400 when workspaceKey is missing", async () => {
    const { server, port } = await startTestServer();
    try {
      const { status, data } = await post(port, "/workspace/create", { label: "SEO" });
      expect(status).toBe(400);
      expect(data).toMatchObject({ error: "workspaceKey is required" });
    } finally {
      server.close();
    }
  });

  it("returns 400 when label is missing", async () => {
    const { server, port } = await startTestServer();
    try {
      const { status, data } = await post(port, "/workspace/create", { workspaceKey: "seo-agent" });
      expect(status).toBe(400);
      expect(data).toMatchObject({ error: "label is required" });
    } finally {
      server.close();
    }
  });
});

describe("POST /workspace/file/write", () => {
  it("returns 200 with workspaceKey and filePath in data", async () => {
    const { server, port } = await startTestServer();
    try {
      const { status, data } = await post(port, "/workspace/file/write", {
        workspaceKey: "seo-agent",
        filePath: "NOTES.md",
        content: "# Tools"
      });
      expect(status).toBe(200);
      expect(data).toMatchObject({
        ok: true,
        data: { workspaceKey: "seo-agent", filePath: "NOTES.md" }
      });
    } finally {
      server.close();
    }
  });

  it("returns 400 when workspaceKey is missing", async () => {
    const { server, port } = await startTestServer();
    try {
      const { status, data } = await post(port, "/workspace/file/write", {
        filePath: "NOTES.md",
        content: "# Tools"
      });
      expect(status).toBe(400);
      expect(data).toMatchObject({ error: "workspaceKey is required" });
    } finally {
      server.close();
    }
  });

  it("returns 400 when filePath is missing", async () => {
    const { server, port } = await startTestServer();
    try {
      const { status, data } = await post(port, "/workspace/file/write", {
        workspaceKey: "seo-agent",
        content: "# Tools"
      });
      expect(status).toBe(400);
      expect(data).toMatchObject({ error: "filePath is required" });
    } finally {
      server.close();
    }
  });

  it("returns 400 when content is missing", async () => {
    const { server, port } = await startTestServer();
    try {
      const { status, data } = await post(port, "/workspace/file/write", {
        workspaceKey: "seo-agent",
        filePath: "NOTES.md"
      });
      expect(status).toBe(400);
      expect(data).toMatchObject({ error: "content is required" });
    } finally {
      server.close();
    }
  });
});

describe("POST /mcp/servers/merge", () => {
  it("returns 200 with merged keys", async () => {
    const { server, port } = await startTestServer();
    try {
      const { status, data } = await post(port, "/mcp/servers/merge", {
        servers: {
          "article-mcp": { url: "https://seo.example.com/mcp" },
          "image-mcp": { url: "https://img.example.com/mcp" }
        }
      });
      expect(status).toBe(200);
      expect(data).toMatchObject({
        ok: true,
        data: { mergedKeys: ["article-mcp", "image-mcp"] }
      });
    } finally {
      server.close();
    }
  });

  it("returns 400 when servers is missing", async () => {
    const { server, port } = await startTestServer();
    try {
      const { status, data } = await post(port, "/mcp/servers/merge", {});
      expect(status).toBe(400);
      expect(data).toMatchObject({ error: "servers is required" });
    } finally {
      server.close();
    }
  });
});

describe("POST /mcp/servers/remove", () => {
  it("returns 200 with removed keys", async () => {
    const { server, port } = await startTestServer();
    try {
      const { status, data } = await post(port, "/mcp/servers/remove", {
        keys: ["article-mcp"]
      });
      expect(status).toBe(200);
      expect(data).toMatchObject({
        ok: true,
        data: { removedKeys: ["article-mcp"] }
      });
    } finally {
      server.close();
    }
  });

  it("returns 400 when keys is missing or not an array", async () => {
    const { server, port } = await startTestServer();
    try {
      const { status, data } = await post(port, "/mcp/servers/remove", {});
      expect(status).toBe(400);
      expect(data).toMatchObject({ error: "keys is required" });
    } finally {
      server.close();
    }
  });
});
