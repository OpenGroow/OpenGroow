/**
 * Turns a folder picked in the browser (`<input webkitdirectory>`) into the
 * files of a Claw package (#707). Browser-safe, unlike `package-folder.ts`
 * (which reads the disk with Node): the dashboard imports this one. Same
 * rules as the CLI's `readPackageFolder`: ignored entries are skipped, files
 * are UTF-8 text, and the package is bounded so one install stays a small request.
 */

export type PackageFile = { path: string; content: string };

/** Entries never part of a package, whether read from a folder or a Git archive. */
export const IGNORED: ReadonlySet<string> = new Set([".git", "node_modules", ".DS_Store"]);

export const MAX_FILE_BYTES = 512 * 1024;
export const MAX_FILES = 500;
export const MAX_TOTAL_BYTES = 8 * 1024 * 1024;

/** A file of the picked folder; a browser `File` fits with `path` = `webkitRelativePath`. */
export type FolderEntry = { path: string; size: number; arrayBuffer(): Promise<ArrayBuffer> };

const UTF8 = new TextDecoder("utf-8", { fatal: true });

/** Every file of the package, paths relative to the picked folder (forward slashes), sorted. Throws a user-facing message when the folder is not installable. */
export async function filesFromFolder(entries: readonly FolderEntry[]): Promise<PackageFile[]> {
  // The first segment is the picked folder's own name.
  const kept = entries
    .map((entry) => ({ entry, path: entry.path.split("\\").join("/").split("/").slice(1).join("/") }))
    .filter(({ path }) => path !== "" && !path.split("/").some((segment) => IGNORED.has(segment)));

  if (kept.length === 0) throw new Error("The folder is empty");
  if (kept.length > MAX_FILES) throw new Error(`The folder has ${kept.length} files, over the ${MAX_FILES} files limit`);
  if (!kept.some(({ path }) => path === "CLAW.md")) {
    throw new Error("CLAW.md not found at the root of the folder: pick the package folder itself");
  }
  for (const { entry, path } of kept) {
    if (entry.size > MAX_FILE_BYTES) {
      throw new Error(`${path} is ${entry.size} bytes, over the ${MAX_FILE_BYTES / 1024} KiB limit per file`);
    }
  }
  const total = kept.reduce((sum, { entry }) => sum + entry.size, 0);
  if (total > MAX_TOTAL_BYTES) {
    throw new Error(`The folder is ${total} bytes in total, over the ${MAX_TOTAL_BYTES / 1024 / 1024} MiB limit`);
  }

  const files: PackageFile[] = [];
  for (const { entry, path } of kept) {
    try {
      files.push({ path, content: UTF8.decode(await entry.arrayBuffer()) });
    } catch {
      throw new Error(`Refusing ${path}: only UTF-8 text files are supported`);
    }
  }
  return files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
