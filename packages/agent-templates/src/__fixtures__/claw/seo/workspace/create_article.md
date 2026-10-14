# Create Article — Mission Instructions

## Workflow

### Step 1 — Check project status

Always start by calling `get_project_status` to understand the current state of the project. Use the response to decide what to do next:

- `siteSnapshot` is `null` or `ageDays > 30` → run `analyze_site_content` first
- `keywordInventory.isStale` is `true` (no keywords, or older than 21 days) → run `discover_keyword_opportunities`
- `keywordInventory.isStale` is `false` → skip `discover_keyword_opportunities`, keywords are already fresh
- `articles.pendingKeywords > 0` → run `generate_article` for one of those keywords

### Step 2 — Refresh site snapshot (if needed)

Call `analyze_site_content` only if the site snapshot is missing or stale (> 30 days). This is expensive — do not call it if the snapshot is fresh.

It returns immediately with `{ "runId": "...", "status": "started" }`. The analysis runs in the background (~90 s).
Poll `get_analyze_status(runId)` every 30 seconds until `status` is `completed` or `failed`.
When `completed`, the `output` field contains `{ snapshotId, detectedTopics, contentGaps, brandSummary }`.
If `failed`, write a failed RunResult with the error message.

If `analyze_site_content` returns `{ "status": "blocked", "reason": "already_running", "runId": "..." }`,
poll `get_analyze_status` with the returned runId instead of starting a new one.

Do not retry `analyze_site_content` while an analysis is in progress.

### Step 3 — Discover keywords (if needed)

Call `discover_keyword_opportunities` only if `keywordInventory.isStale` is `true`. This is expensive (external API + LLM) — do not call it if the inventory is fresh.

The tool returns **immediately** with `{ "runId": "...", "status": "started" }`. The discovery runs in the background (~5 min — the LLM ranks hundreds of keyword candidates). Poll `get_discovery_status(runId)` every 30 seconds until `status` is `completed` or `failed`. Do not give up before 30 minutes have elapsed.

If the tool returns `{ "status": "blocked", "reason": "already_running", "runId": "..." }`, discovery is already running from a previous attempt — poll `get_discovery_status` with the returned `runId` instead of starting a new one.

Once `get_discovery_status` returns `completed`, proceed to Step 4. If it returns `failed`, write a failed RunResult with the error message.

Do not retry `discover_keyword_opportunities` while a discovery is in progress.

### Step 4 — Choose a keyword and plan the article

Call `list_keywords` to get the prioritized list of keywords that don't have an article yet (sorted by priority score descending).

If the response has `pendingHumanReview: true`, this Project's very first keyword batch is waiting for a human to validate it on article-mcp's own dashboard — a one-time gate, not an error. Do not choose a keyword and do not retry. Write a `blocked_external` RunResult with the declared blocker code, surfacing `message` and the resolution link from the response verbatim, and stop:

```json
{
  "status": "blocked_external",
  "summary": "Waiting for the first keyword batch to be validated on article-mcp's dashboard.",
  "blockerCode": "keyword_batch_pending",
  "message": "<message from list_keywords>",
  "resolution": {
    "kind": "link",
    "url": "<dashboardUrl from list_keywords>"
  }
}
```

Otherwise, choose a keyword:
- On the Mission's first pass through this step: if the mission payload contains a non-empty `keyword` string → find the best match in the list (case-insensitive). If no match is found, fall back to the highest-priority keyword and note the mismatch in the RunResult summary. If the payload `keyword` is empty or absent → pick the keyword with the highest `priorityScore`.
- When re-entering this step after switching keyword (Step 5, `poor_serp` case) → always pick the keyword with the highest `priorityScore` from this fresh `list_keywords` call, ignoring the payload's `keyword` (it was only a hint for the first attempt).

If `list_keywords` returns no candidate at all (empty list) when re-entering this step after switching keyword, there is nothing left to try — write the terminal `success` RunResult described in Step 5, listing every keyword excluded for `poor_serp` during this Mission.

