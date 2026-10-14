const {
  createWorkspace,
  findWorkspace,
  listWorkspaces,
  listSkillFiles,
  readWorkspaceFile,
  writeWorkspaceFile,
  deleteWorkspaceFile,
} = require("./control-socket-workspaces");
const { toErrorMessage } = require("./control-socket-errors");

function createWorkspaceWorkflow(options = {}) {
  const workspaceOptions = {
    homeDir: options.homeDir,
    profileName: options.profileName,
  };

  function failure(error) {
    const message = toErrorMessage(error);
    const status = error?.code === "ENOENT" || /not found/i.test(message) || /not allowed/i.test(message)
      ? 404
      : 400;
    return { status, body: { ok: false, error: message } };
  }

  async function list() {
    return { status: 200, body: { ok: true, data: await listWorkspaces(workspaceOptions) } };
  }

  async function read(body = {}) {
    const workspaceKey = typeof body.workspaceKey === "string" ? body.workspaceKey.trim() : "";
    const filePath = typeof body.filePath === "string" ? body.filePath.trim() : "";
    try {
      return { status: 200, body: { ok: true, data: await readWorkspaceFile({ workspaceKey, filePath }, workspaceOptions) } };
    } catch (error) {
      return failure(error);
    }
  }

  async function skillFiles(body = {}) {
    const workspaceKey = typeof body.workspaceKey === "string" ? body.workspaceKey.trim() : "";
    const spec = typeof body.spec === "string" ? body.spec.trim() : "";
    try {
      const workspace = await findWorkspace(workspaceKey, workspaceOptions);
      return { status: 200, body: { ok: true, data: await listSkillFiles(workspace.absolutePath, spec) } };
    } catch (error) {
      return failure(error);
    }
  }

  async function create(body = {}) {
    try {
      return { status: 200, body: { ok: true, data: await createWorkspace({ workspaceKey: body.workspaceKey, label: body.label }, workspaceOptions) } };
    } catch (error) {
      return failure(error);
    }
  }

  async function write(body = {}) {
    try {
      return { status: 200, body: { ok: true, data: await writeWorkspaceFile({ workspaceKey: body.workspaceKey, filePath: body.filePath, content: body.content }, workspaceOptions) } };
    } catch (error) {
      return failure(error);
    }
  }

  async function remove(body = {}) {
    try {
      return { status: 200, body: { ok: true, data: await deleteWorkspaceFile({ workspaceKey: body.workspaceKey, filePath: body.filePath }, workspaceOptions) } };
    } catch (error) {
      return failure(error);
    }
  }

  return { create, list, read, remove, skillFiles, write };
}

module.exports = { createWorkspaceWorkflow };
