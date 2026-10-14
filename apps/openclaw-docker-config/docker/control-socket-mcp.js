const fsPromises = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const MCP_KEY_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;

function getHomeDir(options = {}) {
  return (
    options.homeDir?.trim() ||
    process.env.HOME?.trim() ||
    os.homedir()
  );
}

function openClawConfigPath(options = {}) {
  return path.join(getHomeDir(options), ".openclaw", "openclaw.json");
}

async function readOpenClawConfig(options = {}) {
  try {
    const raw = await fsPromises.readFile(openClawConfigPath(options), "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

async function writeOpenClawConfig(config, options = {}) {
  const configPath = openClawConfigPath(options);
  await fsPromises.mkdir(path.dirname(configPath), { recursive: true });
  await fsPromises.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

function validateMcpKey(key) {
  return typeof key === "string" && MCP_KEY_RE.test(key.trim());
}

function normalizeServers(servers) {
  if (!servers || typeof servers !== "object" || Array.isArray(servers)) {
    throw new Error("servers is required and must be a non-empty object");
  }

  const normalized = {};
  for (const [key, config] of Object.entries(servers)) {
    if (!validateMcpKey(key)) {
      throw new Error(`Invalid MCP server key: ${key}`);
    }
    if (!config || typeof config !== "object" || Array.isArray(config)) {
      throw new Error(`MCP server config must be an object: ${key}`);
    }
    normalized[key.trim()] = config;
  }

  if (Object.keys(normalized).length === 0) {
    throw new Error("servers is required and must be a non-empty object");
  }
  return normalized;
}

function normalizeKeys(keys) {
  if (!Array.isArray(keys)) {
    throw new Error("keys is required and must be a non-empty array");
  }
  const normalized = keys
    .filter((key) => typeof key === "string")
    .map((key) => key.trim())
    .filter((key) => key.length > 0);
  if (normalized.length === 0) {
    throw new Error("keys is required and must be a non-empty array");
  }
  for (const key of normalized) {
    if (!validateMcpKey(key)) {
      throw new Error(`Invalid MCP server key: ${key}`);
    }
  }
  return Array.from(new Set(normalized));
}

async function mergeMcpServers({ servers }, options = {}) {
  const normalizedServers = normalizeServers(servers);
  const config = await readOpenClawConfig(options);
  const currentMcp =
    config.mcp && typeof config.mcp === "object" && !Array.isArray(config.mcp)
      ? config.mcp
      : {};
  const currentServers =
    currentMcp.servers &&
    typeof currentMcp.servers === "object" &&
    !Array.isArray(currentMcp.servers)
      ? currentMcp.servers
      : {};

  config.mcp = {
    ...currentMcp,
    servers: {
      ...currentServers,
      ...normalizedServers,
    },
  };
  await writeOpenClawConfig(config, options);

  return { mergedKeys: Object.keys(normalizedServers) };
}

async function removeMcpServers({ keys }, options = {}) {
  const normalizedKeys = normalizeKeys(keys);
  const config = await readOpenClawConfig(options);
  const currentMcp =
    config.mcp && typeof config.mcp === "object" && !Array.isArray(config.mcp)
      ? config.mcp
      : {};
  const currentServers =
    currentMcp.servers &&
    typeof currentMcp.servers === "object" &&
    !Array.isArray(currentMcp.servers)
      ? { ...currentMcp.servers }
      : {};

  const removedKeys = [];
  for (const key of normalizedKeys) {
    if (Object.prototype.hasOwnProperty.call(currentServers, key)) {
      delete currentServers[key];
      removedKeys.push(key);
    }
  }

  config.mcp = {
    ...currentMcp,
    servers: currentServers,
  };
  await writeOpenClawConfig(config, options);

  return { removedKeys };
}

module.exports = {
  mergeMcpServers,
  removeMcpServers,
  readOpenClawConfig,
  writeOpenClawConfig,
};