Call `plan_article` with the chosen `keywordId`.

`plan_article` is **asynchronous** — it returns immediately with `{ "runId": "...", "status": "started" }`. Planning runs in the background (SERP research + LLM reasoning). **Do not poll `get_plan_status` yourself** — OpenGroow's poll engine owns that loop, exactly like `get_article_status` for `generate_article`. Write an `in_progress` RunResult and stop:

```json
{
  "status": "in_progress",
  "summary": "Article planning in progress — keyword: <keyword>",
  "reviewQuestions": ["Is the article plan relevant?"],
  "job": { "mcpServer": "article-mcp", "jobId": "<runId>", "jobType": "plan_article" }
}
```

OpenGroow resumes the Mission with a fresh Run once `plan_article` reaches `completed` or `skipped` — go to Step 5. There is no human review at this stage: OpenGroow never turns this into a `needs_human_review` Mission by itself, the Agent is always the one that decides what happens next.

### Step 5 — Judge the plan, revise, or move on to generation

On the Run that resumes after `plan_article` (or a subsequent revision), read the `## Last Intermediate Result` section of `missions/<missionId>/context.md`. It carries `{ "jobType": "plan_article", "output": { "status": "planned", "articlePlan": {...}, "evidence": {...}, "warnings": [...] } }` when a plan was produced, or `{ "jobType": "plan_article", "output": { "status": "blocked", "reason": "...", "explanation": "..." } }` when planning was blocked — OpenGroow forwards the full `output` sub-field of `get_plan_status`, which is itself the full `plan_article` result (discriminated by `status`), not just the nested plan.

Branch on `output.status`:

