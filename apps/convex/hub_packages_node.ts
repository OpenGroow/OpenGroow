"use node";

import { action, type ActionCtx } from "./_generated/server.js";
import { internal } from "./_generated/api.js";
import { v } from "convex/values";
import { assetField, fetchGitPackage } from "@opengroow/agent-templates/git-archive";
import { fetchHubPackageIndex, type HubPackageEntry, type HubPackageKind, type HubVerification } from "@opengroow/agent-templates/hub-index";
import { env } from "./env.js";
import { messageOf } from "./error_message.js";
import { requireAuthenticatedUser } from "./project_agents/auth.js";
import { kindV, MAX_ARCHIVE_BYTES, MAX_UNPACKED_BYTES, parseTag, problemWith } from "./hub_package_kinds.js";
import { resolveRegistrationPolicy } from "./auth_registration_policy.js";

/**
 * Installing hub packages that are not Templates (ADR-072). The caller names a
 * kind and a package id; the repository, tag, asset and digest come from the
 * hub's index for that kind (`publishers.json`), never from the caller, and the
 * release is verified against that digest before anything is extracted.
 */

export type HubPackageCatalogueEntry = {
  packageId: string;
  name: string;
  description: string;
  tag: string;
  verification: HubVerification;
};

/**
 * Installing replaces code that runs with the core's rights for the whole
 * deployment, so it is an admin act. The only admin there is: the sole account
 * of a self-hosted deployment. A multi-account deployment has no admin role
 * yet, so it cannot install from the app (ADR-072, trust model).
 */
async function requireHubAdmin(ctx: ActionCtx) {
  const user = await requireAuthenticatedUser(ctx);
  if (resolveRegistrationPolicy(env.OPENGROOW_ACCOUNT_MODE) !== "single-account") {
    throw new Error("Forbidden: installing hub packages is reserved to the administrator of the deployment");
  }
  return user;
}

const loadIndex = (kind: HubPackageKind) =>
  fetchHubPackageIndex({ repository: env.OPENGROOW_HUB_REPOSITORY, ref: env.OPENGROOW_HUB_REF, kind, fetch: (url) => fetch(url) });

const toCatalogueEntry = (entry: HubPackageEntry): HubPackageCatalogueEntry => ({
  packageId: entry.id,
  name: entry.name,
  description: entry.description,
  tag: entry.tag,
  verification: entry.verification,
});

/** The hub's packages of a kind. A hub that cannot be read is reported rather than thrown. */
export const catalogue = action({
  args: { kind: kindV },
  handler: async (ctx, { kind }): Promise<{ entries: HubPackageCatalogueEntry[]; error?: string }> => {
    await requireAuthenticatedUser(ctx);
    try {
      return { entries: (await loadIndex(kind)).packages.map(toCatalogueEntry) };
    } catch (error) {
      return { entries: [], error: messageOf(error) };
    }
  },
});

/**
 * Downloads, verifies and stores a package; installing again replaces the
 * installed version (an upgrade). Only `official` entries are installable: the
 * code of a Publisher runs with the core's rights (ADR-072, trust model).
 */
export const install = action({
  args: { kind: kindV, packageId: v.string() },
  handler: async (ctx, { kind, packageId }): Promise<{ status: "installed"; packageId: string; version: string } | { status: "error"; errorMessage: string }> => {
    await requireHubAdmin(ctx);
    try {
      const entry = (await loadIndex(kind)).packages.find((candidate) => candidate.id === packageId);
      if (!entry) throw new Error(`${packageId} is not listed in the hub`);
      if (entry.verification !== "official") {
        throw new Error(`${entry.name} is ${entry.verification}: only official packages can be installed, because their code runs inside OpenGroow`);
      }
      const { files, gitOrigin } = await fetchGitPackage({
        repository: entry.repository,
        tag: entry.tag,
        ...assetField(entry.asset),
        digest: entry.digest,
        fetch: (url) => fetch(url),
        maxArchiveBytes: MAX_ARCHIVE_BYTES,
        maxUnpackedBytes: MAX_UNPACKED_BYTES,
      });
      const problem = problemWith(kind, entry, files);
      if (problem) throw new Error(`${entry.name} cannot be installed: ${problem}`);
      const version = parseTag(entry.tag)!.version; // `problemWith` accepted the tag
      await ctx.runMutation(internal.hub_packages.replace, {
        packageId: entry.id,
        kind,
        version,
        tag: entry.tag,
        digest: gitOrigin.archiveDigest,
        verification: entry.verification,
        files,
      });
      return { status: "installed", packageId: entry.id, version };
    } catch (error) {
      return { status: "error", errorMessage: messageOf(error) };
    }
  },
});
