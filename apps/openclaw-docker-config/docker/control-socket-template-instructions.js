const fsPromises = require("node:fs/promises");
const path = require("node:path");

const RESERVED_TEMPLATE_PATH_SEGMENTS = new Set([
  ".git",
  "memory",
  "missions",
  "node_modules",
  "skills",
]);
const RESERVED_TEMPLATE_ROOT_FILE_NAMES = new Set([
  "agents.md",
  "boot.md",
  "bootstrap.md",
  "heartbeat.md",
  "identity.md",
  "memory.md",
  "soul.md",
  "user.md",
]);

function isSafeRelativePathSegment(segment) {
  return segment.length > 0 && segment !== "." && segment !== "..";
}

function isSafeRelativePath(filePath) {
  return filePath.split("/").every(isSafeRelativePathSegment);
}

function isTemplateInstructionFilePath(filePath) {
  const segments = filePath.split("/");
  const fileName = segments.at(-1)?.toLowerCase() ?? "";
  return (
    segments.length > 0 &&
    !RESERVED_TEMPLATE_PATH_SEGMENTS.has(segments[0].toLowerCase()) &&
    fileName !== "tools.md" &&
    !(segments.length === 1 && RESERVED_TEMPLATE_ROOT_FILE_NAMES.has(fileName)) &&
    fileName.endsWith(".md") &&
    segments.every(isSafeRelativePathSegment)
  );
}

async function collectTemplateInstructionFiles(workspacePath) {
  const files = [];
  const seenRealPaths = new Set();

  async function walk(directoryPath, relativePrefix) {
    let entries;
    try {
      entries = await fsPromises.readdir(directoryPath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      if (
        !relativePrefix &&
        RESERVED_TEMPLATE_PATH_SEGMENTS.has(entry.name.toLowerCase())
      ) {
        continue;
      }

      const relativePath = relativePrefix
        ? `${relativePrefix}/${entry.name}`
        : entry.name;
      const absolutePath = path.join(directoryPath, entry.name);
      if (entry.isDirectory()) {
        if (isSafeRelativePathSegment(entry.name)) {
          await walk(absolutePath, relativePath);
        }
        continue;
      }
      if (!entry.isFile() || !isTemplateInstructionFilePath(relativePath)) continue;

      try {
        const realPath = await fsPromises.realpath(absolutePath);
        if (seenRealPaths.has(realPath)) continue;
        seenRealPaths.add(realPath);
        files.push({
          filePath: relativePath,
          title: path.basename(relativePath, ".md").toLowerCase(),
          kind: "standard",
        });
      } catch {
        // Missing files are skipped.
      }
    }
  }

  await walk(workspacePath, "");
  return files.sort((left, right) => left.filePath.localeCompare(right.filePath));
}

module.exports = {
  collectTemplateInstructionFiles,
  isSafeRelativePath,
  isTemplateInstructionFilePath,
};