- **`"planned"` and you judge the plan valid** — proceed to Step 6 (`generate_article`) using `output.articlePlan`.
- **`"planned"` but you judge the plan invalid or improvable** — call `plan_article` again with `previousArticlePlan` set to the **entire `output` object you just read** (it already has the `status: "planned"`, `articlePlan`, `evidence`, `warnings` shape the tool expects — pass it through unchanged) and `planFeedback` set to your own critique (what's wrong, what should change). Write the same `in_progress` RunResult shape as Step 4 (new `runId`, `jobType: "plan_article"`) and stop. There is no cap on how many times you may loop through this revision — keep revising until you're satisfied with the plan.
- **`"blocked"` and `output.reason` ∈ `{ "serp_unavailable" }` (retryable)** — either call `plan_article` again the same way as a revision (with `planFeedback` explaining the blocker and any adjustment, e.g. a different angle or a broader query), or use your own judgment to try a different keyword/angle. Write the same `in_progress` handoff and stop.
- **`"blocked"` and `output.reason` ∈ `{ "ambiguous_intent", "out_of_scope" }` (non-retryable for *this* keyword, keyword auto-excluded)** — do not call `plan_article` again with this `keywordId`. article-mcp has already excluded this keyword (`excludedReason: "poor_serp"`) as a side effect of this response — it will not resurface via `list_keywords`. Instead, switch keyword within the same Mission: call `list_keywords` again (Step 4) and repeat from there with the next-highest-priority candidate it returns (it won't include the one just excluded). Keep switching through the full list this way — exhaust every candidate `list_keywords` offers — before giving up. Only once `list_keywords` returns no candidate left to try, write a **terminal `success`** RunResult: this is not an error, no keyword in the current inventory has a viable editorial angle right now. Set `summary` to explain that every remaining candidate was tried and list the ones auto-excluded for `poor_serp` in this Mission — any of them can be restored on article-mcp's dashboard if a human disagrees.
- **`"blocked"` and `output.reason` ∈ `{ "unsupported_content_type" }` (non-retryable, not excluded)** — do not call `plan_article` again. Write your own **terminal** RunResult (`needs_human_review` if a human should look at why this keyword can't be planned, or `failed` if it's a clear dead end) explaining the blocker in `summary`/`error`. This ends the Mission like any other terminal outcome — there is no human-in-the-loop for the planning step itself, only for the Mission's own end state.

### Step 6 — Generate article

Call `generate_article` with the chosen `keywordId` and `articlePlan` set to `output.articlePlan` from the planned result read in Step 5.

It returns immediately with `{ "runId": "...", "status": "started" }`. The generation runs in the background (~4 min). **Do not poll** — write an `in_progress` RunResult and stop immediately. OpenGroow owns the polling loop.

Write the following RunResult and stop:

```json
{
  "status": "in_progress",
  "summary": "Article generation in progress — keyword: <keyword>",
  "reviewQuestions": ["Is the article ready to publish?"],
  "job": { "mcpServer": "article-mcp", "jobId": "<runId>", "jobType": "generate_article" }
}
```

If `generate_article` returns `{ "status": "blocked", "reason": "article_generating", "runId": "..." }`,
write the same `in_progress` RunResult with the returned `runId` as `jobId`.

### Step 7 — Revision run (when human feedback is present)

If your run file (`missions/<missionId>/runs/<runId>.md`) contains a `## Human Feedback` section, this is a **revision run**: a human reviewed the article and rejected it with concrete feedback. Do **not** generate a new article — revise the existing one:

1. Take the `articleId` from the mission context (`artifact.external.id` of the previous run).
2. Call `revise_article` with that `articleId` and the verbatim text of the `## Human Feedback` section as `feedback`.
3. `revise_article` is synchronous and idempotent — it returns `{ "articleId", "status": "revised" }`. If the feedback covers several independent changes, you may call `revise_article` again (it re-revises from the latest version) until the article addresses every point of the feedback.
4. When satisfied, write a `needs_human_review` RunResult with `artifact.kind`, `artifact.external.service`, `artifact.external.id` (the `articleId`), and `artifact.metadata`. The mission transitions back to `to_validate` for another round of human review.

```json
{
  "status": "needs_human_review",
  "summary": "Article revised — awaiting human review.",
  "reviewQuestions": ["Is the article ready to publish?"],
  "artifact": {
    "kind": "markdown",
    "external": { "service": "article-mcp", "id": "<articleId>" },
    "metadata": { "keyword": "<keyword>", "title": "<title>" }
  }
}
```

If `revise_article` returns `{ "status": "blocked", "reason": "article_not_found" }`, the `articleId` is wrong — write a `failed` RunResult explaining the missing article.

## Blocked Responses

If a tool returns `{ "status": "blocked", "reason": "..." }`, resolve the blocker before proceeding:

| Reason                    | Fix                                                                                             |
| ------------------------- | ----------------------------------------------------------------------------------------------- |
| `project_not_initialized` | The `seo_projects` row for this project does not exist                                          |
| `site_snapshot_missing`   | Run `analyze_site_content` first                                                                |
| `already_running`         | Analysis or discovery is already in progress — poll `get_analyze_status(runId)` or `get_discovery_status(runId)` |
| `article_generating`      | Generation already in progress — write `in_progress` RunResult with the returned `runId` as `jobId` and stop |
| `article_draft`           | Article already exists for that keyword — keyword is covered, skip it                         |
| `article_failed`          | Generation failed previously, non-retriable — skip this keyword                               |

## RunResult

Write the final RunResult JSON to `missions/<missionId>/outputs/<runId>.json` when the mission is complete.

Hand off to OpenGroow's polling loop using the same shape as Step 6.

For other missions that need human input:

```json
{
  "status": "needs_human_review",
  "summary": "Explain what input is missing.",
  "reviewQuestions": ["Concrete question the human can answer."]
}
```

```json
{
  "status": "failed",
  "summary": "Explain what failed.",
  "error": {
    "code": "MCP_TOOL_ERROR",
    "message": "Concrete failure message."
  }
}
```

For an external human-review blocker (e.g. `list_keywords` returning `pendingHumanReview: true` — see Step 4), write `blocked_external` instead — this is a normal, non-error outcome, not a `failed` Mission:

```json
{
  "status": "blocked_external",
  "summary": "Explain what's blocked and where.",
  "blockerCode": "keyword_batch_pending",
  "message": "Verbatim message from the MCP tool.",
  "resolution": {
    "kind": "link",
    "url": "Verbatim dashboardUrl from the MCP tool."
  }
}
```

## Tools

The server exposes its tools via `POST /mcp` with the `Authorization: Bearer <api-key>` header.

### Nominal flow

Every tool call is scoped to a project by the Project API Key in the `Authorization` header — a key only ever unlocks the one project it was generated for. No tool takes a project identifier as input. Project creation and provider configuration (GitHub publisher, indexer, Search Console, social scheduler) happen exclusively on article-mcp's own dashboard, outside the MCP surface — there is no provisioning tool for the runtime agent or OpenGroow to call.

```
analyze_site_content
  → discover_keyword_opportunities
      → list_keywords
        → plan_article (once per keyword, asynchronous)
          → get_plan_status (polling until completed / skipped / failed — OpenGroow polls, not the agent)
            → plan_article (retried with previousArticlePlan + planFeedback, if the plan is judged invalid or revisable)
            → generate_article (once the plan is judged valid, asynchronous)
              → get_article_status (polling until completed / failed)
                → revise_article (revision loop on human feedback, optional)
                → publish_article (publication, mock V1)

get_article_content   ← called by OpenGroow (dashboard), not by the runtime agent
```

---

### ping

Checks that the API key is valid. Returns the associated `userId`.

**Input**: none

**Output**

```
<userId> (string)
```

---

### analyze_site_content

Crawls the site associated with the project, analyzes its SEO content, and stores a snapshot. Re-run if the snapshot is more than 30 days old (a warning is then included in the response).

**Input**
| Field | Type | Required | Description |
|-------|------|-------------|-------------|
| `maxPages` | integer (1–50) | no (default: 20) | Max number of pages to crawl |
| `externalContext` | object | no | Traceability metadata (see below) |

**`externalContext` (optional)**
| Field | Type | Description |
|-------|------|-------------|
| `provider` | string | Name of the external provider |
| `externalProjectId` | string | Project ID on the provider's side |
| `externalMissionId` | string | Mission ID on the provider's side |
| `externalRunId` | string | Run ID on the provider's side |
| `missionType` | string | Mission type |

**Output**

```json
{
  "seoExecutionId": "<uuid>",
  "snapshotId": "<uuid>",
  "detectedTopics": ["<string>"],
  "contentGaps": ["<string>"],
  "brandSummary": "<string>",
  "warnings": ["<string>"] // present only if the existing snapshot is > 30 days old
}
```

**Blocked cases**
| `reason` | Cause |
|----------|-------|
| `project_not_found` | The project resolved from the API key doesn't exist |

---

### discover_keyword_opportunities

From the latest snapshot, generates keyword ideas via DataForSEO, filters and stores the best opportunities. Requires a prior snapshot (`analyze_site_content`).

**Input**
| Field | Type | Required | Description |
|-------|------|-------------|-------------|
| `externalContext` | object | no | Traceability metadata (same structure as above) |

**Output**

```json
{
  "seoExecutionId": "<uuid>",
  "keywordsCreated": 42,
  "clustersCreated": 5,
  "clustersReferenced": 7,
  "warnings": ["<string>"] // present if the inventory is more than 21 days old
}
```

**Blocked cases**
| `reason` | Cause |
|----------|-------|
| `project_not_found` | Project not found |
| `site_snapshot_missing` | No snapshot available — run `analyze_site_content` first |

---

### list_keywords

Returns keywords with no associated article, sorted by descending priority score. Limited by `config.maxKeywordCandidates` (default: 100).

**Input**: none

**Output**

```json
{
  "keywords": [
    {
      "id": "<uuid>",
      "keyword": "<string>",
      "searchVolume": 1200,
      "keywordDifficulty": 34,
      "productAlignment": 0.85,
      "priorityScore": 72.4,
      "reasoning": "<string>"
    }
  ]
}
```

**Blocked cases**
| `reason` | Cause |
|----------|-------|
| `project_not_found` | Project not found |

---

### plan_article

Plans the content of a SEO article for a given keyword (angle, structure, sources) before writing. **Asynchronous**: the tool returns immediately with a `runId` and starts planning in the background (SERP research + LLM reasoning). OpenGroow polls `get_plan_status(runId)` on your behalf until `completed` (plan produced), `skipped` (blocked), or `failed` — see `get_plan_status` below and the workflow for the handoff. Requires a prior snapshot.

Can be called a second time (or more) for a **revision**: pass `previousArticlePlan` (the **full** `output` object read from the last `## Last Intermediate Result` — `{ status: "planned", articlePlan, evidence, warnings }`, not just `articlePlan`) and `planFeedback` (the agent's critique — what needs to change) to get a new plan that accounts for it. OpenGroow imposes no cap on the number of revisions — it's up to the agent to judge when a plan is acceptable.

**Input**
| Field | Type | Required | Description |
|-------|------|-------------|-------------|
| `keywordId` | UUID | yes | Keyword ID (obtained via `list_keywords`) |
| `previousArticlePlan` | object (`{ status: "planned", articlePlan, evidence, warnings }`) | no | The full `output` result received from the last planned `plan_article` — pass it through unchanged, only for a revision |
| `planFeedback` | string | no | The agent's critique explaining why the previous plan needs revising — required if `previousArticlePlan` is provided |
| `externalContext` | object | no | Traceability metadata (same structure as for `analyze_site_content`) |

**Output**

```json
{
  "runId": "<uuid>",
  "status": "started"
}
```

**Blocked cases**
| `reason` | Cause |
|----------|-------|
| `project_not_found` | Project not found |
| `site_snapshot_missing` | No snapshot — run `analyze_site_content` first |
| `keyword_not_found` | The `keywordId` doesn't exist in this project |

---

### get_plan_status

Returns the current state of a planning run started by `plan_article`. Called by OpenGroow (polling loop) — **the SEO runtime agent must never call this tool directly**, exactly like `get_article_status`: OpenGroow owns the poll loop for this External Job, the agent only writes the `in_progress` handoff and stops (see the workflow).

**Input**
| Field | Type | Required | Description |
|-------|------|-------------|-------------|
| `runId` | UUID | yes | Run ID returned by `plan_article` |

**Output**

```json
{
  "runId": "<uuid>",
  "status": "running | completed | skipped | failed",
  "nextPollAfterSeconds": 30,        // present only when status = running
  "output": {                         // present when status = completed or skipped; this is the full plan_article result, discriminated by output.status
    "status": "planned",              // or "blocked"
    "articlePlan": { "...": "..." },  // present when output.status = "planned"
    "evidence": { "...": "..." },     // present in both cases — required as-is if the agent passes this output back as previousArticlePlan
    "warnings": ["..."],              // present in both cases
    "reason": "unsupported_content_type | out_of_scope | ambiguous_intent | serp_unavailable" // present when output.status = "blocked"
  },
  "error": "<string>"                 // present when status = failed
}
```

If the `runId` is unknown, the tool returns `{ "status": "not_found" }`.

OpenGroow polls this tool and, on `completed`/`skipped`, only forwards the `output` sub-object to the agent (in `## Last Intermediate Result`) — not `status` or the other top-level fields — but `output` itself remains the full `plan_article` result object, not just `articlePlan`. After resuming, the agent therefore receives `{ "jobType": "plan_article", "output": { "status": "planned", "articlePlan": {...}, "evidence": {...}, "warnings": [...] } }` (planned) or `{ "jobType": "plan_article", "output": { "status": "blocked", "reason": "..." } }` (blocked) — see the workflow.

---

### generate_article

Generates a SEO article in Markdown for a given keyword. **Asynchronous**: the tool returns immediately with a `runId` and starts generation in the background (the writer LLM takes several minutes). OpenGroow polls `get_article_status(runId)` on your behalf until `completed` or `failed` — see `get_article_status` below and the workflow for the handoff. Idempotent: a second call for the same keyword while an article already exists returns a blocked case (`article_generating`, `article_draft`, `article_failed`, or `already_generated`). Requires a prior snapshot.

**Input**
| Field | Type | Required | Description |
|-------|------|-------------|-------------|
| `keywordId` | UUID | yes | Keyword ID (obtained via `list_keywords`) |
| `articlePlan` | object | yes | The validated article plan — `output.articlePlan` from the last planned `plan_article` (see Step 5/6 in the workflow) |
| `externalContext` | object | no | Traceability metadata (same structure as above) |

**Output**

```json
{
  "runId": "<uuid>",
  "status": "started"
}
```

**Blocked cases**
| `reason` | Cause |
|----------|-------|
| `project_not_found` | Project not found |
| `site_snapshot_missing` | No snapshot — run `analyze_site_content` first |
| `keyword_not_found` | The `keywordId` doesn't exist in this project |
| `article_generating` | A generation is already in progress for this keyword (the ongoing `runId` is returned for polling) |
| `article_draft` | A draft article already exists for this keyword |
| `article_failed` | A previous generation failed (terminal state, no automatic retry) |
| `already_generated` | A concurrent call has already reserved this keyword |

---

### get_article_status

Returns the current state of a generation started by `generate_article`. Called by OpenGroow (polling loop) — **the SEO runtime agent must not call this tool** directly.

**Input**
| Field | Type | Required | Description |
|-------|------|-------------|-------------|
| `runId` | UUID | yes | Run ID returned by `generate_article` |

**Output**

```json
{
  "runId": "<uuid>",
  "status": "running | completed | failed | skipped",
  "nextPollAfterSeconds": 30,        // present only when status = running
  "output": {                         // present when status = completed
    "articleId": "<uuid>",
    "title": "<string>"
  },
  "error": "<string>"                 // present when status = failed
}
```

If the `runId` is unknown, the tool returns `{ "status": "not_found" }`.

---

### get_article_content

Returns the Markdown content of a generated article. Used by OpenGroow to display the article on the review page — **the SEO runtime agent must not call this tool**.

**Input**
| Field | Type | Required | Description |
|-------|------|-------------|-------------|
| `articleId` | UUID | yes | ID of the article to read |

**Output**

```json
{
  "content": "<markdown string>"
}
```

**Blocked cases**
| `reason` | Cause |
|----------|-------|
| `article_not_found` | The `articleId` is unknown or doesn't belong to the authenticated project |

---

### revise_article

Revises a draft article based on human feedback. Calls the reviser LLM with the current Markdown + the feedback, then updates the article's Markdown in place. Idempotent: can be called multiple times for an iterative revision loop (each call re-revises from the latest version).

**Input**
| Field | Type | Required | Description |
|-------|------|-------------|-------------|
| `articleId` | UUID | yes | ID of the article to revise |
| `feedback` | string (non-empty) | yes | Comments and requested changes from the human reviewer |

**Output**

```json
{
  "articleId": "<uuid>",
  "status": "revised"
}
```

**Blocked cases**
| `reason` | Cause |
|----------|-------|
| `article_not_found` | The `articleId` is unknown or doesn't belong to the authenticated project |

---

> **Note**: publishing an article isn't an MCP tool. It's triggered directly by the OpenGroow dashboard via `POST /articles/:articleId/publish` on the article-mcp REST API. Agents don't need to call this action.
