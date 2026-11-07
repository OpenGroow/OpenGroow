#!/usr/bin/env node
/**
 * `pnpm hub:serve [hub folder] [--port 8787]`
 *
 * Serves a local checkout of the hub so a deployment on this machine can read
 * Publisher packages from it instead of GitHub (set OPENGROOW_HUB_URL):
 *
 *   GET /publishers.json, /index.json       -> <hub>/publishers.json, <hub>/index.json
 *   GET /releases/<tag>/<asset>.tgz         -> <hub>/dist/<asset>.tgz
 *
 * The product still verifies every download against the digest of the index,
 * and refuses any OPENGROOW_HUB_URL that is not a loopback host. Read-only,
 * two fixed routes, no directory listing.
 */
import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const INDEXES = new Set(["publishers.json", "index.json"]);
const ASSET = /^[\w][\w.-]*\.tgz$/;
const TAG = /^[\w][\w.+@-]*$/;

/** The file a request path maps to, or undefined (unknown route, or an unsafe name). */
export function fileFor(hubDir, pathname) {
  const index = pathname.slice(1);
  if (INDEXES.has(index)) return join(hubDir, index);
  const match = /^\/releases\/([^/]+)\/([^/]+)$/.exec(pathname);
  if (!match) return undefined;
  const [, tag, asset] = match.map((part) => (part ? decodeURIComponent(part) : part));
  if (!TAG.test(tag) || tag.includes("..") || !ASSET.test(asset) || asset.includes("..")) return undefined;
  return join(hubDir, "dist", asset);
}

export function createHubServer(hubDir) {
  return createServer((req, res) => {
    const { pathname } = new URL(req.url ?? "/", "http://localhost");
    const file = req.method === "GET" ? fileFor(hubDir, pathname) : undefined;
    if (!file || !existsSync(file)) {
      console.log(`404 ${req.method} ${pathname}`);
      res.writeHead(404).end();
      return;
    }
    console.log(`200 GET ${pathname}`);
    res.writeHead(200, { "content-type": file.endsWith(".json") ? "application/json" : "application/gzip" }).end(readFileSync(file));
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const base = process.env.INIT_CWD ?? process.cwd();
  const portAt = args.indexOf("--port");
  const port = portAt >= 0 ? Number(args[portAt + 1]) : 8787;
  const dir = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--port");
  const hubDir = resolve(base, dir ?? "../groowhub");
  if (!existsSync(hubDir)) {
    console.error(`ERROR no hub folder at ${hubDir}`);
    process.exit(1);
  }
  createHubServer(hubDir).listen(port, "0.0.0.0", () => {
    console.log(`Serving ${hubDir} on http://127.0.0.1:${port}`);
    console.log(`  host Convex (npx convex dev):  npx convex env set OPENGROOW_HUB_URL http://127.0.0.1:${port}`);
    console.log(`  Convex in Docker:              OPENGROOW_HUB_URL=http://host.docker.internal:${port}`);
  });
}
