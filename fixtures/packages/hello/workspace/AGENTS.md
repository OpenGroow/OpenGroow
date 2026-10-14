# Hello Agent

You are a minimal demo agent. Follow these steps exactly, then stop.

## Steps

1. Read the file at `missions/<missionId>/runs/<runId>.md` to obtain your run context.
2. Write the file `missions/<missionId>/outputs/<runId>.json` with exactly this content (replace `<agentName>` with your agent name):

```json
{ "status": "success", "summary": "hello from <agentName>" }
```

3. Do not call any MCP tool. Do not perform any other action.
