"use node";

import { v } from "convex/values";
import { clawPackageToTemplate } from "@opengroow/agent-templates";
import { assetField, fetchGitPackage } from "@opengroow/agent-templates/git-archive";
import { PINNED_SOURCE_RELEASE, PINNED_SOURCE_TEMPLATE_ID } from "@opengroow/agent-templates/pinned-source";
import { internal } from "./_generated/api.js";
import { internalAction, type ActionCtx } from "./_generated/server.js";
import { messageOf } from "./error_message.js";
import { toClawFiles } from "./template_registry_store.js";

/**
 * Installs the system Template Source (`PINNED_SOURCE_TEMPLATE_ID`) into a Project from the hub
 * (#673), at the release pinned in the product (`PINNED_SOURCE_RELEASE`). The
 * hub index is deliberately not consulted: the repository, tag and digest come
 * from the code, so an edited index cannot replace the Template that captures
 * every Project's Sources. The package goes through the same hub install path
 * as any official Template (reserved scope, origin `hub`).
 *
 * Never blocks the creation of a Project: it runs scheduled after the Project
 * exists, and a failure (hub unreachable, GitHub down) is retried with a
 * growing delay, then logged.
 */

export type BootstrapResult =
  | { status: "installed"; version: string }
  | { status: "already_installed" }
  | { status: "error"; errorMessage: string };

/** Delays before each retry; once exhausted the failure is only logged. */
export const BOOTSTRAP_RETRY_DELAYS_MS = [60_000, 10 * 60_000, 60 * 60_000, 6 * 60 * 60_000];

async function installPinnedSource(ctx: ActionCtx, projectId: string): Promise<BootstrapResult> {
  try {
    if (await ctx.runQuery(internal.source_bootstrap.isInstalled, { projectId, templateId: PINNED_SOURCE_TEMPLATE_ID })) {
      return { status: "already_installed" };
    }
    const { files, gitOrigin } = await fetchGitPackage({
      repository: PINNED_SOURCE_RELEASE.repository,
      tag: PINNED_SOURCE_RELEASE.tag,
      ...assetField(PINNED_SOURCE_RELEASE.asset),
      digest: PINNED_SOURCE_RELEASE.digest,
      fetch: (url) => fetch(url),
    });
    const converted = clawPackageToTemplate(toClawFiles(files));
    if (!converted.ok) return { status: "error", errorMessage: converted.reason };
    if (converted.template.manifest.id !== PINNED_SOURCE_TEMPLATE_ID) {
      return {
        status: "error",
        errorMessage: `The pinned release declares ${converted.template.manifest.id}, expected ${PINNED_SOURCE_TEMPLATE_ID}. Installation refused`,
      };
    }
    const installed = await ctx.runAction(internal.template_install_local.addFromHub, { projectId, files, gitOrigin });
    return { status: "installed", version: installed.version };
  } catch (error) {
    return { status: "error", errorMessage: messageOf(error) };
  }
}

export const bootstrap = internalAction({
  args: { projectId: v.string(), attempt: v.optional(v.number()) },
  handler: async (ctx, { projectId, attempt = 0 }): Promise<BootstrapResult> => {
    const result = await installPinnedSource(ctx, projectId);
    if (result.status !== "error") return result;
    const delay = BOOTSTRAP_RETRY_DELAYS_MS[attempt];
    if (delay === undefined) {
      console.error(`Could not install ${PINNED_SOURCE_TEMPLATE_ID} into Project ${projectId}, giving up: ${result.errorMessage}`);
    } else {
      console.warn(`Could not install ${PINNED_SOURCE_TEMPLATE_ID} into Project ${projectId}, retrying: ${result.errorMessage}`);
      await ctx.scheduler.runAfter(delay, internal.source_bootstrap_node.bootstrap, { projectId, attempt: attempt + 1 });
    }
    return result;
  },
});
