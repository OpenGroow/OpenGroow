const fsPromises = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createHash } = require("node:crypto");
const {
  collectTemplateInstructionFiles,
  isSafeRelativePath,
  isTemplateInstructionFilePath,
} = require("./control-socket-template-instructions");

const STANDARD_WORKSPACE_FILES = [
  "AGENTS.md",
  "SOUL.md",
  "USER.md",
  "IDENTITY.md",
  "HEARTBEAT.md",
  "BOOT.md",
  "BOOTSTRAP.md",
  "MEMORY.md",
];

const MANAGED_WORKSPACE_MARKER = ".opengroow-workspace.json";
// Reserved dirname OpenClaw itself uses under ~/.openclaw for policy audit
// attestations (WORKSPACE_ATTESTATION_DIRNAME in the openclaw binary). It is
// not an agent workspace, even though it matches the `workspace-*` pattern.
const RESERVED_WORKSPACE_DIRNAMES = new Set(["workspace-attestations"]);
const BINARY_MIME = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
};
function binaryMimeForPath(filePath) {
  const ext = path.extname(filePath).toLowerCase().slice(1);
  return BINARY_MIME[ext] ?? null;
}
const MEMORY_FILE_RE = /^\d{4}-\d{2}-\d{2}\.md$/;
const WORKSPACE_KEY_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;

function workspaceHash(value) {
  return createHash("sha1").update(value).digest("hex").slice(0, 10);
}

function getHomeDir(options = {}) {
  return (
    options.homeDir?.trim() ||
    process.env.HOME?.trim() ||
    os.homedir()
  );
}

function expandHome(value, homeDir) {
  if (typeof value !== "string") {
    return "";
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  if (trimmed === "~") {
    return homeDir;
  }
  if (trimmed.startsWith("~/")) {
    return path.join(homeDir, trimmed.slice(2));
  }
  return trimmed;
}

function getProfileName(options = {}) {
  const profile = options.profileName ?? process.env.OPENCLAW_PROFILE ?? "default";
  return profile.trim() || "default";
}

async function readJsonFile(filePath) {
  try {
    const raw = await fsPromises.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function extractConfiguredWorkspace(config, homeDir) {
  if (!config || typeof config !== "object") {
    return "";
  }
  const configRecord = config;
  const directWorkspace =
    typeof configRecord.agent?.workspace === "string"
      ? configRecord.agent.workspace
      : undefined;
  const defaultsWorkspace =
    typeof configRecord.agents?.defaults?.workspace === "string"
      ? configRecord.agents.defaults.workspace
      : undefined;
  return expandHome(directWorkspace || defaultsWorkspace || "", homeDir);
}

function defaultWorkspacePath(homeDir, profileName) {
  return profileName !== "default"
    ? path.join(homeDir, ".openclaw", `workspace-${profileName}`)
    : path.join(homeDir, ".openclaw", "workspace");
}

async function getRealDirectory(candidatePath) {
  try {
    const realPath = await fsPromises.realpath(candidatePath);
    const stat = await fsPromises.stat(realPath);
    return stat.isDirectory() ? realPath : null;
  } catch {
    return null;
  }
}

async function collectMemoryFiles(workspacePath) {
  const memoryDir = path.join(workspacePath, "memory");
  try {
    const stat = await fsPromises.lstat(memoryDir);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      return [];
    }
  } catch {
    return [];
  }

  const entries = await fsPromises.readdir(memoryDir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile() || !MEMORY_FILE_RE.test(entry.name)) {
      continue;
    }
    const filePath = path.join(memoryDir, entry.name);
    const stat = await fsPromises.lstat(filePath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      continue;
    }
    files.push({
      filePath: `memory/${entry.name}`,
      title: entry.name.replace(/\.md$/, ""),
      kind: "memory",
    });
  }
  return files.sort((left, right) => right.filePath.localeCompare(left.filePath));
}

function titleFromFileName(fileName) {
  return fileName.replace(/\.[^.]+$/, "");
}

async function collectMissionFiles(workspacePath) {
  const missionsDir = path.join(workspacePath, "missions");
  try {
    const stat = await fsPromises.lstat(missionsDir);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      return [];
    }
  } catch {
    return [];
  }

  const files = [];
  let missionEntries;
  try {
    missionEntries = await fsPromises.readdir(missionsDir, { withFileTypes: true });
  } catch {
    return [];
  }

  for (const missionEntry of missionEntries) {
    if (!missionEntry.isDirectory() || missionEntry.isSymbolicLink()) {
      continue;
    }
    const missionId = missionEntry.name;
    const missionDir = path.join(missionsDir, missionId);

    const subDirs = ["", "runs", "outputs", "artifacts"];
    for (const sub of subDirs) {
      const scanDir = sub ? path.join(missionDir, sub) : missionDir;
      let entries;
      try {
        const dirStat = await fsPromises.lstat(scanDir);
        if (!dirStat.isDirectory() || dirStat.isSymbolicLink()) {
          continue;
        }
        entries = await fsPromises.readdir(scanDir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!entry.isFile() || entry.isSymbolicLink()) {
          continue;
        }
        const relPath = sub
          ? `missions/${missionId}/${sub}/${entry.name}`
          : `missions/${missionId}/${entry.name}`;
        if (!MISSION_FILE_RE.test(relPath)) {
          continue;
        }
        files.push({
          filePath: relPath,
          title: titleFromFileName(entry.name),
          kind: "mission",
        });
      }
    }
  }

  return files.sort((a, b) => a.filePath.localeCompare(b.filePath));
}

