# OpenClaw agent runtime testing

This document records the fastest way to test an OpenClaw agent without creating a new OpenGroow mission from the dashboard.

Use this flow when debugging:

- provider/model request-shaping failures;
- template or tool policy failures;
- node/device execution failures;
- a specific mission run that already exists in a workspace.

## Run commands from the local gateway container

From the Docker config directory:

```bash
cd apps/openclaw-docker-config/docker
```

Run commands through the local gateway service:

```bash
docker compose --env-file .env -f docker-compose.yml -f docker-compose.local.yml exec -T openclaw-gateway <command>
```

This uses the same runtime environment as missions launched by OpenGroow, but avoids the dashboard and Convex dispatch loop while debugging.

## Minimal provider/template smoke test

Start with a tiny prompt. This isolates model/provider request failures from tool, device, or mission payload issues.

```bash
docker compose --env-file .env -f docker-compose.yml -f docker-compose.local.yml exec -T openclaw-gateway \
  openclaw agent \
    --agent <agent-id> \
    --session-id compat-check \
    --message 'Say ok only.' \
    --json \
    --timeout 60 \
    --model <provider>/<model>
```

Expected success signal:

- top-level `status` is `ok`;
- `result.meta.agentMeta.provider` is the provider you passed;
- `result.meta.agentMeta.model` is the model you passed;
- `result.meta.executionTrace.fallbackUsed` is `false`.

If this fails before any tool call, the problem is usually provider/model request shaping, model compatibility metadata, or prompt/tool schema size.

## Replay an existing mission run

Use the original run file and output path. This reruns the mission through the same agent/template instructions, but directly from the gateway:

```bash
docker compose --env-file .env -f docker-compose.yml -f docker-compose.local.yml exec -T openclaw-gateway \
  openclaw agent \
    --agent <agent-id> \
    --session-id mega-run-js75cdrnew8dbtg48g74hfwvss896xd9 \
    --message 'Read missions/jh71y9r934a7qzgg24nvhne5a9897anj/runs/js75cdrnew8dbtg48g74hfwvss896xd9.md. Follow the instructions there. On completion, write the RunResult to missions/jh71y9r934a7qzgg24nvhne5a9897anj/outputs/js75cdrnew8dbtg48g74hfwvss896xd9.json.' \
    --json \
    --timeout 3600
```

This is usually faster than manually creating a new mission in OpenGroow because it keeps:

- the same mission ID;
- the same run ID;
- the same workspace files;
- the same output contract.

## Inspect the session log

Agent session logs are stored under the agent name:

```bash
docker compose --env-file .env -f docker-compose.yml -f docker-compose.local.yml exec -T openclaw-gateway \
  sh -lc 'tail -n 80 /home/node/.openclaw/agents/<agent-id>/sessions/<session-id>.jsonl'
```

For a compact summary of the last events:

```bash
docker compose --env-file .env -f docker-compose.yml -f docker-compose.local.yml exec -T openclaw-gateway \
  sh -lc 'node - <<'"'"'NODE'"'"'
const fs = require("fs");
const p = "/home/node/.openclaw/agents/<agent-id>/sessions/<session-id>.jsonl";
const lines = fs.readFileSync(p, "utf8").trim().split(/\n/);
console.log("lines", lines.length);
for (const line of lines.slice(-8)) {
  const e = JSON.parse(line);
  const m = e.message || {};
  const parts = m.content || [];
  const texts = parts
    .filter((x) => x.type === "text")
    .map((x) => (x.text || "").replace(/\s+/g, " ").slice(0, 220));
  const calls = parts
    .filter((x) => x.type === "toolCall")
    .map((x) => `${x.name}:${((x.arguments && x.arguments.command) || "").slice(0, 120)}`);
  const thinking = parts
    .filter((x) => x.type === "thinking")
    .map((x) => (x.thinking || "").replace(/\s+/g, " ").slice(0, 220));
  console.log(JSON.stringify({
    ts: e.timestamp,
    role: m.role,
    tool: m.toolName,
    isError: m.isError,
    stop: m.stopReason,
    status: m.details && m.details.status,
    error: m.details && m.details.error,
    texts,
    calls,
    thinking,
  }));
}
NODE'
```

Replace `<session-id>` with the exact session ID, for example:

```text
mega-run-js75cdrnew8dbtg48g74hfwvss896xd9
```

## Node/device exec preflight

Before replaying a full mission that drives a paired node, verify the node can execute the Tool your Template needs (here `<tool> --help`):

```bash
docker compose --env-file .env -f docker-compose.yml -f docker-compose.local.yml exec -T openclaw-gateway \
  openclaw agent \
    --agent <agent-id> \
    --session-id exec-node-check \
    --message 'Run exactly one exec tool call on host=node node="My Computer" with command "<tool> --help" and timeout 15. Then report the stdout only.' \
    --json \
    --timeout 120
```

Expected success signal:

- the command output contains the Tool's usage text;
- `toolSummary.failures` is `0`.

If this fails with `SYSTEM_RUN_DENIED: approval required`, check the node helper config. The node-local OpenClaw state must include:

```json
{
  "tools": {
    "exec": {
      "security": "full",
      "ask": "off"
    }
  }
}
```
