import { ConvexError } from "convex/values";
import { env } from "./env.js";

/**
 * Installing a Template from a local folder is a self-host / development
 * feature (#707): the package comes straight from the owner's machine, with no
 * hub index or digest behind it. The hosted deployment installs through the hub
 * only, so the entry points of the folder install refuse there, whatever the
 * dashboard shows.
 */
export const LOCAL_FOLDER_SELF_HOST_ONLY = "Installing a Template from a local folder is only available on self-hosted deployments";

export function assertLocalFolderInstallAllowed(): void {
  if (!env.IS_SELF_HOST) throw new ConvexError(LOCAL_FOLDER_SELF_HOST_ONLY);
}