/**
 * Lists the files under `skills/<spec>/` on demand (not eagerly bundled into
 * `resolveWorkspaceDescriptors`, since a skill folder can contain many files
 * and most are never inspected). `clawhub install` lays skills out under the
 * leaf package name, so a namespaced spec like `owner/skill-name` is looked
 * up by its last path segment via `path.basename`.
 */
async function listSkillFiles(workspacePath, spec) {
  const trimmedSpec = typeof spec === "string" ? spec.trim() : "";
  const skillDirName = trimmedSpec ? path.basename(trimmedSpec) : "";
  if (!skillDirName || skillDirName === "." || skillDirName === "..") {
    throw new Error("spec must be a single skill name or owner/name pair");
  }

  const skillDir = path.join(workspacePath, "skills", skillDirName);
  const realSkillDir = await getRealDirectory(skillDir);
  if (!realSkillDir) {
    return [];
  }
  ensureInsideRoot(workspacePath, realSkillDir);

  async function walk(dir, relPrefix) {
    let entries;
    try {
      entries = await fsPromises.readdir(dir, { withFileTypes: true });
    } catch {
      return [];
    }
    const nested = await Promise.all(
      entries.map(async (entry) => {
        if (entry.isSymbolicLink()) {
          return [];
        }
        const relPath = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          return walk(path.join(dir, entry.name), relPath);
        }
        if (entry.isFile()) {
          return [
            {
              filePath: `skills/${skillDirName}/${relPath}`,
              title: titleFromFileName(entry.name),
              kind: "skill",
            },
          ];
        }
        return [];
      }),
    );
    return nested.flat();
  }

  const files = await walk(realSkillDir, "");
  return files.sort((a, b) => a.filePath.localeCompare(b.filePath));
}

async function collectStandardFiles(workspacePath) {
  const files = [];
  const seenRealPaths = new Set();
  let exactEntries = new Set();
  try {
    exactEntries = new Set(await fsPromises.readdir(workspacePath));
  } catch {
    return files;
  }
  for (const fileName of STANDARD_WORKSPACE_FILES) {
    if (!exactEntries.has(fileName)) {
      continue;
    }
    const absolutePath = path.join(workspacePath, fileName);
    try {
      const stat = await fsPromises.lstat(absolutePath);
      if (!stat.isFile() || stat.isSymbolicLink()) {
        continue;
      }
      const realPath = await fsPromises.realpath(absolutePath);
      if (seenRealPaths.has(realPath)) {
        continue;
      }
      seenRealPaths.add(realPath);
      files.push({
        filePath: fileName,
        title: titleForFilePath(fileName),
        kind: "standard",
      });
    } catch {
      // Missing files are skipped.
    }
  }
  return files;
}

async function readManagedWorkspaceMarker(workspacePath) {
  const marker = await readJsonFile(path.join(workspacePath, MANAGED_WORKSPACE_MARKER));
  if (!marker || typeof marker !== "object") {
    return null;
  }
  const workspaceKey =
    typeof marker.workspaceKey === "string" ? marker.workspaceKey.trim() : "";
  if (!WORKSPACE_KEY_RE.test(workspaceKey)) {
    return null;
  }
  return {
    workspaceKey,
    label:
      typeof marker.label === "string" && marker.label.trim()
        ? marker.label.trim()
        : `Workspace ${workspaceKey}`,
  };
}

function describeWorkspaceKind(workspacePath, homeDir) {
  const openclawHome = path.join(homeDir, ".openclaw");
  const legacyPath = path.join(homeDir, "openclaw");

  if (workspacePath === legacyPath) {
    return "legacy";
  }

  if (path.dirname(workspacePath) === openclawHome) {
    const baseName = path.basename(workspacePath);
    if (baseName === "workspace") {
      return "default";
    }
    if (baseName.startsWith("workspace-")) {
      return "profile";
    }
  }

  return "custom";
}

