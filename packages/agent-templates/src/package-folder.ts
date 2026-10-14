/**
 * Reads a Claw package from a local folder (Node-only: never import it from
 * the package entrypoint, Convex and the dashboard bundle that).
 */
import { lstatSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { IGNORED, type PackageFile } from "./folder-files.js";

export { IGNORED, type PackageFile };

/** Every file of the package, with paths relative to the folder (forward slashes). */
export function readPackageFolder(root: string): PackageFile[] {
  let isFolder = false;
  try {
    isFolder = statSync(root).isDirectory();
  } catch {
    // reported below
  }
  if (!isFolder) throw new Error(`${root} is not a folder`);

  const files: PackageFile[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir).sort()) {
      if (IGNORED.has(entry)) continue;
      const path = join(dir, entry);
      const stat = lstatSync(path);
      // A symlink could pull a file from outside the package into the payload.
      if (stat.isSymbolicLink()) throw new Error(`Refusing symlink in package folder: ${relative(root, path)}`);
      if (stat.isDirectory()) walk(path);
      else files.push({ path: relative(root, path).split("\\").join("/"), content: readFileSync(path, "utf-8") });
    }
  };
  walk(root);
  return files;
}
