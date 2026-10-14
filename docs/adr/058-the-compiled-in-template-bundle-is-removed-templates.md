# ADR-058: The compiled-in Template bundle is removed; Templates exist only as installed packages

*Follow-up to ADR-054, ADR-055 and ADR-057 (#674, spec #710 phase 1). Those ADRs stay as written: where they describe the codegen, the embedded copy or the `"builtin"` fallback as transitional, this ADR is what happened next.*

### Context

ADR-054 kept the official Templates compiled into Convex (`embedded.generated.ts`, produced by a codegen from `templates/<id>/`) as a registry fallback at the fixed version `"builtin"`, "until the built-ins are installed packages too". With the official Templates published as packages (hub repositories) and installable per Project (ADR-057), the bundle had no remaining purpose and cost a codegen, a drift test and a second path to every Template.

### Decision

- No Template content is compiled into Convex or the dashboard. Deleted: `builtin-templates.ts`, `embedded.generated.ts` and its drift test, `scripts/generate-embedded.ts` / `generate-manifests.ts` and the `codegen` script, `MEGACLAW_EMBEDDED_CODEGEN`, `scripts/export-claw-package.ts`, `claw-package-export.ts`, the `templates/` folders of the package.
- The registry consults the Project's installed packages only. `builtInTemplateRegistry` and `BUILTIN_TEMPLATE_VERSION` are gone; a Template the Project did not install does not resolve, whatever the version asked.
- Legacy pins: a Mission without `templateVersion`, or pinned to `"builtin"`, follows the Project's current installed version (`missionTemplateVersion`). A package whose `package.json` version is `"builtin"` stays refused at install. New Missions of a Template that is not installed carry no version.
- The Add Agent catalogue lists installed Templates only (the `built_in` origin is gone).
- Iterating on a Template is `pnpm template:link` on the package folder (it syncs on save); delivering to a running Agent is the dashboard Refresh.
- The `platform-account` core context provider no longer reads the Social Engagement manifest: its two platforms (and their account-handle keys) are a constant of core.
- Migration order: run `pnpm template:migrate-builtin <packages-dir>` against every deployment **before** deploying this change. It reads the (Project, Template) pairs that have an Agent on a former built-in Template id (`LEGACY_BUILTIN_TEMPLATE_IDS`) and no installed version, and installs them (Source from the hub, the others from the local folders; self-host and development only for the private ones).
- Tests: Megaclaw's engine tests (review, External Jobs, activation, run context, exclusive resources, routing) run on purpose-built fixture packages installed through the registry path (`fixtures/packages/{hello,source,social-engagement}`, `packages/agent-templates/src/__fixtures__/`, `apps/convex/test/fixtures/templates/`). Contract tests that belong to one Template live with its package in the hub repository. A guard test (`scripts/no-compiled-templates.test.ts`) keeps the bundle, the codegen switch and the fallback from coming back.

### Consequences

- A deployment that skipped the migration loses the Agents whose Template is not installed until the migration is run (it is idempotent and can be run afterwards).
- Editing a Template no longer requires a Convex redeploy.