function workspaceLabel(workspacePath, kind) {
  if (kind === "default") {
    return "Default Workspace";
  }
  if (kind === "profile") {
    const suffix = path.basename(workspacePath).slice("workspace-".length);
    return `Profile Workspace (${suffix})`;
  }
  if (kind === "legacy") {
    return "Legacy Workspace";
  }
  return `Custom Workspace (${path.basename(workspacePath)})`;
}

async function resolveWorkspaceDescriptors(options = {}) {
  const homeDir = getHomeDir(options);
  const profileName = getProfileName(options);
  const openclawHome = path.join(homeDir, ".openclaw");
  const configuredWorkspace = extractConfiguredWorkspace(
    await readJsonFile(path.join(openclawHome, "openclaw.json")),
    homeDir,
  );
  const fallbackWorkspace = defaultWorkspacePath(homeDir, profileName);
  const desiredActiveWorkspace = configuredWorkspace || fallbackWorkspace;
  const activeWorkspaceRealPath = desiredActiveWorkspace
    ? await getRealDirectory(desiredActiveWorkspace)
    : null;

  const candidatePaths = new Set();
  if (configuredWorkspace) {
    candidatePaths.add(configuredWorkspace);
  }
  candidatePaths.add(fallbackWorkspace);
  candidatePaths.add(path.join(homeDir, "openclaw"));

  try {
    const entries = await fsPromises.readdir(openclawHome, { withFileTypes: true });
    for (const entry of entries) {
      if (
        !entry.isDirectory() ||
        !entry.name.startsWith("workspace-") ||
        RESERVED_WORKSPACE_DIRNAMES.has(entry.name)
      ) {
        continue;
      }
      candidatePaths.add(path.join(openclawHome, entry.name));
    }
  } catch {
    // Ignore missing ~/.openclaw.
  }

  const dedupedPaths = new Map();
  for (const candidatePath of candidatePaths) {
    const realPath = await getRealDirectory(candidatePath);
    if (!realPath) {
      continue;
    }
    if (!dedupedPaths.has(realPath)) {
      dedupedPaths.set(realPath, candidatePath);
    }
  }

  const workspaces = [];
  for (const realPath of dedupedPaths.keys()) {
    const managed = await readManagedWorkspaceMarker(realPath);
    const kind = describeWorkspaceKind(realPath, homeDir);
    workspaces.push({
      workspaceKey: managed?.workspaceKey ?? `${kind}-${workspaceHash(realPath)}`,
      label: managed?.label ?? workspaceLabel(realPath, kind),
      absolutePath: realPath,
      isActive: realPath === activeWorkspaceRealPath,
      kind: managed ? "managed" : kind,
      availableFiles: [
        ...(await collectStandardFiles(realPath)),
        ...(await collectTemplateInstructionFiles(realPath)),
        ...(await collectMemoryFiles(realPath)),
        ...(await collectMissionFiles(realPath)),
      ],
    });
  }

  workspaces.sort((left, right) => {
    if (left.isActive !== right.isActive) {
      return left.isActive ? -1 : 1;
    }
    return left.absolutePath.localeCompare(right.absolutePath);
  });

  return workspaces;
}

const MISSION_FILE_RE = /^missions\/[^/]+\/(context\.md|runs\/[^/]+\.md|outputs\/[^/]+\.json|artifacts\/[^/]+(?:\/[^/]+)*)$/;
// A SourceJob's files mirror the Missions' layout under jobs/<job>/: one run
// file written by OpenGroow, and the result written by the agent itself. They are
// deleted once the job settles.
const JOB_RUN_FILE_RE = /^jobs\/[^/]+\/run\.md$/;
const JOB_RESULT_FILE_RE = /^jobs\/[^/]+\/outputs\/[^/]+\.json$/;
const SKILL_FILE_RE = /^skills\/[^/]+\/[^/]+(?:\/[^/]+)*$/;

function isAllowedWorkspaceFilePath(filePath) {
  if (typeof filePath !== "string") {
    return false;
  }
  const trimmed = filePath.trim();
  if (!trimmed || trimmed !== filePath || trimmed.includes("\\") || trimmed.includes("\0") || path.isAbsolute(trimmed)) {
    return false;
  }
  if (!isSafeRelativePath(trimmed)) {
    return false;
  }
  if (STANDARD_WORKSPACE_FILES.includes(trimmed)) {
    return true;
  }
  if (isTemplateInstructionFilePath(trimmed)) {
    return true;
  }
  const memoryMatch = /^memory\/([^/]+)$/.exec(trimmed);
  if (memoryMatch) {
    return MEMORY_FILE_RE.test(memoryMatch[1]);
  }
  return MISSION_FILE_RE.test(trimmed) || JOB_RUN_FILE_RE.test(trimmed);
}

