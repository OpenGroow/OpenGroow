# ADR-069: `routing` never authors the brief of a Source reel; the producing Agent reads the Source through `observationId`

**Status:** Accepted

### Context

`routing` (ADR-052) picks the producing Mission type for a Source and returns a JSON `payload`. For `create_reel` the contract accepts exactly one of `observationId`, `prompt` or `shots`, and the run file told the router that OpenGroow adds `observationId` "unless you author a prompt or shots yourself".

In practice the router did author one. On a handfasting-cords Source it wrote a `prompt` describing the cords, their colours and the Source's own text, and put the Source's hook and hashtags in `publish`. The `moneyprinterturbo` Template uses a `prompt` as-is as `video_subject`, so the reel reproduced the Source's topic. The `observationId` branch, where the producing Agent adapts the Source's structure to the Instance's Brand Core, was never taken. OpenMontage has the same exposure through `shots`.

### Options considered

- **Keep letting the router author the brief** — rejected: the router knows neither the producing Template's rules nor its output format, and it copies the Source when in doubt. The Source's `Topic-Specific Elements (do not use)` split is lost as soon as everything is flattened into one paragraph.
- **Ask the router, in text only, not to write one** — insufficient on its own: a model can ignore it. Kept as a first line of defence, since it also stops the router wasting its answer.
- **Drop `prompt`/`shots` in code when the Mission comes from a Source** — chosen.

### Decision

For a `create_reel` routed from a Source, the Mission payload is built by OpenGroow as `{ publish, observationId: <the Source> }` and nothing else. Whatever else the router returns (`prompt`, `shots`, a forged `observationId`, ...) is dropped in `reelPayload` (`apps/convex/source_routing.ts`).

The producing Agent receives the Source through the `observation-production-source` context provider, which splits what may be reused (Creative Mechanic, Analysis, Reproducible Elements) from what must not be (Topic-Specific Elements). The adaptation to the Brand Core lives in the producing Template's `create_reel` instructions, so there is one place to fix it.

The router's run file now also says that `publish.title` and `publish.description` are the Instance's own publication text: never the Source's wording, hook, topic-specific objects, colours or hashtags.

`prompt` and `shots` remain valid payloads for Missions created by a human or an external caller with no Source. Only the Source routing path is restricted.

### Consequences

- The router can no longer steer the content of a reel (for example "make it a POV"). It still chooses the producer and writes `publish`. If that steering is needed later, it should be a dedicated field that adds to the Source and never replaces it.
- Other mission types routed from a Source are untouched: the filter only applies to `create_reel`.
- A Template must handle `observationId` well. A Template that only works from a `prompt` or `shots` cannot be a Source routing target for `create_reel`.
- `publish` is still written by the router LLM, so a Source-flavoured title is possible in spite of the instruction. Only the brief is enforced in code.
