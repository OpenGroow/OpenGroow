# ADR-054: Agent Templates are Claw packages installed in a per-Project registry and interpreted as data

**Status:** Accepted

### Context

Every Megaclaw Agent Template is compiled into the platform: the manifest, `AGENTS.md` and the per-Mission-type instruction files are inlined into the Convex bundle by a codegen step and imported directly by the dashboard; some pieces (Social Engagement's report-sync plugin) even live in the OpenClaw Docker image, and a few Template-specific branches remain in the Convex code. Adding, fixing or updating an agent therefore requires changing the monorepo, regenerating code and redeploying Convex, the dashboard and sometimes the image; restarting an Instance is never enough. Nobody outside the monorepo can create or install an agent published by a third party. A redeploy silently changes the behavior of every Agent in every Project, with no notion of a Template version for an Agent or a Mission. The domain model says Templates are declarative; the delivery mechanism contradicts it.

### Decision

1. **An Agent Template is a Claw package**: `CLAW.md` (identity, portable prompt, required skills), `workspace/` (`AGENTS.md` and the instruction files per Mission type / Source / Job) and `profiles/megaclaw.yml` (everything specific to Megaclaw, essentially the former manifest minus identity and skills). The same package works as a plain OpenClaw agent outside Megaclaw. A pure adapter (`clawPackageToTemplate`) assembles these files into an `AgentTemplate`, through the strict manifest validation (any unknown key is refused, with its name in the message).
2. **Each Project has its own registry of installed Templates.** Installation validates the package through the adapter, computes an integrity digest over the package files and stores a snapshot (version, origin, digest, manifest, one document per file, to stay under the Convex document size limit). The registry is keyed by Project (= Instance id, there is no Project table), never by a separate Instance notion: an Instance can be reprovisioned, the registry is the source of truth. Several versions of the same Template coexist, only one being the Project's current version.
3. **Convex interprets the package as data and never executes package code.** Agent-specific code lives in its MCP servers (external services) or in OpenClaw plugins installed in the Instance; any Template-specific behavior currently in Convex becomes a declarative field of the Megaclaw profile.
4. **Every Template resolution goes through a single asynchronous `TemplateRegistry` interface** (`getTemplateRegistry`), which consults the Project's registry first, then falls back to the built-in Templates during the transition (fixed version `"builtin"`). An in-memory implementation serves tests.

### Considered options

- **Keep Templates compiled into the platform**: the status quo, rejected because it rules out external authoring, distribution and per-Template versioning.
- **One registry per deployment instead of per Project**: simpler, but two Projects (two brands) could not have independent versions or installations; rejected, installation is a Project decision.
- **A registry keyed by Instance**: rejected, a reprovisioned Instance would lose its Templates; the Project is the stable key.
- **A Megaclaw-specific format instead of Claw**: rejected, the Claw format makes the package usable as-is as an OpenClaw agent; the adapter isolates Megaclaw from changes to the format (documented as experimental on the OpenClaw side), the Megaclaw profile remaining our own contract.
- **Allowing package code in Convex**: rejected, attack surface (multi-tenant SaaS) and contrary to the declarative nature of Templates.

### Consequences

- A Template can be installed, updated and versioned without redeploying Convex or the dashboard; installing into a Project has no effect on another.
- Convex functions that resolve a Template receive a context (`ctx`) to read the Project's registry; tests that do not inject an in-memory registry must expose `project_templates.ts` to convex-test (actions read through internal queries).
- Rebuilding a Template from its files replays the adapter on every resolution: an accepted cost (small YAML, a few files) in exchange for a single source of truth (the files, verifiable through the digest).
- Built-in Templates remain the fallback until the official Templates are installed packages; after that, the codegen, the inline copy and its drift test disappear (PRD #642).
- Out of scope for this first delivery: pinning Missions to a version, reconciling the Instance after installation, an installation CLI, a catalog.