/**
 * Read-only superset of `isAllowedWorkspaceFilePath` that also permits
 * `skills/**` paths and a SourceJob's result. Installed skill files are inspectable but must never be
 * writable or deletable through the generic workspace file endpoints, so this
 * check is kept separate and only wired into `readWorkspaceFile`.
 */
function isAllowedReadableWorkspaceFilePath(filePath) {
  if (isAllowedWorkspaceFilePath(filePath)) {
    return true;
  }
  if (typeof filePath !== "string") {
    return false;
  }
  const trimmed = filePath.trim();
  if (!trimmed || trimmed !== filePath || trimmed.includes("\\") || trimmed.includes("\0") || path.isAbsolute(trimmed)) {
    return false;
  }
  if (!isSafeRelativePath(trimmed)) {
    return false;
  }
  return SKILL_FILE_RE.test(trimmed) || JOB_RESULT_FILE_RE.test(trimmed);
}

/**
 * Writable paths plus a SourceJob's result: the agent writes that file itself,
 * so OpenGroow may only read it and delete it during the job's cleanup.
 */
function isAllowedDeletableWorkspaceFilePath(filePath) {
  return isAllowedWorkspaceFilePath(filePath) || (typeof filePath === "string" && isSafeRelativePath(filePath.trim()) && JOB_RESULT_FILE_RE.test(filePath.trim()));
}

async function ensureNoSymbolicSegments(rootPath, filePath) {
  const segments = filePath.split("/");
  let currentPath = rootPath;
  for (const segment of segments) {
    currentPath = path.join(currentPath, segment);
    const stat = await fsPromises.lstat(currentPath);
    if (stat.isSymbolicLink()) {
      throw new Error("Workspace symlinks are not supported");
    }
  }
}

async function ensureWritablePathHasNoSymlinks(rootPath, filePath) {
  const segments = filePath.split("/");
  let currentPath = rootPath;
  for (const segment of segments) {
    currentPath = path.join(currentPath, segment);
    try {
      const stat = await fsPromises.lstat(currentPath);
      if (stat.isSymbolicLink()) {
        throw new Error("Workspace symlinks are not supported");
      }
    } catch (error) {
      if (error && error.code === "ENOENT") {
        return;
      }
      throw error;
    }
  }
}

function ensureInsideRoot(rootPath, candidatePath) {
  const relativePath = path.relative(rootPath, candidatePath);
  if (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
  ) {
    return;
  }
  throw new Error("Workspace file path escapes the workspace root");
}

function titleForFilePath(filePath) {
  return path.basename(filePath, ".md").toLowerCase();
}

async function listWorkspaces(options = {}) {
  return {
    workspaces: await resolveWorkspaceDescriptors(options),
  };
}

function assertWorkspaceKey(workspaceKey) {
  if (typeof workspaceKey !== "string" || !WORKSPACE_KEY_RE.test(workspaceKey.trim())) {
    throw new Error("workspaceKey must be 1-128 chars of letters, numbers, dot, underscore, or dash");
  }
  return workspaceKey.trim();
}

function managedWorkspacePath(homeDir, workspaceKey) {
  return path.join(homeDir, ".openclaw", `workspace-${workspaceKey}`);
}

