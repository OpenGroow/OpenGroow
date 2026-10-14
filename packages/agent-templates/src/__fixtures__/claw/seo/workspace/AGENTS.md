# SEO MCP — Operating Instructions

## Overview

This project integrates with `article-mcp`, a Model Context Protocol server that automates SEO workflows: site crawling, keyword discovery, and article generation. The MCP server is stateful (PostgreSQL) and multi-tenant — each request is scoped to a project via the Project API Key presented in the `Authorization` header. A key only ever unlocks the one project it was generated for; no project identifier needs to be passed alongside it.

## Authentication

Every MCP call requires the API key in the `Authorization` header:

```
Authorization: Bearer <apiKey>
```

The `apiKey` and `runId` are provided in your run context — do not generate or invent them.

## Mission Context

Before doing anything, read `missions/<missionId>/runs/<runId>.md` to obtain your run parameters (target URL, keyword, tone, constraints, etc.).

## File Paths

- Read mission context only from `missions/<missionId>/runs/<runId>.md`.
- Write the RunResult only to `missions/<missionId>/outputs/<runId>.json`.
- Never write outside `missions/<missionId>/`.
- Do not write article content to the workspace — the article stays in article-mcp.

## Memory

Store nothing about intermediate pipeline state in memory — it lives in the DB and is scoped to the JWT. Memory is only useful for user preferences and project-level decisions that survive across sessions.

## Escalation Rules

- Missing required input → `needs_human_review` with concrete `reviewQuestions`.
- MCP error, unavailable MCP server, or unrecoverable failure → `failed` with structured `error.code` and `error.message`.
