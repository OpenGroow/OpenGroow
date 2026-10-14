import { readFileSync } from "node:fs";
import path from "node:path";
import type { AgentManifest } from "@convex/template_manifest_contract";

/**
 * Manifests the mocked `project_templates` queries serve to dashboard
 * components. They are manifest files committed next to this module
 * (`manifests/<name>.json`), read as plain data: the dashboard does not depend
 * on the Template package, it only needs realistic manifest shapes to render.
 */
export function manifestFixture(templateId: string): AgentManifest {
  const file = path.resolve(__dirname, "manifests", `${templateId}.json`);
  return JSON.parse(readFileSync(file, "utf8")) as AgentManifest;
}

const LIST_TEMPLATES_QUERY = "project_templates.listForProject";
const GET_TEMPLATE_QUERY = "project_templates.getForProject";
const CATALOGUE_QUERY = "project_templates.catalogue";
const UPDATES_QUERY = "project_templates.updates";

let served: readonly AgentManifest[] | undefined = [];
let catalogue: readonly unknown[] | undefined = [];

/** The entries the mocked `project_templates.catalogue` query answers with (#655). */
export function serveCatalogue(entries: readonly unknown[] | undefined): void {
  catalogue = entries;
}

/**
 * The manifests the mocked Template queries answer with (none until set);
 * `undefined` simulates the queries still loading.
 */
export function serveProjectManifests(manifests: readonly AgentManifest[] | undefined): void {
  served = manifests;
}

/**
 * A `useQuery` replacement answering the Project-scoped Template queries from
 * the served manifests (`getForProject` yields `null` for a Template the
 * Project does not offer) and every other query through `otherwise`.
 */
export function useQueryWithTemplates(otherwise: (...args: unknown[]) => unknown) {
  return (...args: unknown[]): unknown => {
    const [query, queryArgs] = args;
    if (query === LIST_TEMPLATES_QUERY) return served;
    if (query === UPDATES_QUERY) return [];
    if (query === CATALOGUE_QUERY) return queryArgs === "skip" ? undefined : catalogue;
    if (query === GET_TEMPLATE_QUERY) {
      if (served === undefined) return undefined;
      const { templateId } = queryArgs as { templateId: string };
      return served.find((manifest) => manifest.id === templateId) ?? null;
    }
    return otherwise(...args);
  };
}