async function createWorkspace({ workspaceKey, label }, options = {}) {
  const homeDir = getHomeDir(options);
  const trimmedWorkspaceKey = assertWorkspaceKey(workspaceKey);
  const workspacePath = managedWorkspacePath(homeDir, trimmedWorkspaceKey);
  await fsPromises.mkdir(workspacePath, { recursive: true });

  const trimmedLabel =
    typeof label === "string" && label.trim() ? label.trim() : `Workspace ${trimmedWorkspaceKey}`;
  await fsPromises.writeFile(
    path.join(workspacePath, MANAGED_WORKSPACE_MARKER),
    `${JSON.stringify(
      {
        workspaceKey: trimmedWorkspaceKey,
        label: trimmedLabel,
        managedBy: "opengroow",
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  return {
    workspaceKey: trimmedWorkspaceKey,
    label: trimmedLabel,
    absolutePath: await fsPromises.realpath(workspacePath),
  };
}

async function findWorkspace(workspaceKey, options = {}) {
  const trimmedWorkspaceKey = assertWorkspaceKey(workspaceKey);
  const workspaces = await resolveWorkspaceDescriptors(options);
  const workspace = workspaces.find(
    (entry) => entry.workspaceKey === trimmedWorkspaceKey,
  );
  if (!workspace) {
    throw new Error("Workspace not found");
  }
  return workspace;
}

async function readWorkspaceFile({ workspaceKey, filePath }, options = {}) {
  const trimmedWorkspaceKey =
    typeof workspaceKey === "string" ? workspaceKey.trim() : "";
  const trimmedFilePath = typeof filePath === "string" ? filePath.trim() : "";

  if (!trimmedWorkspaceKey) {
    throw new Error("workspaceKey is required");
  }
  if (!isAllowedReadableWorkspaceFilePath(trimmedFilePath)) {
    throw new Error("Workspace file path is not allowed");
  }

  const workspace = await findWorkspace(trimmedWorkspaceKey, options);

  const absolutePath = path.resolve(workspace.absolutePath, trimmedFilePath);
  ensureInsideRoot(workspace.absolutePath, absolutePath);
  await ensureNoSymbolicSegments(workspace.absolutePath, trimmedFilePath);

  const stat = await fsPromises.stat(absolutePath);
  if (!stat.isFile()) {
    throw new Error("Workspace file not found");
  }

  const realPath = await fsPromises.realpath(absolutePath);
  ensureInsideRoot(workspace.absolutePath, realPath);

  const mime = binaryMimeForPath(trimmedFilePath);
  let content;
  if (mime) {
    const bytes = await fsPromises.readFile(realPath);
    content = `data:${mime};base64,${bytes.toString("base64")}`;
  } else {
    content = await fsPromises.readFile(realPath, "utf8");
  }
  return {
    workspaceKey: workspace.workspaceKey,
    filePath: trimmedFilePath,
    title: titleForFilePath(trimmedFilePath),
    content,
    lastModifiedAt: stat.mtime.toISOString(),
  };
}

async function writeWorkspaceFile({ workspaceKey, filePath, content }, options = {}) {
  const trimmedWorkspaceKey =
    typeof workspaceKey === "string" ? workspaceKey.trim() : "";
  const trimmedFilePath = typeof filePath === "string" ? filePath.trim() : "";

  if (!trimmedWorkspaceKey) {
    throw new Error("workspaceKey is required");
  }
  if (!isAllowedWorkspaceFilePath(trimmedFilePath)) {
    throw new Error("Workspace file path is not allowed");
  }
  if (typeof content !== "string") {
    throw new Error("content is required");
  }

  const workspace = await findWorkspace(trimmedWorkspaceKey, options);
  const absolutePath = path.resolve(workspace.absolutePath, trimmedFilePath);
  ensureInsideRoot(workspace.absolutePath, absolutePath);
  await ensureWritablePathHasNoSymlinks(workspace.absolutePath, trimmedFilePath);
  await fsPromises.mkdir(path.dirname(absolutePath), { recursive: true });
  await fsPromises.writeFile(absolutePath, content, "utf8");

  return {
    workspaceKey: trimmedWorkspaceKey,
    filePath: trimmedFilePath,
  };
}

async function deleteWorkspaceFile({ workspaceKey, filePath }, options = {}) {
  const trimmedWorkspaceKey =
    typeof workspaceKey === "string" ? workspaceKey.trim() : "";
  const trimmedFilePath = typeof filePath === "string" ? filePath.trim() : "";

  if (!trimmedWorkspaceKey) {
    throw new Error("workspaceKey is required");
  }
  if (!isAllowedDeletableWorkspaceFilePath(trimmedFilePath)) {
    throw new Error("Workspace file path is not allowed");
  }

  const workspace = await findWorkspace(trimmedWorkspaceKey, options);
  const absolutePath = path.resolve(workspace.absolutePath, trimmedFilePath);
  ensureInsideRoot(workspace.absolutePath, absolutePath);

  try {
    await fsPromises.unlink(absolutePath);
    return { workspaceKey: trimmedWorkspaceKey, filePath: trimmedFilePath, deleted: true };
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return { workspaceKey: trimmedWorkspaceKey, filePath: trimmedFilePath, deleted: false };
    }
    throw error;
  }
}

module.exports = {
  STANDARD_WORKSPACE_FILES,
  getHomeDir,
  isAllowedWorkspaceFilePath,
  isAllowedReadableWorkspaceFilePath,
  isAllowedDeletableWorkspaceFilePath,
  createWorkspace,
  listWorkspaces,
  findWorkspace,
  listSkillFiles,
  readWorkspaceFile,
  writeWorkspaceFile,
  deleteWorkspaceFile,
};
