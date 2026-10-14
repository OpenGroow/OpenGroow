# Internal Linking — Mission Instructions

## Internal Linking Workflow

This mission runs weekly via the scheduler. It builds internal links between recently published articles within each Cluster and opens a GitHub PR for human review.

### First run — generate PR

1. Determine `since` (YYYY-MM-DD):
   - If the mission payload contains a non-empty `since` field, use it (manual override).
   - Otherwise use `sinceDate` from your SEO Runtime Context (injected as today - 7 days).
   - Never ask the human for this value.
2. Call `generate_internal_links` with `since`.
3. The tool is **asynchronous** and returns immediately. **Do not poll** — write an `in_progress` RunResult and stop. OpenGroow polls the job and re-dispatches when done.

If `result.status === "blocked"` and `reason === "no_new_articles"`, write a `success` RunResult instead: no articles to process.

Otherwise (normal start or `already_pending`) — write this RunResult and stop:

```json
{
  "status": "in_progress",
  "summary": "Internal linking generation in progress — since <since>",
  "reviewQuestions": ["Is the internal linking PR ready to validate?"],
  "job": { "mcpServer": "article-mcp", "jobId": "<runId>", "jobType": "generate_internal_links" }
}
```

If `result.status === "blocked"` and `reason === "already_pending"`, use the returned `runId` as `jobId`.

### Second run — merge PR (triggered after human approval)

On the follow-up run (job completed), OpenGroow writes a `needs_human_review` RunResult so the human can review the GitHub PR diff. Once the human approves, a second follow-up run is dispatched.

The previous `artifact.external.id` contains the `jobId`. Call:

```
merge_internal_links({ jobId })
```

Write RunResult:

```json
{
  "status": "success",
  "summary": "Internal linking PR merged successfully."
}
```

## Blocked Responses

| Reason | Fix |
|--------|-----|
| `already_pending` | Write `in_progress` RunResult with the returned `runId` as `jobId` and stop — OpenGroow polls `get_internal_linking_status`, do not recreate |
| `no_new_articles` | No article published since `since` — write a `success` RunResult |
| `project_not_found` | The project resolved from the API key no longer exists — write a `failed` RunResult |

## Tools

The server exposes its tools via `POST /mcp` with the `Authorization: Bearer <api-key>` header.

---

### generate_internal_links

Runs in the background to generate internal links for articles published since `since`: article detection, LLM calls, commit, and opening a GitHub PR on the `internal-links/{since}` branch. **Asynchronous** — returns immediately with a `runId`. OpenGroow polls `get_internal_linking_status(runId)` on your behalf every 30 seconds until `completed` or `failed` — see `get_internal_linking_status` below and the workflow for the handoff. Idempotent: a second call with the same `since` returns a blocked `already_pending` case.

**Input**
| Field | Type | Required | Description |
|-------|------|-------------|-------------|
| `since` | string (YYYY-MM-DD) | yes | Start date of the window — typically today minus 7 days |

**Output (start)**

```json
{
  "runId": "<uuid>",
  "status": "started"
}
```

**Blocked cases**
| `reason` | Cause |
|----------|-------|
| `project_not_found` | The project resolved from the API key doesn't exist |
| `already_pending` | A job with this `since` is already pending — write `in_progress` RunResult with the returned `runId` as `jobId`; OpenGroow polls `get_internal_linking_status` |
| `no_new_articles` | No article published since `since` in this project — write a `success` RunResult |

---

### get_internal_linking_status

Returns the current state of a generation started by `generate_internal_links`. Called by OpenGroow (polling loop) — **the SEO runtime agent must not call this tool** directly.

**Input**
| Field | Type | Required | Description |
|-------|------|-------------|-------------|
| `runId` | UUID | yes | ID returned by `generate_internal_links` |

**Output (in progress)**

```json
{
  "runId": "<uuid>",
  "status": "running",
  "nextPollAfterSeconds": 30
}
```

**Output (completed)**

```json
{
  "runId": "<uuid>",
  "status": "completed",
  "output": {
    "jobId": "<uuid>",
    "prUrl": "<string>",
    "branchName": "internal-links/<since>",
    "articlesModified": 4,
    "linksAdded": 11
  }
}
```

**Output (failed)**

```json
{
  "runId": "<uuid>",
  "status": "failed",
  "error": "<string>"
}
```

---

### merge_internal_links

Merges the GitHub PR associated with the internal linking job (squash strategy) and updates the job status to `merged`.

**Input**
| Field | Type | Required | Description |
|-------|------|-------------|-------------|
| `jobId` | UUID | yes | Job ID returned by `generate_internal_links` |

**Output**

```json
{
  "jobId": "<uuid>",
  "status": "merged"
}
```

**Blocked cases**
| `reason` | Cause |
|----------|-------|
| `job_not_found` | The `jobId` is unknown |
| `already_merged` | The job is already merged — treat as success |
| `pr_not_mergeable` | The GitHub PR isn't in a mergeable state (conflicts, failing CI) |
